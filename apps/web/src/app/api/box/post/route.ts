import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/session';
import {
  postBoxLink,
  postBoxLocation,
  postBoxNote,
  setDocumentExpiry,
} from '@/lib/actions';
import { requestEmail } from '@/lib/actions';
import { readEmailPaste } from '@/lib/email-paste';
import { soleUrl } from '@/lib/sole-url';

export const dynamic = 'force-dynamic';

/**
 * Post a note, a link or a place into a box, from outside the app.
 *
 * A route rather than the Server Actions it calls, for the reason `/api/capture`
 * exists: a Server Action speaks a private protocol between the framework's own
 * client and its server, and is not a public API. This is the public shape —
 * JSON in, JSON out — and the actions behind it stay the single place each of
 * those three writes is defined, so the extension cannot drift from the app.
 *
 * Files are not here. An upload is its own three-step path — session, PUT
 * straight to Drive, complete — which `/api/box/ingest` already answers, and
 * routing bytes through this would mean meeting Vercel's 4.5 MB body cap for
 * no gain.
 */
export async function POST(request: Request) {
  const unauthorised = await apiSession();
  if (unauthorised) return unauthorised;

  const body = (await request.json().catch(() => ({}))) as Partial<{
    box: string;
    kind: 'note' | 'link' | 'location';
    expires: string;
    text: string;
    url: string;
    lat: number;
    lng: number;
  }>;

  const boxId = (body.box ?? '').trim();
  if (!boxId) {
    return NextResponse.json({ error: 'Which box?' }, { status: 400 });
  }

  const text = (body.text ?? '').trim();

  /**
   * A message that is only an address becomes a link, exactly as the app's own
   * composer decides it. The caller may say so outright; when it doesn't, the
   * same rule applies here rather than in the extension, so the two can't come
   * to different conclusions about the same pasted string.
   */
  const expires = (body.expires ?? '').trim() || null;

  /**
   * A pasted message identifier is a request for that message, not a link.
   *
   * The same rule and the same reasoning as the app's own composer: anything
   * without your cookies that follows a Gmail address sees the sign-in page, so
   * filing one as a link produces an entry called "Gmail" with a picture of a
   * login form. The extension had no idea about any of this — `readEmailPaste`
   * was wired into the composer and the phone screen and not into the one path
   * the sidebar actually uses — so a message pasted into the sidebar was
   * quietly turned into exactly that useless entry.
   *
   * Here rather than in the extension, for the reason the link rule is here:
   * two places deciding what a pasted string means is two places that can come
   * to different conclusions about it.
   *
   * "Keep this page" on an open message reaches this too, and is refused with a
   * sentence saying what does work — a Gmail permalink holds an id no API
   * accepts. Being told immediately beats a request that fails an hour later,
   * and beats a link entry that never says anything at all.
   */
  const candidate =
    body.url && /^https?:\/\/mail\.google\.com\//i.test(body.url) ? body.url : text;
  const wanted = body.kind === 'location' ? null : readEmailPaste(candidate);

  if (wanted) {
    const asked = await requestEmail(boxId, wanted);

    if (!asked.ok) {
      return NextResponse.json({ error: asked.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, kind: 'email' });
  }

  const kind = body.kind ?? (body.url ? 'link' : soleUrl(text) ? 'link' : 'note');

  try {
    if (kind === 'location') {
      const id = await postBoxLocation(boxId, Number(body.lat), Number(body.lng), text);
      if (expires && id) await setDocumentExpiry(id, expires);
      if (!id) {
        return NextResponse.json({ error: 'That is not a place.' }, { status: 400 });
      }
      return NextResponse.json({ ok: true, id, kind });
    }

    if (kind === 'link') {
      const url = (body.url ?? soleUrl(text) ?? '').trim();
      if (!url) {
        return NextResponse.json({ error: 'No address to keep.' }, { status: 400 });
      }

      // When the address *is* the message there is no remark to keep beside
      // it; when it was given separately, the text is a note about the link.
      const note = soleUrl(text) ? '' : text;
      const id = await postBoxLink(boxId, url, note);
      if (expires && id) await setDocumentExpiry(id, expires);
      return NextResponse.json({ ok: true, id, kind });
    }

    if (!text) {
      return NextResponse.json({ error: 'Nothing to post.' }, { status: 400 });
    }

    const id = await postBoxNote(boxId, text);
    if (expires && id) await setDocumentExpiry(id, expires);
    return NextResponse.json({ ok: true, id, kind: 'note' });
  } catch (error) {
    console.error('box post failed', error);
    return NextResponse.json({ error: 'That did not save.' }, { status: 500 });
  }
}

