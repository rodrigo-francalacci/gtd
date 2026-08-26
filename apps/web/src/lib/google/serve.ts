import 'server-only';

import { NextResponse } from 'next/server';
import { GoogleAuthError } from '../auth/token';
import { canonicalMediaType } from '../media-types';
import { downloadFile } from './client';

/**
 * A filename a header can actually carry.
 *
 * HTTP header values are ByteStrings — every character has to fit in a byte —
 * and `new Headers()` does not sanitise, it *throws*. So a file with an em dash
 * in its name took down the whole response with a `TypeError`, which reached
 * the preview pane as a bare 500 and read as "that file would not load". The
 * file was fine. Every file in the app with an accent, a curly quote or a dash
 * in its name was fine, and none of them would open.
 *
 * RFC 6266 has the answer and it is two parameters, not one: `filename` for
 * anything that predates the fix, stripped down to ASCII, and `filename*` in
 * the RFC 5987 form, which every browser in use has preferred for a decade.
 * Between them the name survives intact and the header stays legal.
 */
function filenameParams(name: string): string {
  // Anything outside printable ASCII cannot go in the plain parameter; quotes
  // and backslashes would end it early.
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');

  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Serve a Drive file's bytes from Drive, through us.
 *
 * Drive is not a CDN and its download URLs are not embeddable — they want
 * Google cookies the app can't rely on and don't survive an `<img>` or an
 * `<iframe>`. Proxying puts the file on our own origin, which is what makes a
 * PDF render in a pane instead of bouncing you to another tab.
 *
 * Shared by attachments and by Big Box documents. They are different rows in
 * different tables with different lifetimes, but from here they are the same
 * thing: an id, a name and a type, and Drive holding the bytes. The route
 * decides who may look; this decides how it is sent.
 */
export async function serveDriveFile(
  file: { driveFileId: string; name: string; mimeType: string | null },
  request: Request,
): Promise<NextResponse> {
  const range = request.headers.get('range');

  /**
   * A revoked grant is not a broken file, and must not be reported as one.
   *
   * `getAccessToken` throws when the refresh token has been withdrawn or has
   * expired — Google does that of its own accord, and the only cure is
   * consenting again. Left uncaught it became a bare 500 with an empty body,
   * which the preview pane could only describe as "that file would not load":
   * true of every file in the app at once, and pointing at the file rather
   * than at the one page that can fix it.
   */
  let upstream: Response;
  try {
    upstream = await downloadFile(file.driveFileId, range);
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return NextResponse.json(
        {
          error:
            'Google has disconnected. Reconnect it on the Google page and this ' +
            'file will open again.',
          reconnect: true,
        },
        { status: 401 },
      );
    }
    throw error;
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: 'Drive would not return that file.' },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const headers = new Headers({
    // Normalised, because a file is typed by whatever produced it and for
    // audio that is a mess of aliases a browser does not recognise. See
    // `canonicalMediaType` — an unknown type passes through untouched.
    'Content-Type': canonicalMediaType(file.mimeType) || 'application/octet-stream',
    // `inline` so the browser renders it in the pane rather than downloading
    // it. The filename is quoted because it is user input.
    'Content-Disposition': `inline; ${filenameParams(file.name)}`,
    // Private: this is one person's file behind one person's session, and it
    // must never be held by a shared cache.
    'Cache-Control': 'private, max-age=3600',
  });

  // A media element opens with a range request and waits for a range answer.
  // Ignoring it left <audio> stalled with no duration at all — the clip was
  // being served in full and the player was still waiting. Passing the range
  // through to Drive and handing back its 206 is what makes a voice note play,
  // and what makes the timeline draggable rather than decorative.
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) headers.set('Content-Range', contentRange);

  // Advertise range support even on a full response, so the player knows it
  // may seek later rather than deciding up front that it cannot.
  headers.set('Accept-Ranges', 'bytes');

  // Buffered, not streamed. Handing the runtime a complete body means it sets
  // the framing itself, instead of a declared Content-Length sitting alongside
  // a chunked transfer — a mismatch `fetch` tolerates and a media element does
  // not. A scanned document is a few megabytes; this is not where memory goes.
  const body = await upstream.arrayBuffer();
  headers.set('Content-Length', String(body.byteLength));

  return new NextResponse(body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}
