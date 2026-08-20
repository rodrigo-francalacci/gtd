import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { WHY, authoriseSecret } from '@/lib/box/auth';
import {
  countWaitingDocuments,
  drainBoxQueue,
  requeueBoxItem,
} from '@/lib/box/queue';

export const dynamic = 'force-dynamic';
/** Reading a scan is a download from Drive and a model call, per document. */
export const maxDuration = 60;

/**
 * Read documents now, because "now" is otherwise a day away.
 *
 * The cron is the queue's real driver, and on a Hobby account it may only run
 * daily — Vercel rejects anything more frequent, and rejects it when the
 * deployment is created. So a document filed this morning would sit untitled
 * until tomorrow, which made the pane's "Read it now" button a lie: it queued
 * the job and nothing came to run it. This is what makes the label true.
 *
 * A route rather than a Server Action because it needs its own `maxDuration`:
 * a scan is a Drive download plus a model call, and the page's default is far
 * too short to hold one, let alone a batch.
 *
 * `BATCH` keeps a single request comfortably inside that minute. The client
 * calls again while `remaining` is non-zero, so a backlog of forty drains in
 * a series of short requests instead of one that dies at the limit.
 */
const BATCH = 3;

export async function POST(request: Request) {
  // A session, or the bridge script's secret: the script asks for each
  // document to be read the moment it files it, so it has to get in here too.
  const failure = authoriseSecret(request);
  if (failure !== null && !(await getSession())) {
    return NextResponse.json(
      { error: 'unauthorised', why: WHY[failure] },
      { status: 401 },
    );
  }

  const { itemId } = (await request.json().catch(() => ({}))) as {
    itemId?: string;
  };

  // Asked for by hand: put it back in the queue first, so a document that
  // previously failed — or was read before its tags existed — is eligible
  // again rather than silently skipped for being `done`.
  if (itemId) await requeueBoxItem(itemId);

  const result = await drainBoxQueue(itemId ? 1 : BATCH, itemId);

  return NextResponse.json({
    ...result,
    remaining: await countWaitingDocuments(),
  });
}
