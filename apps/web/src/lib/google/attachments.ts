import 'server-only';

import { attachments, actions, db, listItems, projects } from '@gtd/db';
import type { AttachmentKind, AttachmentParentType } from '@gtd/db';
import { eq, sql } from 'drizzle-orm';
import { getGrant } from '@/lib/auth/token';
import { hasSyncScopes } from '@/lib/auth/google';
import { enqueueEnrichment } from '@/lib/enrich/queue';
import {
  createGoogleFile,
  ensureFolder,
  getFile,
  trashFile,
  uploadFile,
} from './client';
import { ROOT, safeName } from './sync';

/**
 * Vercel caps a serverless request body at 4.5 MB, and the bytes have to
 * travel through the request because Drive is the only storage this app has —
 * there is nowhere to park them for a background worker to pick up. So the
 * limit is real, and it's enforced here with a sentence you can act on rather
 * than a platform-level 413.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export class AttachmentError extends Error {}

/** Where an unfiled capture lands, so nothing is ever uploaded to the root. */
const INBOX = 'Inbox';

function kindFor(mimeType: string): AttachmentKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * The Drive folder a file attached to this thing belongs in.
 *
 * An action's files go to its project's folder rather than a folder of their
 * own — the project is the unit you go looking in months later, and a folder
 * per action would bury it. Anything with no project goes to `GTD/Inbox`.
 */
async function destinationFolder(
  parentType: AttachmentParentType,
  parentId: string,
): Promise<string> {
  const projectId =
    parentType === 'project'
      ? parentId
      : parentType === 'action'
        ? (
            await db
              .select({ projectId: actions.projectId })
              .from(actions)
              .where(eq(actions.id, parentId))
              .limit(1)
          )[0]?.projectId
        : (
            await db
              .select({ projectId: listItems.projectId })
              .from(listItems)
              .where(eq(listItems.id, parentId))
              .limit(1)
          )[0]?.projectId;

  const root = await ensureFolder(ROOT);
  if (!projectId) return ensureFolder(INBOX, root);

  const [project] = await db
    .select({
      title: projects.title,
      driveFolderId: projects.driveFolderId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return ensureFolder(INBOX, root);
  if (project.driveFolderId) return project.driveFolderId;

  // The project predates the Google connection and was never backfilled.
  // Attaching a file is a clear enough signal that it wants a folder, so make
  // one now and record it rather than quietly filing the upload elsewhere.
  const container = await ensureFolder('Projects', root);
  const folderId = await ensureFolder(safeName(project.title), container);

  await db
    .update(projects)
    .set({ driveFolderId: folderId })
    .where(eq(projects.id, projectId));

  return folderId;
}

/**
 * Put a file in Drive and record it against the thing it belongs to.
 *
 * This is the one place the app calls Google inside a request. Everything else
 * enqueues, but an upload *is* the payload — queueing it would mean storing
 * the bytes somewhere first, and Drive is the only somewhere there is.
 */
export async function uploadAttachment(
  parentType: AttachmentParentType,
  parentId: string,
  file: File,
): Promise<{ id: string; name: string }> {
  const grant = await getGrant();
  if (!grant?.refreshToken || !hasSyncScopes(grant.scope)) {
    throw new AttachmentError(
      'Drive is not connected. Connect it on the Google page first.',
    );
  }

  if (file.size === 0) throw new AttachmentError('That file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AttachmentError(
      `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ` +
        `${MAX_UPLOAD_BYTES / 1024 / 1024} MB — put it in the project's Drive ` +
        'folder directly and link it instead.',
    );
  }

  const folderId = await destinationFolder(parentType, parentId);
  const mimeType = file.type || 'application/octet-stream';

  const uploaded = await uploadFile(
    safeName(file.name),
    mimeType,
    await file.arrayBuffer(),
    folderId,
  );

  const [row] = await db
    .insert(attachments)
    .values({
      parentType,
      parentId,
      kind: kindFor(mimeType),
      driveFileId: uploaded.id,
      name: uploaded.name ?? file.name,
      mimeType,
      sizeBytes: file.size,
    })
    .returning({ id: attachments.id, name: attachments.name });

  // Reading the file happens afterwards, in the worker. Capture never waits
  // on a model any more than it waits on Drive.
  await enqueueEnrichment(row.id, mimeType);

  return row;
}

/**
 * Make an empty Google Doc or Sheet on this project, action or list item.
 *
 * The counterpart to uploading: there are no bytes, so nothing has to squeeze
 * through a request body, and the result is editable in the preview pane
 * rather than only readable. It lands in the same folder an upload would.
 */
export async function createGoogleDocument(
  parentType: AttachmentParentType,
  parentId: string,
  mimeType: string,
  name: string,
): Promise<{ id: string; name: string; driveFileId: string }> {
  const grant = await getGrant();
  if (!grant?.refreshToken || !hasSyncScopes(grant.scope)) {
    throw new AttachmentError(
      'Drive is not connected. Connect it on the Google page first.',
    );
  }

  const title = safeName(name) || 'Untitled';
  const folderId = await destinationFolder(parentType, parentId);
  const created = await createGoogleFile(title, mimeType, folderId);

  const [row] = await db
    .insert(attachments)
    .values({
      parentType,
      parentId,
      kind: 'file',
      driveFileId: created.id,
      name: created.name ?? title,
      mimeType,
      // Google stores it; there is no size on our side to record.
      sizeBytes: null,
    })
    .returning({
      id: attachments.id,
      name: attachments.name,
      driveFileId: attachments.driveFileId,
    });

  // Nothing to read in an empty document. It gets queued the first time the
  // enrichment backfill runs after you have actually written something.
  return { ...row, driveFileId: created.id };
}

/**
 * Pull Docs and Sheets names back from Google.
 *
 * This looks like it contradicts one-way sync, and doesn't. For a project
 * folder the app owns the name — the project title is the source of truth and
 * a rename in Drive is drift to report. For a document, Google owns it: you
 * rename a doc by typing in its title bar, and this app offers no other way to
 * do it. Holding a stale copy of a name whose only editor is elsewhere would
 * be the app pretending to own something it doesn't.
 *
 * Only Docs-editor files. An uploaded file's name is the name it was uploaded
 * with, and the app is the one that set it.
 */
export async function refreshGoogleNames(limit = 50): Promise<number> {
  const grant = await getGrant();
  if (!grant?.refreshToken || !hasSyncScopes(grant.scope)) return 0;

  const rows = await db
    .select({
      id: attachments.id,
      name: attachments.name,
      driveFileId: attachments.driveFileId,
    })
    .from(attachments)
    .where(sql`${attachments.mimeType} like 'application/vnd.google-apps.%'`)
    .limit(limit);

  let changed = 0;

  for (const row of rows) {
    if (!row.driveFileId) continue;

    // A file that has been deleted in Drive gets left alone rather than
    // renamed to nothing — losing the label as well would be losing twice.
    const file = await getFile(row.driveFileId);
    if (!file?.name || file.name === row.name) continue;

    await db
      .update(attachments)
      .set({ name: file.name })
      .where(eq(attachments.id, row.id));

    changed += 1;
  }

  return changed;
}

/**
 * Remove an attachment. The Drive file goes to the bin, not the void — and
 * only ever the file this app uploaded itself.
 */
export async function removeAttachment(id: string): Promise<void> {
  const [row] = await db
    .delete(attachments)
    .where(eq(attachments.id, id))
    .returning({ driveFileId: attachments.driveFileId });

  if (!row?.driveFileId) return;

  try {
    await trashFile(row.driveFileId);
  } catch {
    // The row is already gone and the file is recoverable from Drive's bin.
    // Failing the whole action here would leave you unable to detach anything
    // because of a problem at Google's end.
  }
}
