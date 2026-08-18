import 'server-only';

import { boxItems, boxes, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { hasSyncScopes } from '@/lib/auth/google';
import { getGrant } from '@/lib/auth/token';
import { enqueueBoxJob } from '@/lib/box/queue';
import {
  createResumableSession,
  ensureFolder,
  getFile,
  renameFolder,
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
): Promise<string> {
  await requireDrive();

  const folderId = await ensureBoxFolder(boxId);

  return createResumableSession(
    safeName(name) || 'Document',
    mimeType || 'application/octet-stream',
    folderId,
    null,
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

  const [row] = await db
    .insert(boxItems)
    .values({
      boxId,
      driveFileId: file.id,
      name: file.name,
      mimeType,
      sizeBytes: Number.isFinite(size) ? size : null,
      ...(capturedAt ? { capturedAt } : {}),
    })
    .returning({ id: boxItems.id, name: boxItems.name });

  await enqueueBoxJob(row.id);

  return row;
}
