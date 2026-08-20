import 'server-only';

import { boxItems, boxes, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { hasSyncScopes } from '@/lib/auth/google';
import { getGrant } from '@/lib/auth/token';
import { canClassify } from '@/lib/box/classify';
import { enqueueBoxJob } from '@/lib/box/queue';
import {
  createResumableSession,
  ensureFolder,
  getFile,
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
