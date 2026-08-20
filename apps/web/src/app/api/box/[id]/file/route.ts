import { boxItems, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { serveDriveFile } from '@/lib/google/serve';

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
