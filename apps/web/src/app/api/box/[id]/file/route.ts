import { boxItems, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { saveTextRoute } from '@/lib/google/save-route';
import { serveDriveFile } from '@/lib/google/serve';
import { saveBoxItemText } from '@/lib/google/text-files';

export const dynamic = 'force-dynamic';

/**
 * A Big Box document's bytes, on our own origin so the preview pane can render
 * it. Same reasoning and same code path as an attachment's file — only the
 * table it looks the id up in differs.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireSession();

  const { id } = await params;

  const [row] = await db
    .select({
      driveFileId: boxItems.driveFileId,
      name: boxItems.name,
      mimeType: boxItems.mimeType,
    })
    .from(boxItems)
    .where(eq(boxItems.id, id))
    .limit(1);

  if (!row?.driveFileId) {
    return NextResponse.json({ error: 'No such document.' }, { status: 404 });
  }

  return serveDriveFile({ ...row, driveFileId: row.driveFileId }, request);
}

/**
 * Write a document's text back, for the formats the preview pane can edit.
 *
 * Same route shape as an attachment, one table along. A box is for keeping
 * things rather than working on them, so this will be used far less here —
 * but a note written into a box as markdown is exactly the kind of thing you
 * come back and add a line to, and refusing that would make the box the one
 * place a document goes to be read-only.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return saveTextRoute(
    request,
    (text) => saveBoxItemText(id, text),
    'No such document.',
  );
}
