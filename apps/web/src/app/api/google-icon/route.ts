import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Google's own icon for a file type.
 *
 * The Drive/Gmail navigator lists things this app has no scope to read, and the
 * one thing it can say about each of them is what *kind* of thing it is. Google
 * already has a mark for every one, in the colours anybody who has used Drive
 * recognises without reading: Docs blue, Sheets green, Slides yellow, PDF red.
 * Drawing our own approximations of those would be drawing Google's icons
 * slightly wrong, in a pane whose whole purpose is to look like the place the
 * files actually live.
 *
 * **This is the one place colour is not the app's own semantics.** The rule
 * elsewhere is that colour means `waiting`, `stale` or `selected` and nothing
 * else — but this pane is a window onto somebody else's system, and the colour
 * in it is that system's, not ours. It stops at the window: nothing outside this
 * tree uses these.
 *
 * **Proxied, not linked**, for the reason a link's preview image is: pointing
 * the browser at `drive-thirdparty.googleusercontent.com` would tell that host
 * which project folder is open and when, every time the tree is expanded, from
 * a page that is otherwise entirely first-party.
 *
 * **Not gated on a session, deliberately.** The answer depends only on the query
 * and there is no way to ask it about a user — a mime type in, a picture of a
 * page with a corner turned down out. Gating it would put a database round trip
 * in front of every glyph in a tree of fifty rows, and would make the response
 * `private`, which is exactly wrong for a handful of icons shared by every row
 * and every project.
 */

/** Where they come from. Fixed, so a request can never be aimed elsewhere. */
const UPSTREAM = 'https://drive-thirdparty.googleusercontent.com';

/**
 * A media type and nothing else.
 *
 * The type becomes a path segment, so this is what keeps a query string from
 * becoming a different URL: no `/` beyond the single separator, no dot-dot, no
 * `?`, `#` or `%`. The characters allowed are the ones RFC 6838 allows in a
 * type name, which covers everything Google uses — `vnd.google-apps.document`
 * needs the dots and `folder+shared` needs the plus.
 */
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/i;

/**
 * The sizes Google actually serves.
 *
 * An allowlist rather than a clamp because the service is not a resizer: 16, 32,
 * 64 and 128 all answer, and 24 — a plausible thing to ask for — is a 404. A
 * number we invent would be a broken image at some later date for no reason.
 */
const SIZES = new Set([16, 32, 64, 128]);

/** A single transparent pixel: what to show when there is nothing to show. */
const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Nothing, but politely.
 *
 * A failed fetch must not leave a broken-image glyph down the side of the tree —
 * an empty square reads as "no icon", a broken one reads as "this app is
 * broken". Deliberately uncached, so a blip does not freeze a blank into the
 * browser for the rest of the day.
 */
function blank() {
  return new NextResponse(BLANK, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;

  const type = query.get('type') ?? '';
  if (!MEDIA_TYPE.test(type)) return blank();

  const asked = Number(query.get('size'));
  const size = SIZES.has(asked) ? asked : 32;

  let upstream: Response;

  try {
    upstream = await fetch(`${UPSTREAM}/${size}/type/${encodeURI(type)}`, {
      // Google needs nothing from us to answer, so it is sent nothing.
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return blank();
  }

  if (!upstream.ok) return blank();

  const bytes = await upstream.arrayBuffer();

  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'image/png',
      /*
       * A year, and immutable. The icon for a PDF is the icon for a PDF; this
       * is the rare thing in the app that genuinely cannot go stale, and the
       * tree asks for the same dozen URLs on every project.
       */
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
