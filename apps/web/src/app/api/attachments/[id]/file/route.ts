import { attachments, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { downloadFile } from '@/lib/google/client';

export const dynamic = 'force-dynamic';

/**
 * Serve an attachment's bytes from Drive, through us.
 *
 * Drive is not a CDN and its download URLs are not embeddable — they need
 * Google cookies the app can't rely on and don't survive an `<img>` or an
 * `<iframe>`. Proxying puts the file on our own origin, which is what makes a
 * PDF render in a pane instead of bouncing you to another tab.
 *
 * The session gate is the only authorisation there is: an attachment id is a
 * uuid, but a guessable-looking URL is not an access control.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireSession();

  const { id } = await params;

  const [row] = await db
    .select({
      driveFileId: attachments.driveFileId,
      name: attachments.name,
      mimeType: attachments.mimeType,
    })
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);

  if (!row?.driveFileId) {
    return NextResponse.json({ error: 'No such attachment.' }, { status: 404 });
  }

  const range = request.headers.get('range');
  const upstream = await downloadFile(row.driveFileId, range);

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: 'Drive would not return that file.' },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const headers = new Headers({
    'Content-Type': row.mimeType || 'application/octet-stream',
    // `inline` so the browser renders it in the pane rather than downloading
    // it. The filename is quoted because it is user input.
    'Content-Disposition': `inline; filename="${row.name.replace(/"/g, '')}"`,
    // Private: this is one person's file behind one person's session, and it
    // must never be held by a shared cache.
    'Cache-Control': 'private, max-age=3600',
  });

  // A media element opens with a range request and waits for a range answer.
  // Ignoring it left <audio> stalled with no duration at all — the clip was
  // being served in full and the player was still waiting. Passing the range
  // through to Drive and handing back its 206 is what makes a voice note play,
  // and what makes the timeline draggable rather than decorative.
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);

  // Advertise range support even on a full response, so the player knows it
  // may seek later rather than deciding up front that it cannot.
  headers.set('Accept-Ranges', 'bytes');

  const contentRange = upstream.headers.get('content-range');
  if (contentRange) headers.set('Content-Range', contentRange);

  // Buffered, not streamed. Uploads are capped at 4 MB, so there is nothing to
  // gain by streaming, and handing the runtime a complete body means it sets
  // the framing itself instead of a declared Content-Length sitting alongside
  // a chunked transfer — a mismatch `fetch` tolerates and a media element does
  // not.
  const body = await upstream.arrayBuffer();
  headers.set('Content-Length', String(body.byteLength));

  return new NextResponse(body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}
