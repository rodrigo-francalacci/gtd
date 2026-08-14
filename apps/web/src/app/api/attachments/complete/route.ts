import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import type { AttachmentParentType } from '@gtd/db';
import { requireSession } from '@/lib/auth/session';
import { AttachmentError, completeUpload } from '@/lib/google/attachments';
import { PARENT_TYPES } from '@/lib/upload';

export const dynamic = 'force-dynamic';

/**
 * Record a file the browser has finished uploading.
 *
 * Takes an id and nothing else worth trusting: the name, type and size are
 * read back from Drive, so the row cannot disagree with the file.
 */
export async function POST(request: Request) {
  await requireSession();

  const { parentType, parentId, driveFileId } = (await request
    .json()
    .catch(() => ({}))) as Partial<{
    parentType: string;
    parentId: string;
    driveFileId: string;
  }>;

  if (
    !PARENT_TYPES.includes(parentType as AttachmentParentType) ||
    !parentId ||
    !driveFileId
  ) {
    return NextResponse.json({ error: 'Bad attachment target.' }, { status: 400 });
  }

  try {
    const attachment = await completeUpload(
      parentType as AttachmentParentType,
      parentId,
      driveFileId,
    );

    revalidatePath('/', 'layout');
    return NextResponse.json({ ok: true, ...attachment });
  } catch (error) {
    if (error instanceof AttachmentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('could not record an uploaded attachment', error);
    return NextResponse.json(
      { error: 'The file uploaded but could not be recorded.' },
      { status: 502 },
    );
  }
}
