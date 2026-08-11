import 'server-only';

import { attachments, actions, db, listItems, projects } from '@gtd/db';
import type { AttachmentKind, AttachmentParentType } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { getGrant } from '@/lib/auth/token';
import { hasSyncScopes } from '@/lib/auth/google';
import { enqueueEnrichment } from '@/lib/enrich/queue';
import { ensureFolder, trashFile, uploadFile } from './client';
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
