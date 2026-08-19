import { attachments, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { serveDriveFile } from '@/lib/google/serve';

export const dynamic = 'force-dynamic';

/**
 * An attachment's bytes.
 *
 * The session gate is the only authorisation there is: an attachment id is a
 * uuid, but a guessable-looking URL is not an access control. How the bytes
 * are sent — ranges, disposition, caching — lives in `serveDriveFile`, which
 * Big Box documents use too.
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

  return serveDriveFile({ ...row, driveFileId: row.driveFileId }, request);
}
