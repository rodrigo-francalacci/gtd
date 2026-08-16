import { NextResponse } from 'next/server';
import { captureInboxItem } from '@/lib/actions';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Capture from outside the app — currently the browser extension's sidebar.
 *
 * A route rather than the Server Action, because Server Actions speak a private
 * protocol between the framework's own client and server and are not a public
 * API. This is the public shape: JSON in, JSON out.
 *
 * `getSession` rather than `requireSession`, because the latter redirects to
 * `/signin` and a redirect is useless to a caller expecting data. A 401 is
 * something the sidebar can act on — it falls back to opening the capture page
 * as a normal navigation, which always carries the cookie.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { text, note } = (await request.json().catch(() => ({}))) as Partial<{
    text: string;
    note: string;
  }>;

  const title = (text ?? '').trim();
  const body = (note ?? '').trim();
  if (!title && !body) {
    return NextResponse.json({ error: 'Nothing to capture.' }, { status: 400 });
  }

  // The same one-raw_text convention the capture boxes use: first line the
  // title, blank line, then the note. Clarify reads it the same way whatever
  // wrote it, so an extension capture is not a second kind of capture.
  const form = new FormData();
  form.set('rawText', body ? `${title}\n\n${body}` : title);
  form.set('rawType', 'text');

  const item = await captureInboxItem(form);
  if (!item) {
    return NextResponse.json({ error: 'Nothing to capture.' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: item.id });
}
