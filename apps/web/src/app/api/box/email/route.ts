import { NextResponse } from 'next/server';
import { WHY, authoriseSecret } from '@/lib/box/auth';
import { claimEmailRequests, resolveEmailRequest } from '@/lib/box/email-requests';

export const dynamic = 'force-dynamic';

/**
 * The queue of messages the bridge has been asked to fetch.
 *
 * Two steps, and only the script uses either: `claim` hands out the pending
 * requests and `resolve` reports what became of one. Creating a request is a
 * Server Action from the app, because that is a thing *you* do and a Server
 * Action is not a public API.
 *
 * Secret only, no session fallback. The ingest route accepts a session too, and
 * that earns its keep — it is how the app itself files a document and how the
 * endpoint gets exercised during setup. There is nothing here for a browser to
 * do: it cannot read Gmail, which is the entire reason this queue exists.
 */
export async function POST(request: Request) {
  const failure = authoriseSecret(request);

  if (failure !== null) {
    return NextResponse.json(
      { error: 'unauthorised', why: WHY[failure] },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Partial<{
    step: 'claim' | 'resolve';
    limit: number;
    id: string;
    /**
     * The entries the script filed, not merely how many.
     *
     * A count is enough to close the request and not enough to cite the
     * message on the thing it was asked from, which is most of the point of
     * asking from there.
     */
    itemIds: string[];
    /** What an older bridge sends instead. Kept so it is noticed, not lost. */
    filed: number;
    note: string;
  }>;

  if (body.step === 'claim') {
    const requests = await claimEmailRequests(
      Math.min(Math.max(body.limit ?? 10, 1), 50),
    );
    return NextResponse.json({ ok: true, requests });
  }

  if (body.step === 'resolve') {
    if (!body.id) {
      return NextResponse.json({ error: 'No request id.' }, { status: 400 });
    }

    await resolveEmailRequest(
      body.id,
      Array.isArray(body.itemIds) ? body.itemIds.filter((v) => typeof v === 'string') : [],
      body.note?.slice(0, 500) ?? null,
      Number.isFinite(body.filed) ? Number(body.filed) : 0,
    );

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown step.' }, { status: 400 });
}
