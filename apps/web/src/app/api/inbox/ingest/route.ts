import { NextResponse } from 'next/server';
import { authoriseBoxRequest } from '@/lib/box/auth';
import {
  AttachmentError,
  completeInboxUpload,
  startInboxUpload,
} from '@/lib/google/attachments';
import { GoogleAuthError } from '@/lib/auth/token';
import { disconnected } from '@/lib/google/serve';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
/** Opening a Drive session and reading the file back are both Google calls. */
export const maxDuration = 60;

/**
 * The scanner's other destination: the inbox rather than a box.
 *
 * The bridge could only ever say "keep this". Every folder it watches feeds a
 * box, and a box is for keeping — but a good half of what goes through a
 * scanner is not a thing to file, it is a thing to *do*. A letter from the
 * council is a to-do with a piece of paper attached, and the only way to get
 * one in was to file it in a box and clarify it back out, which is the model
 * upside down: the inbox exists to be emptied, a box exists to be kept, and
 * they meet at `box_item_links` and nowhere else.
 *
 * Deliberately its own route rather than a `destination` on `/api/box/ingest`.
 * That one resolves a box, refuses a folder the app files into, carries the
 * email facts and the classifier's title, and queues a reading — none of which
 * means anything here. A capture is not classified; deciding what it is *is*
 * what clarifying does, later, by hand.
 *
 * The same two steps and the same secret, because it is the same caller: the
 * script opens a Drive session, PUTs the bytes straight to Google, and asks us
 * to write it down. The bytes never pass through here, so Vercel's body cap
 * never applies.
 */
export async function POST(request: Request) {
  const allowed = await authoriseBoxRequest(request);
  if (!allowed.ok) return allowed.response;

  // Which of the two it was decides whether Drive binds the upload session to
  // a browser's origin or leaves it open for a script that sends none.
  const { bySecret } = allowed;

  const body = (await request.json().catch(() => ({}))) as Partial<{
    step: 'open' | 'complete';
    name: string;
    mimeType: string;
    driveFileId: string;
    capturedAt: string;
  }>;

  try {
    if (body.step === 'complete') {
      if (!body.driveFileId) {
        return NextResponse.json({ error: 'No file id.' }, { status: 400 });
      }
      if (!body.name) {
        return NextResponse.json({ error: 'No filename.' }, { status: 400 });
      }

      const capture = await completeInboxUpload(
        body.driveFileId,
        body.name,
        parseCapturedAt(body.capturedAt),
      );

      // The count in the sidebar is on every page, so this is the layout.
      revalidatePath('/', 'layout');

      return NextResponse.json({ ok: true, id: capture.id, name: capture.name });
    }

    if (!body.name) {
      return NextResponse.json({ error: 'No filename.' }, { status: 400 });
    }

    /*
     * Who is about to send the bytes.
     *
     * Drive binds the session to the origin that opened it and enforces it
     * with CORS: a browser's PUT is refused unless the session carries its
     * origin, and a script's PUT carries no `Origin` at all and is accepted
     * whatever the session was opened with. The secret means the script.
     */
    const origin = bySecret
      ? null
      : (request.headers.get('origin') ?? new URL(request.url).origin);

    const uploadUrl = await startInboxUpload(
      body.name,
      body.mimeType ?? '',
      origin,
    );

    return NextResponse.json({ ok: true, uploadUrl });
  } catch (error) {
    if (error instanceof AttachmentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof GoogleAuthError) return disconnected('scanning will work again');

    console.error('inbox ingest failed', error);
    return NextResponse.json(
      { error: 'Drive refused that. Check the Google page.' },
      { status: 502 },
    );
  }
}

/**
 * When the scan was made, where the caller knows it.
 *
 * The same rails the box's front door uses: a date in the future or before
 * Drive existed is a parsing accident rather than a fact, so it is ignored and
 * the capture falls back to now. It matters less here than in a box — the
 * inbox is a queue to be emptied rather than a timeline — but bringing a
 * backlog across should still put the oldest thing first, which is the order
 * an inbox is worked through.
 */
function parseCapturedAt(value: string | undefined): Date | undefined {
  if (!value) return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;

  const tooOld = date.getTime() < Date.UTC(2005, 0, 1);
  const inFuture = date.getTime() > Date.now() + 24 * 60 * 60 * 1000;

  return tooOld || inFuture ? undefined : date;
}
