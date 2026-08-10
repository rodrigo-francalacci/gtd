import { NextResponse } from 'next/server';
import { destroySession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * POST only. A GET sign-out can be triggered by any page that embeds the URL
 * as an image or link, which makes logging someone out a one-click prank.
 */
export async function POST(request: Request) {
  await destroySession();
  return NextResponse.redirect(new URL('/signin', request.url), { status: 303 });
}
