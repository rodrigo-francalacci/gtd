import { NextResponse } from 'next/server';
import { boxes, db } from '@gtd/db';
import { eq, sql } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { WHY, authoriseSecret } from '@/lib/box/auth';
import {
  BoxError,
  completeBoxUpload,
  startBoxUpload,
  type EmailFacts,
} from '@/lib/google/boxes';
import { setDocumentExpiry } from '@/lib/actions';

import { GoogleAuthError } from '@/lib/auth/token';
import { disconnected } from '@/lib/google/serve';

export const dynamic = 'force-dynamic';
/** Opening a Drive session and reading a file back are both Google calls. */
export const maxDuration = 60;

/**
 * The Big Box's front door, for the Apps Script that watches the scan folders.
 *
 * Two steps behind one route, because there is exactly one caller and it does
 * both in a row: `open` returns a Drive session URL, the script PUTs the bytes
 * straight to Google, then `complete` records the document and queues it to be
 * read. The bytes never pass through here, so Vercel's 4.5 MB body cap doesn't
 * apply and the ceiling is Drive's — a 40 MB scan is fine.
 *
 * Why a script at all: the app holds `drive.file`, which can only see files it
 * created itself. It cannot look inside the folder the Drive scanner saves to,
 * and the alternative — `drive.readonly` — is a restricted scope that can read
 * every file in the account and needs Google's verification. Uploading through
 * the app's own credentials makes each document app-created, so the narrow
 * scope keeps working and the scanner keeps its crop-and-deshadow, which is
 * the thing that makes a photographed letter readable at all.
 */

/**
 * Which box, by name or id.
 *
 * The script knows folder names, not uuids, so a name is the friendlier
 * contract — and an unknown one falls back to the default box rather than
 * refusing the document. Anything that arrives is worth keeping; filing it in
 * the wrong box is a thing you can fix, and losing it isn't.
 */
async function resolveBox(hint: string | undefined) {
  const name = (hint ?? '').trim();

  if (name) {
    const [match] = await db
      .select({ id: boxes.id, name: boxes.name })
      .from(boxes)
      .where(
        sql`${boxes.id}::text = ${name} or lower(${boxes.name}) = lower(${name})`,
      )
      .limit(1);

    if (match) return match;
  }

  const [fallback] = await db
    .select({ id: boxes.id, name: boxes.name })
    .from(boxes)
    .where(eq(boxes.isDefault, true))
    .limit(1);

  return fallback ?? null;
}

export async function POST(request: Request) {
  // A signed-in session works too: it lets the endpoint be exercised while
  // setting the script up, and it is how the app itself will file a document
  // without going round through Drive.
  const failure = authoriseSecret(request);
  const bySecret = failure === null;

  if (!bySecret && !(await getSession())) {
    return NextResponse.json(
      { error: 'unauthorised', why: WHY[failure] },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Partial<{
    step: 'open' | 'complete';
    box: string;
    name: string;
    mimeType: string;
    driveFileId: string;
    capturedAt: string;
    docDate: string;
    title: string;
    description: string;
    expires: string;
    sourceFolderId: string;
    email: EmailFacts;
  }>;

  /**
   * Refuse to watch a folder we file into.
   *
   * Pointing the script at a box's own Drive folder is a loop, and a quiet
   * one: each run copies every document back into the folder it is watching,
   * the copy is a new file with a new id so nothing dedupes it, and the next
   * run copies that. It fills a Drive rather than failing, which is the worst
   * way for a mistake to behave. The script sends the folder it read from and
   * this is the one thing it is checked against.
   */
  if (body.sourceFolderId) {
    const [clash] = await db
      .select({ name: boxes.name })
      .from(boxes)
      .where(eq(boxes.driveFolderId, body.sourceFolderId))
      .limit(1);

    if (clash) {
      return NextResponse.json(
        {
          error:
            `That folder is where the app files documents for the “${clash.name}” ` +
            'box, so watching it would copy every document back into itself on ' +
            'every run. Point FOLDERS at the folder you scan into instead.',
        },
        { status: 409 },
      );
    }
  }

  const box = await resolveBox(body.box);
  if (!box) {
    return NextResponse.json(
      { error: 'No box to file this in. Open the Big Box in the app and set it up first.' },
      { status: 409 },
    );
  }

  try {
    if (body.step === 'complete') {
      if (!body.driveFileId) {
        return NextResponse.json({ error: 'No file id.' }, { status: 400 });
      }

      const item = await completeBoxUpload(
        box.id,
        body.driveFileId,
        parseCapturedAt(body.capturedAt),
        /*
         * Present only for a message. Its subject, sender and permalink are
         * things Gmail knows and the rendered HTML does not say reliably,
         * so the bridge reads them there and hands them over rather than
         * having the app guess at them from markup.
         */
        body.email && body.email.subject ? body.email : undefined,
        /*
         * A printed date the caller already knows — a backlog whose filenames
         * carry it. Validated to a bare ISO day, because it goes into a `date`
         * column and a client is not trusted with its shape.
         */
        /^\d{4}-\d{2}-\d{2}$/.test(body.docDate ?? '') ? body.docDate : undefined,
        /*
         * A title and summary the caller already holds — a backlog whose names
         * and Drive descriptions carry them. Supplying a title is what says
         * "do not read this", so it is bounded here rather than trusted: a
         * title is a line and a summary is a paragraph, and neither is a place
         * to put a novel.
         */
        body.title
          ? {
              title: String(body.title).slice(0, 300),
              description: body.description
                ? String(body.description).slice(0, 4000)
                : undefined,
            }
          : undefined,
      );

      // Applied after the row exists rather than threaded through the insert:
      // the same action the document pane calls, so there is one rule about
      // what a valid expiry is and one place it is enforced.
      if (body.expires) await setDocumentExpiry(item.id, body.expires);

      return NextResponse.json({ ok: true, id: item.id, name: item.name });
    }

    if (!body.name) {
      return NextResponse.json({ error: 'No filename.' }, { status: 400 });
    }

    /**
     * Who is about to send the bytes.
     *
     * Drive binds the upload session to the origin that opened it: a browser's
     * PUT is refused unless the session carries its origin, and a script's PUT
     * carries no Origin at all and is accepted regardless. The secret means the
     * script; a session means a browser, whose origin is taken from the request
     * so localhost, previews and production are all right for free.
     */
    const origin = bySecret
      ? null
      : (request.headers.get('origin') ?? new URL(request.url).origin);

    const uploadUrl = await startBoxUpload(
      box.id,
      body.name,
      body.mimeType ?? '',
      origin,
    );
    return NextResponse.json({ ok: true, uploadUrl, box: box.name, boxId: box.id });
  } catch (error) {
    if (error instanceof BoxError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof GoogleAuthError) return disconnected('filing will work again');

    console.error('box ingest failed', error);
    return NextResponse.json(
      { error: 'Drive refused that. Check the Google page.' },
      { status: 502 },
    );
  }
}

/**
 * The date the scan was made, where the caller knows it.
 *
 * Importing a backlog should file each document under the day it arrived, not
 * bury three years of letters under today. A date in the future or before
 * Drive existed is a parsing accident rather than a fact, so it's ignored and
 * the row falls back to now.
 */
function parseCapturedAt(value: string | undefined): Date | undefined {
  if (!value) return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  const tooOld = date.getTime() < Date.UTC(2005, 0, 1);
  const inFuture = date.getTime() > Date.now() + 24 * 60 * 60 * 1000;

  return tooOld || inFuture ? undefined : date;
}
