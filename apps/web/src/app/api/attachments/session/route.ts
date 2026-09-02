import { NextResponse } from 'next/server';
import type { AttachmentParentType } from '@gtd/db';
import { apiSession } from '@/lib/auth/session';
import { AttachmentError, startUploadSession } from '@/lib/google/attachments';
import { PARENT_TYPES } from '@/lib/upload';

import { GoogleAuthError } from '@/lib/auth/token';
import { disconnected } from '@/lib/google/serve';

export const dynamic = 'force-dynamic';

/**
 * Open a Drive upload session for the browser.
 *
 * Carries no bytes — only a filename and a type — so it is nowhere near
 * Vercel's body cap. The bytes go from the browser straight to the URL this
 * returns, which is exactly why a 21 MB book can be attached at all.
 */
export async function POST(request: Request) {
  const denied = await apiSession();
  if (denied) return denied;

  const { parentType, parentId, name, mimeType } = (await request
    .json()
    .catch(() => ({}))) as Partial<{
    parentType: string;
    parentId: string;
    name: string;
    mimeType: string;
  }>;

  if (
    !PARENT_TYPES.includes(parentType as AttachmentParentType) ||
    !parentId ||
    !name
  ) {
    return NextResponse.json({ error: 'Bad attachment target.' }, { status: 400 });
  }

  /**
   * The browser's own origin, which the Drive session is bound to. Taken from
   * the request rather than configured, so it is right on localhost, on a
   * preview deployment and in production without three ways to get it wrong.
   * Same-origin requests may omit `Origin`, hence the fall back to the URL the
   * request actually arrived on.
   */
  const origin = request.headers.get('origin') ?? new URL(request.url).origin;

  try {
    const uploadUrl = await startUploadSession(
      parentType as AttachmentParentType,
      parentId,
      name,
      mimeType ?? '',
      origin,
    );

    return NextResponse.json({ uploadUrl });
  } catch (error) {
    if (error instanceof AttachmentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof GoogleAuthError) return disconnected('this upload will work again');

    console.error('could not open a Drive upload session', error);
    return NextResponse.json(
      { error: 'Drive would not start the upload. Check the Google page.' },
      { status: 502 },
    );
  }
}
