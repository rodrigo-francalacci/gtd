import 'server-only';

import { SINGLETON, db, googleAccounts } from '@gtd/db';
import { createHash, randomBytes } from 'node:crypto';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/**
 * Identity only, for now. Drive and Gmail scopes get added later through
 * incremental authorisation, so the first consent screen stays modest and
 * doesn't depend on APIs that aren't enabled yet.
 */
export const IDENTITY_SCOPES = ['openid', 'email', 'profile'];

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const allowedEmail = process.env.AUTH_ALLOWED_EMAIL;

  if (!clientId || !clientSecret || !allowedEmail) {
    throw new Error(
      'Google sign-in is not configured. Set GOOGLE_CLIENT_ID, ' +
        'GOOGLE_CLIENT_SECRET and AUTH_ALLOWED_EMAIL.',
    );
  }

  return { clientId, clientSecret, allowedEmail };
}

export function isConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.AUTH_ALLOWED_EMAIL,
  );
}

/**
 * The redirect URI must match Google's registered value exactly, so it is
 * derived from the request the user actually arrived on rather than guessed —
 * this app runs on localhost:3000, localhost:3001 and Vercel.
 */
export function redirectUri(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');

  const origin =
    forwardedHost && forwardedProto
      ? `${forwardedProto}://${forwardedHost}`
      : url.origin;

  return `${origin}/api/auth/callback/google`;
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** PKCE S256: the verifier is kept in a cookie, only its hash is sent. */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function authorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  verifier: string;
  scopes: string[];
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: options.scopes.join(' '),
    state: options.state,
    code_challenge: codeChallenge(options.verifier),
    code_challenge_method: 'S256',
    // offline + consent is what makes Google return a refresh token, which
    // the Drive and Gmail work will need to act without the user present.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });

  return `${AUTH_ENDPOINT}?${params}`;
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
};

export async function exchangeCode(options: {
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const { clientId, clientSecret } = googleConfig();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: options.code,
      code_verifier: options.verifier,
      grant_type: 'authorization_code',
      redirect_uri: options.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as TokenResponse;
}

/**
 * Fetch the profile with the access token rather than decoding the id_token
 * locally. Verifying a JWT signature properly means fetching and caching
 * Google's JWKS; asking Google who the token belongs to is simpler and just
 * as trustworthy, because the answer comes over TLS straight from them.
 */
export async function fetchEmail(accessToken: string): Promise<string | null> {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return null;

  const profile = (await response.json()) as {
    email?: string;
    email_verified?: boolean;
  };

  if (!profile.email || profile.email_verified === false) return null;
  return profile.email.toLowerCase();
}

/**
 * Persist the grant.
 *
 * Google returns a refresh token only on first consent, so a later response
 * without one must not wipe the stored value — that would silently break
 * background sync.
 */
export async function storeGrant(email: string, tokens: TokenResponse): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  const shared = {
    email,
    accessToken: tokens.access_token,
    expiresAt,
    scope: tokens.scope ?? null,
    updatedAt: new Date(),
  };

  await db
    .insert(googleAccounts)
    .values({
      id: SINGLETON,
      ...shared,
      refreshToken: tokens.refresh_token ?? null,
    })
    .onConflictDoUpdate({
      target: googleAccounts.id,
      set: {
        ...shared,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      },
    });
}
