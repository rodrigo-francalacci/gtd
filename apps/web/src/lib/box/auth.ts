import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';

/**
 * Who may drive the Big Box from outside the browser.
 *
 * The bridge script holds a shared secret; a person holds a session. Both
 * reach the ingest route, and both reach the read route now that the script
 * asks for each document to be read as it files it.
 */

/**
 * Why the caller isn't authorised, which is not the same question as whether.
 *
 * A bare "unauthorised" is true and useless: a missing environment variable on
 * this end and a mistyped secret on the other look identical from Apps Script,
 * and the first is by far the more likely — Vercel only applies a new variable
 * to deployments made *after* it was added, so adding it and not redeploying
 * leaves the app running without it. Saying which of the two it is costs
 * nothing worth protecting: that a secret is configured is not the secret.
 */
export type AuthFailure = 'unconfigured' | 'missing-header' | 'mismatch';

export function authoriseSecret(request: Request): AuthFailure | null {
  // Trimmed on both sides. A secret pasted into Vercel or into Script
  // Properties with a trailing newline is invisible in every UI that shows it
  // and fails the length check before the comparison even runs.
  const secret = process.env.BOX_INGEST_SECRET?.trim();
  if (!secret) return 'unconfigured';

  const header = (request.headers.get('authorization') ?? '').trim();
  if (!header) return 'missing-header';

  const expected = `Bearer ${secret}`;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? null : 'mismatch';
}

export const WHY: Record<AuthFailure, string> = {
  unconfigured:
    'This app has no BOX_INGEST_SECRET set. Add it in Vercel (Settings → ' +
    'Environment Variables) and redeploy — a variable added after a build is ' +
    'not visible to that build.',
  'missing-header':
    'No Authorization header arrived. The script sends it as ' +
    '`Authorization: Bearer <secret>`.',
  mismatch:
    'That secret does not match this app’s BOX_INGEST_SECRET. Check for a ' +
    'stray space or newline at either end, and that the value was set for the ' +
    'environment you are calling.',
};

/**
 * The whole question, answered once, so it cannot be asked backwards.
 *
 * `authoriseSecret` returns the *reason* a caller was refused and `null` when
 * it was fine — which reads naturally at the call site and inverts silently the
 * moment somebody treats it as a boolean. Two of the three routes did exactly
 * that: `if (!authoriseSecret(request) && !session)`. A correct secret returns
 * null, so `!null` is true and the script was refused; a *wrong* secret returns
 * a string, so `!string` is false and the request sailed through. Backwards in
 * both directions at once, and the failing half is the half you notice.
 *
 * So the shape changes rather than the call sites being corrected one by one. A
 * response comes back, or permission does; there is no truthiness to get wrong,
 * and a route that forgets to check gets a type error rather than an open door.
 */
export async function authoriseBoxRequest(
  request: Request,
): Promise<
  | { ok: true; bySecret: boolean }
  | { ok: false; response: NextResponse }
> {
  const failure = authoriseSecret(request);
  if (failure === null) return { ok: true, bySecret: true };

  // A person, rather than the script. Their session is the whole authorisation.
  if (await getSession()) return { ok: true, bySecret: false };

  return {
    ok: false,
    response: NextResponse.json(
      // The one reason, not the whole table. Sent as the table, an Apps Script
      // log showed every explanation at once and led with the least likely —
      // so a working secret was reported as an unset one.
      { error: 'unauthorised', why: WHY[failure] },
      { status: 401 },
    ),
  };
}
