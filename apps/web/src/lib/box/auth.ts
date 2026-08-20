import 'server-only';

import { timingSafeEqual } from 'node:crypto';

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
