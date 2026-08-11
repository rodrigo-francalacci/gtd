import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { drainEnrichmentQueue } from '@/lib/enrich/queue';
import { drainSyncQueue } from '@/lib/google/queue';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
/** Drive and Gmail calls are slow; give the worker room. */
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The background worker. Vercel Cron calls this on a schedule.
 *
 * Authorised either by the cron secret (Vercel sends it as a Bearer token) or
 * by a signed-in session, so the connections page can trigger a run by hand.
 * Without the secret set, only a session works — a public endpoint that hits
 * the Google API on demand would be an obvious way to burn the quota.
 */
export async function GET(request: Request) {
  const bySecret = authorised(request);
  const bySession = bySecret ? null : await getSession();

  if (!bySecret && !bySession) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  // Both queues on one tick. They touch different tables and different APIs,
  // and a second cron entry would be a second thing to forget to configure.
  const [sync, enrich] = await Promise.all([
    drainSyncQueue(),
    drainEnrichmentQueue(),
  ]);

  return NextResponse.json({ ok: true, sync, enrich });
}
