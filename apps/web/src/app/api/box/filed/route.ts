import { NextResponse } from 'next/server';
import { boxItems, db } from '@gtd/db';
import { inArray } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { WHY, authoriseSecret } from '@/lib/box/auth';

export const dynamic = 'force-dynamic';

/**
 * Which of these messages have already been filed?
 *
 * The email bridge used to remember by *consuming* the Gmail label: file the
 * message, take the label off, and a second run finds nothing to do. It worked,
 * and it meant the label you had just put a message into emptied itself — so
 * Gmail could not be browsed the way the Drive folders can, which is the whole
 * point of having a label per box.
 *
 * The app is the record of what has been filed, so the app is the thing to ask.
 * The label stays on the message for ever, exactly like a file stays in its
 * Drive folder, and nothing is filed twice.
 *
 * A batch rather than one call per message: a run looks at every message under
 * every box label, and asking about each in turn would be a round trip per
 * message on a script with a six-minute budget.
 *
 * **Deleting an entry makes its message eligible again**, which is right: the
 * box is the record, and if it is not in the box it has not been filed. That is
 * also what makes a mistaken deletion recoverable — run the bridge again.
 */
export async function POST(request: Request) {
  const bySecret = authoriseSecret(request);

  if (!bySecret && !(await getSession())) {
    return NextResponse.json({ error: WHY }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };

  /*
   * Taken by shape, never trusted: this is called by a script anyone with the
   * secret can edit, and an unbounded `in (...)` is a way to make one query do
   * arbitrary work. Five hundred is far more than a run will ever ask about.
   */
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 500)
    : [];

  if (ids.length === 0) return NextResponse.json({ ok: true, filed: [] });

  const rows = await db
    .select({ sourceId: boxItems.sourceId })
    .from(boxItems)
    .where(inArray(boxItems.sourceId, ids));

  return NextResponse.json({
    ok: true,
    filed: rows.map((row) => row.sourceId).filter((id): id is string => id !== null),
  });
}
