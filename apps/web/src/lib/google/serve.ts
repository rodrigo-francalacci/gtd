import 'server-only';

import { NextResponse } from 'next/server';
import { downloadFile } from './client';

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
  const upstream = await downloadFile(file.driveFileId, range);

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: 'Drive would not return that file.' },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const headers = new Headers({
    'Content-Type': file.mimeType || 'application/octet-stream',
    // `inline` so the browser renders it in the pane rather than downloading
    // it. The filename is quoted because it is user input.
    'Content-Disposition': `inline; filename="${file.name.replace(/"/g, '')}"`,
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
