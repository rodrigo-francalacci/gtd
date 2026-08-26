import 'server-only';

import { attachments, boxItems, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { TextReader } from '@/lib/enrich/reader';
import { FORMAT_META, formatOf } from '@/lib/text-formats';
import { writeBoxTranscript } from '@/lib/transcripts';
import { updateFileContent } from './client';

/**
 * Saving a text document back to Drive.
 *
 * The preview pane became an editor for markdown, LaTeX and HTML, and this is
 * the half of that which is not in the browser. Both sides of the app arrive
 * here — an attachment on a project and a document in a box — for the same
 * reason the bytes already share `serveDriveFile`: from Drive's point of view
 * they are one file with one id, and only the table we looked the id up in
 * differs.
 *
 * This is a Google call inside a request, which the app otherwise refuses. It
 * sits under the same exception an upload does, and for the same reason: the
 * payload *is* the Google call. Queueing it would mean parking the text
 * somewhere until a worker ran, and the only somewhere available is the file
 * we are trying to write — so the queue would have to invent a second store for
 * a document the user is looking at, and then answer "is it saved?" with "not
 * yet". A save either happened or it did not, and the person who pressed the
 * button is entitled to be told which.
 */

export class TextSaveError extends Error {}

/**
 * A ceiling, not a limit anyone should meet.
 *
 * Two megabytes is around four hundred thousand words. It is here because the
 * body arrives through a serverless function that caps at four and a half, and
 * hitting *that* gives a platform error page rather than a sentence explaining
 * itself.
 */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * The type to write the file back as.
 *
 * Not simply the stored `mimeType`, because that is whatever the browser
 * claimed when the file went up — `application/octet-stream` for a `.md` more
 * often than not. The format is decided by name first (see `formatOf`), and
 * writing back under the type that decision implies is what stops a file
 * arriving as one thing and being saved as another.
 */
function typeFor(mimeType: string | null, name: string): string {
  const format = formatOf(mimeType, name);
  if (!format) {
    throw new TextSaveError('That file is not one this app can edit as text.');
  }
  return FORMAT_META[format].mime;
}

/**
 * What the search index should hold for this text.
 *
 * Run through the reader the enrichment queue would have used rather than
 * stored raw, so that an edited HTML file is indexed as its prose and not as a
 * pile of `div` and `href` — which is the rule `TextReader` already owns, and
 * a second copy of it here would disagree the first time either changed.
 */
async function indexable(mimeType: string, name: string, text: string): Promise<string> {
  return new TextReader().read({
    name,
    mimeType,
    bytes: new TextEncoder().encode(text).buffer as ArrayBuffer,
  });
}

/** Save an attachment's text. Null when there is no such attachment. */
export async function saveAttachmentText(
  id: string,
  text: string,
): Promise<{ name: string; bytes: number } | null> {
  const [row] = await db
    .select({
      driveFileId: attachments.driveFileId,
      name: attachments.name,
      mimeType: attachments.mimeType,
    })
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);

  if (!row?.driveFileId) return null;

  const mimeType = typeFor(row.mimeType, row.name);
  await updateFileContent(row.driveFileId, mimeType, text);

  const bytes = new TextEncoder().encode(text).length;

  await db
    .update(attachments)
    .set({
      sizeBytes: bytes,
      // `search_vector` is generated from `ocr_text`, so this is the whole of
      // keeping search in step — no job to queue and nothing to wait for. The
      // file's text *is* the reading of it, which is the one case where the
      // enrichment queue has nothing to add.
      ocrText: await indexable(mimeType, row.name, text),
      // The stored type is corrected on the way past, so a `.md` that went up
      // as `application/octet-stream` stops being one.
      mimeType,
    })
    .where(eq(attachments.id, id));

  return { name: row.name, bytes };
}

/** Save a Big Box document's text. Null when there is no such document. */
export async function saveBoxItemText(
  id: string,
  text: string,
): Promise<{ name: string; bytes: number } | null> {
  const [row] = await db
    .select({
      driveFileId: boxItems.driveFileId,
      name: boxItems.name,
      mimeType: boxItems.mimeType,
    })
    .from(boxItems)
    .where(eq(boxItems.id, id))
    .limit(1);

  if (!row?.driveFileId || !row.name) return null;

  const mimeType = typeFor(row.mimeType, row.name);
  await updateFileContent(row.driveFileId, mimeType, text);

  const bytes = new TextEncoder().encode(text).length;

  await db
    .update(boxItems)
    .set({ sizeBytes: bytes, mimeType })
    .where(eq(boxItems.id, id));

  /*
   * The search side goes through the transcript writer rather than being done
   * here. On this table the vector is generated from `search_text` and not from
   * `text`, so the two columns have to be written together — and that recipe is
   * already owned in one place. Reproducing it here is exactly the duplication
   * that rule exists to prevent.
   */
  await writeBoxTranscript(id, await indexable(mimeType, row.name, text));

  return { name: row.name, bytes };
}
