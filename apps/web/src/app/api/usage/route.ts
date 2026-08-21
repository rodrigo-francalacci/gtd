import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/session';
import { bumpUsage, isUsableType } from '@/lib/usage';

export const dynamic = 'force-dynamic';

/**
 * "I opened this."
 *
 * A route rather than a Server Action for one reason: it is called with
 * `sendBeacon` from a row that is in the middle of navigating away, and a
 * Server Action cannot be. A beacon is queued by the browser and delivered
 * even though the page is being torn down, which is precisely the moment a
 * click on a list row happens.
 *
 * It answers 204 and says nothing. There is no response worth waiting for —
 * the caller has already gone somewhere else — and a body would only be
 * something for a beacon to ignore.
 *
 * Failure is silent by design. A count that didn't get recorded is a row that
 * sorts one place lower than it might have; there is nothing here worth
 * putting an error in front of somebody for.
 */
export async function POST(request: Request) {
  const unauthorised = await apiSession();
  if (unauthorised) return unauthorised;

  const { type, id } = (await request.json().catch(() => ({}))) as Partial<{
    type: string;
    id: string;
  }>;

  if (!isUsableType(type) || typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'Not something that can be used.' }, { status: 400 });
  }

  try {
    await bumpUsage(type, id);
  } catch {
    // A row deleted between the click and the beacon landing is the ordinary
    // case, not a fault worth reporting to a caller that has gone.
  }

  return new NextResponse(null, { status: 204 });
}
