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
  _request: Request,
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

  const upstream = await downloadFile(row.driveFileId);

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: 'Drive would not return that file.' },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': row.mimeType || 'application/octet-stream',
      // `inline` so the browser renders it in the pane rather than downloading
      // it. The filename is quoted because it is user input.
      'Content-Disposition': `inline; filename="${row.name.replace(/"/g, '')}"`,
      // Private: this is one person's file behind one person's session, and it
      // must never be held by a shared cache.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
