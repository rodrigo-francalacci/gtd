import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import {
  exchangeCode,
  fetchEmail,
  googleConfig,
  redirectUri,
  storeGrant,
} from '@/lib/auth/google';
import { createSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function fail(request: Request, reason: string) {
  const url = new URL('/signin', request.url);
  url.searchParams.set('error', reason);

  const response = NextResponse.redirect(url);
  response.cookies.delete('gtd_oauth_state');
  response.cookies.delete('gtd_oauth_verifier');
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  // The user declined, or Google refused.
  if (url.searchParams.get('error')) return fail(request, 'denied');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const expectedState = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)gtd_oauth_state=([^;]+)/)?.[1];
  const verifier = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)gtd_oauth_verifier=([^;]+)/)?.[1];

  if (!code || !state || !expectedState || !verifier) return fail(request, 'missing');
  if (!equal(state, expectedState)) return fail(request, 'state');

  let email: string | null;
  try {
    const tokens = await exchangeCode({
      code,
      verifier,
      redirectUri: redirectUri(request),
    });

    email = await fetchEmail(tokens.access_token);
    if (!email) return fail(request, 'noemail');

    // The allowlist is the whole authorisation model: this is a single-user
    // system, so any other Google account is simply not this user.
    const { allowedEmail } = googleConfig();
    if (email !== allowedEmail.toLowerCase()) return fail(request, 'forbidden');

    await storeGrant(email, tokens);
  } catch (error) {
    console.error('[auth] callback failed', error);
    return fail(request, 'exchange');
  }

  await createSession(email);

  const response = NextResponse.redirect(new URL('/now', request.url));
  response.cookies.delete('gtd_oauth_state');
  response.cookies.delete('gtd_oauth_verifier');
  return response;
}
