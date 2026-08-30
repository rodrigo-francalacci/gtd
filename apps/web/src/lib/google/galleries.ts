import 'server-only';

import { attachments, boxItems, db } from '@gtd/db';
import type { AttachmentParentType } from '@gtd/db';
import { and, asc, eq } from 'drizzle-orm';
import { ensureFolder, getFile } from './client';
import { safeName } from './sync';

/**
 * A gallery: a folder of pictures that stands in a list as one row.
 *
 * The case it exists for is a set that means nothing apart — thirty photographs
 * of a room, a survey, a holiday. As thirty attachments they bury everything
 * else on the pane, arrive in whatever order the uploads finished, and can only
 * be looked at one pane at a time. As one row you open, they are what they were
 * when you took them.
 *
 * **A real folder in Drive**, so the same set opens as a folder there and can
 * be dragged into anything else. `drive_file_id` holds the folder id, which is
 * the one thing about this that needs care everywhere else: a folder has no
 * bytes, so anything that fetches a file has to look at the kind first.
 *
 * **Its members are ordinary attachments**, parented on the gallery's own id.
 * That is the whole reason it is built this way rather than as a table of its
 * own: they get the file endpoint, the preview pane, the enrichment queue and
 * search with no new code, and removing one already trashes its Drive file. A
 * gallery is a *grouping*, and inventing a second kind of file to put in it
 * would have meant re-implementing all of that for the pictures people care
 * most about keeping.
 */

/** What a gallery is hanging off. A box entry has no owning row of its own. */
export type GalleryHome =
  | { kind: 'attachment'; parentType: AttachmentParentType; parentId: string }
  | { kind: 'box'; boxId: string };

/**
 * Make the Drive folder and the row that stands for it.
 *
 * A Google call inside a request, under the same exception an upload is: the
 * pictures are already staged in the browser waiting for somewhere to go, and
 * a queued folder would mean answering "where do I put these?" with "later".
 */
export async function createGalleryFolder(
  name: string,
  parentFolderId: string,
): Promise<string> {
  return ensureFolder(safeName(name) || 'Gallery', parentFolderId);
}

/** One picture in a gallery, with whatever it was willing to say about itself. */
export type GalleryPicture = {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  takenAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: Date;
};

/**
 * What is in a gallery, oldest first.
 *
 * Oldest first because a set of photographs is a sequence: pages of a document,
 * rooms walked through in order, a morning. Sorting by name would put IMG_1009
 * before IMG_998, and sorting newest-first would play every set backwards.
 */
export async function getGalleryPictures(galleryId: string): Promise<GalleryPicture[]> {
  return db
    .select({
      id: attachments.id,
      name: attachments.name,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      width: attachments.width,
      height: attachments.height,
      takenAt: attachments.takenAt,
      latitude: attachments.latitude,
      longitude: attachments.longitude,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(and(eq(attachments.parentType, 'gallery'), eq(attachments.parentId, galleryId)))
    .orderBy(asc(attachments.createdAt), asc(attachments.id));
}

/** How many, and the first one — what a row in a list needs and no more. */
export async function getGallerySummary(
  galleryId: string,
): Promise<{ count: number; coverId: string | null }> {
  const pictures = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(eq(attachments.parentType, 'gallery'), eq(attachments.parentId, galleryId)))
    .orderBy(asc(attachments.createdAt), asc(attachments.id));

  return { count: pictures.length, coverId: pictures[0]?.id ?? null };
}

/**
 * Is this id a gallery, and where does it keep its pictures?
 *
 * Two tables and one id, because `parent_id` has always addressed several. The
 * answer is the folder, or null when the id names something else entirely.
 */
export async function galleryFolderId(galleryId: string): Promise<string | null> {
  const [asAttachment] = await db
    .select({ driveFileId: attachments.driveFileId })
    .from(attachments)
    .where(and(eq(attachments.id, galleryId), eq(attachments.kind, 'gallery')))
    .limit(1);

  if (asAttachment) return asAttachment.driveFileId;

  const [asBoxItem] = await db
    .select({ driveFileId: boxItems.driveFileId })
    .from(boxItems)
    .where(and(eq(boxItems.id, galleryId), eq(boxItems.kind, 'gallery')))
    .limit(1);

  return asBoxItem?.driveFileId ?? null;
}

/** Confirm a folder is really there, for a gallery that has lost its own. */
export async function folderExists(folderId: string): Promise<boolean> {
  const file = await getFile(folderId);
  return Boolean(file && !file.trashed);
}
