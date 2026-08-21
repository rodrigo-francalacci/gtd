import { NextResponse } from 'next/server';
import {
  CALENDAR_SCOPES,
  IDENTITY_SCOPES,
  SYNC_SCOPES,
  authorizeUrl,
  googleConfig,
  randomToken,
  redirectUri,
} from '@/lib/auth/google';

export const dynamic = 'force-dynamic';

const TEN_MINUTES = 60 * 10;

/**
 * Start the OAuth dance.
 *
 * `state` defends against CSRF on the callback and the PKCE verifier against
 * an intercepted authorisation code. Both are stored in short-lived httpOnly
 * cookies so the callback can check what this request generated.
 */
export async function GET(request: Request) {
  const { clientId } = googleConfig();

  /**
   * `?scopes=` asks for more than identity. Google's `include_granted_scopes`
   * makes this incremental: the new grant keeps what was already approved, so
   * signing in for sync doesn't drop identity and adding the calendar doesn't
   * drop either of them.
   *
   *   sync      — Drive and Gmail, what the app needs to file things
   *   calendar  — read-only calendar, which is optional and asked for on its
   *               own so it is never bundled into first sign-in
   */
  const requested = new URL(request.url).searchParams.get('scopes');

  const extra =
    requested === 'sync'
      ? SYNC_SCOPES
      : requested === 'calendar'
        ? CALENDAR_SCOPES
        : [];

  const state = randomToken();
  const verifier = randomToken();

  const url = authorizeUrl({
    clientId,
    redirectUri: redirectUri(request),
    state,
    verifier,
    scopes: [...IDENTITY_SCOPES, ...extra],
  });

  const response = NextResponse.redirect(url);

  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TEN_MINUTES,
  };

  response.cookies.set('gtd_oauth_state', state, options);
  response.cookies.set('gtd_oauth_verifier', verifier, options);

  return response;
}
