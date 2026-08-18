import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { boxes, db } from '@gtd/db';
import { eq, sql } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { BoxError, completeBoxUpload, startBoxUpload } from '@/lib/google/boxes';

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
function authorised(request: Request): boolean {
  const secret = process.env.BOX_INGEST_SECRET;
  if (!secret) return false;

  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

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
  // A signed-in session works too, so the endpoint can be exercised from the
  // browser while setting the script up.
  if (!authorised(request) && !(await getSession())) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Partial<{
    step: 'open' | 'complete';
    box: string;
    name: string;
    mimeType: string;
    driveFileId: string;
    capturedAt: string;
  }>;

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
      );

      return NextResponse.json({ ok: true, id: item.id, name: item.name });
    }

    if (!body.name) {
      return NextResponse.json({ error: 'No filename.' }, { status: 400 });
    }

    const uploadUrl = await startBoxUpload(box.id, body.name, body.mimeType ?? '');
    return NextResponse.json({ ok: true, uploadUrl, box: box.name, boxId: box.id });
  } catch (error) {
    if (error instanceof BoxError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

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
