import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import type { AttachmentParentType } from '@gtd/db';
import { requireSession } from '@/lib/auth/session';
import { AttachmentError, uploadAttachment } from '@/lib/google/attachments';

export const dynamic = 'force-dynamic';
/** A Drive upload over a domestic connection is slower than a page render. */
export const maxDuration = 60;

const PARENT_TYPES: AttachmentParentType[] = ['project', 'action', 'list_item'];

/**
 * A route handler rather than a Server Action: actions cap the request body at
 * 1 MB by default and are the wrong shape for a file anyway — this needs to
 * report progress and failures per file, which a form post gives for free.
 */
export async function POST(request: Request) {
  await requireSession();

  const form = await request.formData();
  const parentType = String(form.get('parentType') ?? '');
  const parentId = String(form.get('parentId') ?? '');
  const file = form.get('file');

  if (!PARENT_TYPES.includes(parentType as AttachmentParentType) || !parentId) {
    return NextResponse.json({ error: 'Bad attachment target.' }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file was sent.' }, { status: 400 });
  }

  try {
    const attachment = await uploadAttachment(
      parentType as AttachmentParentType,
      parentId,
      file,
    );

    // The pane that triggered this renders the attachment list on the server.
    revalidatePath('/', 'layout');

    return NextResponse.json({ ok: true, ...attachment });
  } catch (error) {
    if (error instanceof AttachmentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('attachment upload failed', error);
    return NextResponse.json(
      { error: 'Drive rejected the upload. Check the Google page.' },
      { status: 502 },
    );
  }
}
