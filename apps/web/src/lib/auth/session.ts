import 'server-only';

import { db, sessions } from '@gtd/db';
import { and, eq, gt, lt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'gtd_session';
const SESSION_DAYS = 30;

/** 256 bits of entropy — this value is the bearer token. */
function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(email: string): Promise<void> {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);

  await db.insert(sessions).values({ id, email, expiresAt });

  const store = await cookies();
  store.set(SESSION_COOKIE, id, {
    httpOnly: true,
    // Lax rather than Strict: the OAuth callback is a cross-site redirect
    // back from Google, and Strict would withhold the cookie on that first
    // navigation. Lax still blocks it on cross-site POSTs, which is what
    // matters for Server Actions.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  // Opportunistic tidy-up; a single-user app never accumulates many.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export type Session = { email: string };

/** The current session, or null. Never throws. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const [row] = await db
    .select({ email: sessions.email })
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
}

/**
 * Assert a session, or stop the request.
 *
 * Called by the root layout for reads and at the top of every mutating Server
 * Action. Server Actions are ordinary POST endpoints reachable without ever
 * loading the UI, so gating the layout alone would leave every write open.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/signin');
  return session;
}

/**
 * The session for an API route: a `Response` to return, or null to carry on.
 *
 * `requireSession` redirects to `/signin`, which is right for a page and wrong
 * for a route handler — a caller expecting JSON follows the redirect, gets a
 * 200 of HTML, and reports something baffling. The browser extension found
 * exactly that: an upload failed with no way to tell "you are signed out" from
 * "Drive refused", because both arrived as an unparseable success.
 */
export async function apiSession(): Promise<Response | null> {
  if (await getSession()) return null;

  return Response.json(
    { error: 'Not signed in. Open the app and sign in, then try again.' },
    { status: 401 },
  );
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;

  if (id) await db.delete(sessions).where(eq(sessions.id, id));
  store.delete(SESSION_COOKIE);
}
