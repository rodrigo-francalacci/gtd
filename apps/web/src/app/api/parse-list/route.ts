import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/session';
import { readHandwrittenList, UnreadablePage } from '@/lib/ai/handwriting';
import { MAX_PHOTO_BYTES, type ListPhotoKind } from '@/lib/list-photo';

/**
 * Read a photographed list and hand back what it says. Writes nothing.
 *
 * **The bytes stop here.** They are never put in Drive, never attached to a
 * row, never written to disk — the reply is text, and the photograph is gone
 * the moment this function returns. That is the whole of "delete the source
 * image after parsing": there is nothing left to delete, so there is no
 * sweep to write, nothing to leak if the parse is abandoned half way, and no
 * second copy of a page you already have on paper.
 *
 * A route rather than a Server Action for the reason the box's reading is one:
 * `maxDuration` is a route-segment setting, and a page takes the better part
 * of half a minute to read. An action also caps its body at 1 MB, which a
 * photograph passes on the way in.
 */
export const dynamic = 'force-dynamic';

/** Measured: 17–35 seconds a page, so the default would cut real reads off. */
export const maxDuration = 60;

const KINDS: ListPhotoKind[] = ['now', 'project', 'purchases', 'list', 'inbox'];

export async function POST(request: Request) {
  /*
   * `apiSession`, never `requireSession`: a redirect to /signin reaches a
   * fetch as 200 and a page of HTML, which reads as a broken parse.
   *
   * It hands back a *refusal* or null, so this reads `if (denied) return
   * denied` — written the other way round it refuses exactly the person who
   * is signed in, which is how this route first behaved: every parse came
   * back "Not signed in." from a page that had just rendered their own list.
   * The same inversion `authoriseSecret` is on record for.
   */
  const denied = await apiSession();
  if (denied) return denied;

  const asked = new URL(request.url).searchParams.get('kind') ?? '';
  const kind = KINDS.includes(asked as ListPhotoKind) ? (asked as ListPhotoKind) : null;
  if (!kind) return NextResponse.json({ error: 'Unknown destination.' }, { status: 400 });

  const mimeType = request.headers.get('content-type') ?? '';
  if (!mimeType.startsWith('image/')) {
    return NextResponse.json({ error: 'That is not an image.' }, { status: 415 });
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: 'The photo arrived empty.' }, { status: 400 });
  }
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    // The browser shrinks before sending, so this is a rail rather than a
    // limit anybody meets by holding the camera closer.
    return NextResponse.json({ error: 'That photo is too large to read.' }, { status: 413 });
  }

  try {
    const read = await readHandwrittenList(bytes, mimeType.split(';')[0], kind);
    return NextResponse.json(read);
  } catch (error) {
    const message =
      error instanceof UnreadablePage
        ? error.message
        : 'The reader could not be reached.';
    console.error('[parse-list]', error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
