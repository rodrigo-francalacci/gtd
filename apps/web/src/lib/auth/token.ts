import 'server-only';

import { SINGLETON, db, googleAccounts } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { googleConfig } from './google';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Refresh a minute early rather than racing the expiry. */
const SKEW_MS = 60_000;

export type Grant = {
  email: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
};

export async function getGrant(): Promise<Grant | null> {
  const [row] = await db
    .select({
      email: googleAccounts.email,
      accessToken: googleAccounts.accessToken,
      refreshToken: googleAccounts.refreshToken,
      expiresAt: googleAccounts.expiresAt,
      scope: googleAccounts.scope,
    })
    .from(googleAccounts)
    .where(eq(googleAccounts.id, SINGLETON))
    .limit(1);

  return row ?? null;
}

export class GoogleAuthError extends Error {}

/**
 * A usable access token, refreshing if the stored one has expired.
 *
 * Access tokens last an hour, so anything running from a cron job an hour
 * after you last signed in would fail without this. The refresh token is what
 * makes the app able to act while you're not present, which is the whole
 * point of doing sync in the background.
 */
export async function getAccessToken(): Promise<string> {
  const grant = await getGrant();

  if (!grant) {
    throw new GoogleAuthError('No Google account connected.');
  }

  const stillValid =
    grant.accessToken &&
    grant.expiresAt &&
    grant.expiresAt.getTime() - SKEW_MS > Date.now();

  if (stillValid) return grant.accessToken!;

  if (!grant.refreshToken) {
    throw new GoogleAuthError(
      'The Google access token has expired and no refresh token is stored. Reconnect Google.',
    );
  }

  const { clientId, clientSecret } = googleConfig();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: grant.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    // A revoked or expired refresh token cannot be recovered from here; the
    // user has to consent again, so say that rather than retrying forever.
    throw new GoogleAuthError(
      `Refreshing the Google token failed (${response.status}). Reconnect Google.`,
    );
  }

  const tokens = (await response.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
  };

  await db
    .update(googleAccounts)
    .set({
      accessToken: tokens.access_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      // A refresh response omits refresh_token; never overwrite ours with null.
      ...(tokens.scope ? { scope: tokens.scope } : {}),
      updatedAt: new Date(),
    })
    .where(eq(googleAccounts.id, SINGLETON));

  return tokens.access_token;
}
