import { attachments, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { saveTextRoute } from '@/lib/google/save-route';
import { serveDriveFile } from '@/lib/google/serve';
import { saveAttachmentText } from '@/lib/google/text-files';

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

/**
 * Write an attachment's text back.
 *
 * The mirror of the GET above: markdown, LaTeX and HTML are edited in the
 * preview pane, and this is where the edit lands. Only text formats are
 * accepted — a PUT against a PDF is refused by `saveAttachmentText` rather
 * than being allowed to overwrite it with a string.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return saveTextRoute(
    request,
    (text) => saveAttachmentText(id, text),
    'No such attachment.',
  );
}
