import 'server-only';

import { boxItems, boxes, db } from '@gtd/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { hasSyncScopes } from '@/lib/auth/google';
import { getGrant } from '@/lib/auth/token';
import { canClassify } from '@/lib/box/classify';
import { enqueueBoxJob } from '@/lib/box/queue';
import {
  createResumableSession,
  ensureFolder,
  getFile,
  renameFile,
  renameFolder,
  trashFile,
} from './client';
import { ROOT, safeName } from './sync';

export class BoxError extends Error {}

/** `GTD/Box/<name>` — beside Projects and Inbox, under the one root. */
const BOX_CONTAINER = 'Box';

async function requireDrive() {
  const grant = await getGrant();
  if (!grant?.refreshToken || !hasSyncScopes(grant.scope)) {
    throw new BoxError('Drive is not connected. Connect it on the Google page first.');
  }
}

/**
 * The box's Drive folder, made if it doesn't exist and renamed if the box has
 * been renamed since.
 *
 * Called from the ingest path rather than from the rename action, which is
 * what keeps the "never call Google inside a request" rule intact: renaming a
 * box writes one row, and the next document to arrive reconciles Drive. The
 * ingest request is already a Google call by definition — it is carrying a
 * file — so one more costs nothing there and blocks no one.
 */
export async function ensureBoxFolder(boxId: string): Promise<string> {
  const [box] = await db
    .select({
      name: boxes.name,
      driveFolderId: boxes.driveFolderId,
    })
    .from(boxes)
    .where(eq(boxes.id, boxId))
    .limit(1);

  if (!box) throw new BoxError('That box no longer exists.');

  const wanted = safeName(box.name) || 'Box';

  if (box.driveFolderId) {
    const existing = await getFile(box.driveFolderId);

    // Deleted in Drive: make a new one rather than failing the upload. The
    // documents already filed keep their own ids and are unaffected — this
    // folder is only where the *next* one lands.
    if (existing && !existing.trashed) {
      if (existing.name !== wanted) await renameFolder(box.driveFolderId, wanted);
      return box.driveFolderId;
    }
  }

  const root = await ensureFolder(ROOT);
  const container = await ensureFolder(BOX_CONTAINER, root);
  const folderId = await ensureFolder(wanted, container);

  await db
    .update(boxes)
    .set({ driveFolderId: folderId, updatedAt: new Date() })
    .where(eq(boxes.id, boxId));

  return folderId;
}

/**
 * Step one of ingest: open a Drive session pointed at the box's folder.
 *
 * The same three-step shape as an attachment upload — session, PUT, complete —
 * because it solves the same problem: the bytes must not travel through a
 * serverless function with a 4.5 MB body cap. Here the thing holding the bytes
 * is an Apps Script rather than a browser, which is why no origin is passed.
 */
export async function startBoxUpload(
  boxId: string,
  name: string,
  mimeType: string,
  /**
   * The origin that will send the bytes, or null for a server-to-server
   * caller like the Apps Script.
   *
   * Drive binds the session to whichever origin opened it and enforces that
   * with CORS — so a browser PUT to a session opened with no origin is
   * refused, while a script's PUT carrying no Origin at all is fine whatever
   * the session was opened with. Both are real callers here: the script feeds
   * the boxes, and the app itself needs to be able to put a document straight
   * in. Passing null for a browser cost me a "Failed to fetch" that looked
   * exactly like a bug in the upload and was in fact this.
   */
  origin: string | null,
): Promise<string> {
  await requireDrive();

  const folderId = await ensureBoxFolder(boxId);

  return createResumableSession(
    safeName(name) || 'Document',
    mimeType || 'application/octet-stream',
    folderId,
    origin,
  );
}

/**
 * Step two: record the document and queue it to be read.
 *
 * Name, type and size are read back from Drive rather than trusted from the
 * request, exactly as `completeUpload` does — and `drive.file` does the
 * authorising, since an id for a file this app did not create comes back null.
 *
 * `capturedAt` is the *original* file's date where the caller knows it, so
 * importing a backlog of scans files each one under the day it arrived instead
 * of burying a year of documents under today.
 */
export async function completeBoxUpload(
  boxId: string,
  driveFileId: string,
  capturedAt?: Date,
): Promise<{ id: string; name: string }> {
  const file = await getFile(driveFileId);
  if (!file) throw new BoxError('That upload could not be found in Drive.');

  const mimeType = file.mimeType ?? 'application/octet-stream';
  const size = file.size ? Number(file.size) : null;

  // Ingest is retried by hand and by script, so the same file arriving twice
  // is a real possibility. The Drive id is the identity: a second complete for
  // one already recorded returns the existing row rather than a duplicate.
  const [existing] = await db
    .select({ id: boxItems.id, name: boxItems.name })
    .from(boxItems)
    .where(eq(boxItems.driveFileId, file.id))
    .limit(1);

  if (existing) return existing;

  /**
   * A voice note is filed, not read.
   *
   * There is no speech provider wired up, so queueing audio would manufacture
   * a failure for a file that is perfectly fine — the same call the enrichment
   * queue makes. It goes in as `ready` with its filename, which is honest:
   * nothing is pending, there is simply nothing to read. Play it in the feed.
   */
  const readable = canClassify(mimeType);

  const [row] = await db
    .insert(boxItems)
    .values({
      boxId,
      kind: 'document',
      driveFileId: file.id,
      name: file.name,
      mimeType,
      sizeBytes: Number.isFinite(size) ? size : null,
      status: readable ? 'pending' : 'ready',
      ...(capturedAt ? { capturedAt } : {}),
    })
    .returning({ id: boxItems.id, name: boxItems.name });

  if (readable) await enqueueBoxJob(row.id);

  return row;
}

/**
 * Remove a document, and send its file to Drive's bin.
 *
 * A box is meant to keep things, so this is not the main path — but a blank
 * page, a duplicate scan or a photograph of the desk are all real, and a box
 * you cannot take rubbish out of stops being one you trust. Trashed rather
 * than deleted, and only ever a file this app uploaded: Drive holds it for 30
 * days, which is the difference between a mistake and a loss.
 */
export async function deleteBoxItem(itemId: string): Promise<void> {
  const [row] = await db
    .delete(boxItems)
    .where(eq(boxItems.id, itemId))
    .returning({ driveFileId: boxItems.driveFileId });

  if (!row?.driveFileId) return;

  try {
    await trashFile(row.driveFileId);
  } catch {
    // The row is already gone and the file is recoverable from Drive's bin.
    // Failing here would leave you unable to tidy the box because of a
    // problem at Google's end.
  }
}

/**
 * The name a box document should carry in Drive.
 *
 * The title is what the box calls it — the model's, or whatever you corrected
 * it to. The extension comes from the name Drive currently holds, because
 * dropping it would leave a file the operating system no longer knows how to
 * open; it is not doubled if the title already ends in it.
 *
 * The printed date goes in front when there is one, and that is not decoration.
 * The scanner bridge already names its uploads `2026-01-30 Fuel Receipt — …`,
 * so a bare title would have been a regression against a convention already
 * sitting in the folder: a document folder is read in date order, and a
 * hundred receipts sorted by the first letter of a summary is not a filing
 * system. It is also the one fact those generated names carry that a title
 * often doesn't, and Drive has nowhere else to put it.
 *
 * `doc_date` rather than arrival, matching the feed: what the paper says,
 * which is the date you would look for.
 */
export function driveNameFor(
  title: string,
  current: string,
  docDate: string | null,
): string | null {
  const base = safeName(title);
  if (!base) return null;

  // Already led by an ISO date — the model repeating it, or a title that has
  // been through here before. Prefixing again would stutter.
  const dated =
    docDate && !/^\d{4}-\d{2}-\d{2}/.test(base) ? `${docDate} ${base}` : base;

  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(current)?.[0] ?? '';
  if (!ext) return dated;

  return dated.toLowerCase().endsWith(ext.toLowerCase()) ? dated : `${dated}${ext}`;
}

/**
 * Make Drive call a document what the box calls it.
 *
 * A scan arrives named by whatever produced it — a camera's timestamp, a
 * scanner's counter — and is then read and given a real title. Until now that
 * title lived only here, so the box knew the document as "MFG Marlborough Road
 * Fuel Receipt" and Drive still knew it as an upload filename. Anyone opening
 * the Drive folder saw none of the work.
 *
 * This is one-way sync doing exactly what it says, not an exception to it: the
 * app owns a document's title and pushes it out. It is the mirror image of
 * `refreshGoogleNames`, which pulls in the names of Docs-editor files — those
 * are renamed by typing in a title bar and the app offers no other way, so
 * Google owns them. Both rules come from the same question, and the answers
 * differ because the answer to "who renames this" differs. Docs-native files
 * are excluded here for that reason, not overlooked.
 *
 * Drift is found without asking Google anything. `box_items.name` is by
 * definition the name Drive holds, so a title that no longer agrees with it is
 * the whole test — no per-file read, and nothing to do on a tick where nothing
 * has been renamed.
 *
 * A file whose rename fails is skipped rather than failing the sweep. The
 * usual cause is a document removed from Drive by hand, which is not a reason
 * to stop renaming the other forty.
 */
export async function renameBoxFiles(limit = 50): Promise<number> {
  const grant = await getGrant();
  if (!grant?.refreshToken || !hasSyncScopes(grant.scope)) return 0;

  const rows = await db
    .select({
      id: boxItems.id,
      name: boxItems.name,
      title: boxItems.title,
      docDate: boxItems.docDate,
      driveFileId: boxItems.driveFileId,
    })
    .from(boxItems)
    .where(
      and(
        eq(boxItems.status, 'ready'),
        isNotNull(boxItems.driveFileId),
        isNotNull(boxItems.title),
        // Google's to name. See above.
        sql`coalesce(${boxItems.mimeType}, '') not like 'application/vnd.google-apps.%'`,
      ),
    )
    .limit(limit);

  let renamed = 0;

  for (const row of rows) {
    const wanted = driveNameFor(row.title!, row.name, row.docDate);
    if (!wanted || wanted === row.name) continue;

    try {
      await renameFile(row.driveFileId!, wanted);
    } catch {
      continue;
    }

    // Written after Drive agrees, never before: this column is the record of
    // what Drive holds, and setting it first would mean a failed rename left
    // the app certain of a name that was never applied — and never trying
    // again, because the drift it looks for would be gone.
    await db.update(boxItems).set({ name: wanted }).where(eq(boxItems.id, row.id));
    renamed += 1;
  }

  return renamed;
}
