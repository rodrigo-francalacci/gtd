import 'server-only';

import { attachments, boxItems, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { getFile, updateFileBytes, uploadFile } from './client';
import { safeName } from './sync';

/**
 * The last PDF a document was typeset into.
 *
 * TeX runs on the machine serving the app, and on a serverless host it never
 * will — the distribution alone is hundreds of megabytes against a function
 * limit of 250. So typesetting is something one machine can do and the others
 * cannot, and the honest answer to that is not to hide the feature everywhere
 * else but to *keep the result*: the phone gets the real document, with its
 * real pages, fonts and packages, built by real TeX, without needing a TeX
 * distribution it could never hold.
 *
 * **Stored in Drive beside its source**, like every other file with a size. The
 * folder then holds the document and the thing it was made from, next to each
 * other, which is where you would look for it — and it costs the app nothing,
 * because `drive.file` covers a file the app created.
 *
 * **One PDF per document, replaced in place.** A history of builds is a folder
 * filling up with a document you have already read; what you want from a phone
 * is the current one. The Drive id is therefore reused and the bytes patched
 * over, so the link in the pane never changes and nothing accumulates.
 *
 * **A failed build changes nothing.** The previous PDF stays exactly where it
 * was, because an older document you can read beats a fresh error you cannot —
 * and the date beside it is what stops that being a lie.
 */

/** Which side of the app a file came from. The two tables are otherwise alike. */
export type TypesetSide = 'attachment' | 'box';

export type TypesetBuild = { fileId: string; at: Date };

/** The source file and any build already stored against it. */
async function look(side: TypesetSide, id: string) {
  if (side === 'attachment') {
    const [row] = await db
      .select({
        name: attachments.name,
        source: attachments.driveFileId,
        fileId: attachments.typesetFileId,
        at: attachments.typesetAt,
      })
      .from(attachments)
      .where(eq(attachments.id, id))
      .limit(1);

    return row ?? null;
  }

  const [row] = await db
    .select({
      name: boxItems.name,
      source: boxItems.driveFileId,
      fileId: boxItems.typesetFileId,
      at: boxItems.typesetAt,
    })
    .from(boxItems)
    .where(eq(boxItems.id, id))
    .limit(1);

  return row ?? null;
}

/** Stamp the row. Written last, so a Drive failure never claims a build. */
async function stamp(side: TypesetSide, id: string, fileId: string, at: Date) {
  if (side === 'attachment') {
    await db
      .update(attachments)
      .set({ typesetFileId: fileId, typesetAt: at })
      .where(eq(attachments.id, id));
    return;
  }

  await db
    .update(boxItems)
    .set({ typesetFileId: fileId, typesetAt: at })
    .where(eq(boxItems.id, id));
}

/** What the built PDF is called: the source's name with a `.pdf` on it. */
function pdfName(name: string | null): string {
  const base = (name ?? 'document').replace(/\.[a-z0-9]+$/i, '');
  return `${safeName(base) || 'document'}.pdf`;
}

/** The stored build, or null when there has never been one. */
export async function readTypeset(
  side: TypesetSide,
  id: string,
): Promise<TypesetBuild | null> {
  const row = await look(side, id);
  if (!row?.fileId || !row.at) return null;

  return { fileId: row.fileId, at: row.at };
}

/**
 * Keep this build as the document's current one.
 *
 * Returns null when there is no such row — the caller answers 404 — and throws
 * whatever Drive throws, because a build that could not be stored must not look
 * like one that was.
 *
 * The parent comes from the source file rather than being worked out again from
 * the project or the box. It is the same answer by construction, and asking
 * Drive where the `.tex` actually is cannot disagree with where the `.tex`
 * actually is.
 */
export async function writeTypeset(
  side: TypesetSide,
  id: string,
  bytes: ArrayBuffer,
): Promise<TypesetBuild | null> {
  const row = await look(side, id);
  if (!row) return null;

  const at = new Date();

  /*
   * Patch the existing file when there is one. If it has been deleted in Drive
   * — emptied from the bin, or tidied away by hand — the patch fails and a new
   * one is made, because being unable to typeset for ever because of something
   * that happened in Drive months ago is the wrong way to fail.
   */
  if (row.fileId) {
    try {
      await updateFileBytes(row.fileId, 'application/pdf', bytes);
      await stamp(side, id, row.fileId, at);
      return { fileId: row.fileId, at };
    } catch {
      // Fall through and make a new one.
    }
  }

  const parents = row.source ? ((await getFile(row.source))?.parents ?? []) : [];
  const parent = parents[0];

  if (!parent) return null;

  const made = await uploadFile(pdfName(row.name), 'application/pdf', bytes, parent);
  await stamp(side, id, made.id, at);

  return { fileId: made.id, at };
}
