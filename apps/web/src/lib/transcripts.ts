import 'server-only';

import { attachments, boxItems, db } from '@gtd/db';
import { eq } from 'drizzle-orm';

/**
 * A typed transcript for a recording, on either side of the app.
 *
 * There is still no speech provider — `enqueueEnrichment` refuses audio for
 * that reason, and a job nothing can run is a manufactured failure. This is the
 * other way to fill the same columns: you play the clip and type what you hear.
 * Which means the columns were never speculative, only unreachable, and a
 * recording stops being the one thing in the app that search cannot see inside.
 *
 * Two tables, because a recording arrives two ways and always has: an
 * `attachments` row when it hangs off a project, action, list item or capture,
 * and a `box_items` row when it was spoken into a box. The preview pane shows
 * both and is deliberately ignorant of which — it addresses a file by URL, so
 * the difference lives here and in the two route handlers, exactly as the
 * bytes already do.
 */

/**
 * Long enough for an hour of speech, and a bound rather than a limit.
 *
 * The columns feed generated `tsvector`s, and Postgres refuses a vector over
 * about a megabyte — a failure that would arrive on save, after the typing.
 * `box_items.search_text` is already sliced to this, so the two agree.
 */
export const MAX_TRANSCRIPT_CHARS = 100_000;

/** Null when the row does not exist, as opposed to having no transcript. */
export async function readAttachmentTranscript(id: string): Promise<string | null> {
  const [row] = await db
    .select({ transcription: attachments.transcription })
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);

  return row ? (row.transcription ?? '') : null;
}

/** False when there was no such attachment. */
export async function writeAttachmentTranscript(
  id: string,
  text: string,
): Promise<boolean> {
  // Empty means "nothing said", which is a real answer about a recording and
  // reads differently from never having been opened. Stored as null all the
  // same: an empty string in a tsvector column is the same nothing, and null
  // is what every other unwritten field here already is.
  const value = text.trim().slice(0, MAX_TRANSCRIPT_CHARS) || null;

  const updated = await db
    .update(attachments)
    // `search_vector` is generated from this column, so search picks the
    // transcript up with no second write. That is not true on the other side.
    .set({ transcription: value })
    .where(eq(attachments.id, id))
    .returning({ id: attachments.id });

  return updated.length > 0;
}

export async function readBoxTranscript(id: string): Promise<string | null> {
  const [row] = await db
    .select({ text: boxItems.text })
    .from(boxItems)
    .where(eq(boxItems.id, id))
    .limit(1);

  return row ? (row.text ?? '') : null;
}

export async function writeBoxTranscript(id: string, text: string): Promise<boolean> {
  const value = text.trim().slice(0, MAX_TRANSCRIPT_CHARS) || null;

  const [row] = await db
    .select({ description: boxItems.description })
    .from(boxItems)
    .where(eq(boxItems.id, id))
    .limit(1);

  if (!row) return false;

  await db
    .update(boxItems)
    .set({
      text: value,
      /*
       * Rewritten alongside, because here the vector is generated from
       * `search_text` rather than from `text` — writing the transcript alone
       * would store it and leave it unsearchable, which is the failure the
       * schema warns about and the whole reason to type one.
       *
       * Same recipe as editing a description, deliberately: two rules for
       * building one column would disagree the first time either changed.
       */
      searchText:
        [row.description ?? '', value ?? '']
          .filter(Boolean)
          .join('\n')
          .slice(0, MAX_TRANSCRIPT_CHARS) || null,
      updatedAt: new Date(),
    })
    .where(eq(boxItems.id, id));

  return true;
}
