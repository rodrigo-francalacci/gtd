import { NextResponse } from 'next/server';
import { boxItems, boxes, db } from '@gtd/db';
import { and, eq, inArray } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { WHY, authoriseSecret } from '@/lib/box/auth';
import { ROOT, safeName } from '@/lib/google/sync';

export const dynamic = 'force-dynamic';

/**
 * Which box labels should this thread be wearing?
 *
 * Moving an email entry to another box moves its stored copy in Drive, because
 * that file belongs to the app. It cannot move the *label*: applying one to a
 * message needs `gmail.modify`, a restricted scope, and the whole reason the
 * bridge exists is that this app never asks for one. So the app says what
 * should be true and the script — bound to one account, needing no verification
 * — makes it true. The same asymmetry the scanner and the filing already use.
 *
 * **Stateless, and the complete set rather than a diff.** An earlier attempt
 * tracked "the box whose label Gmail is known to carry" in a column, the way
 * `drive_name` tracks filenames. That is the right shape for a *file*, whose
 * name only this app changes, and the wrong one here: the script has to ask
 * what the labels should be regardless, so the column was a second record of
 * something already knowable — and it could not answer for a message whose
 * entry had been **deleted**, since a deleted row leaves nothing to compare.
 *
 * Asking per thread and answering with the whole set fixes every case at once:
 * moved (the old label goes, the new one comes), copied (both), deleted (none,
 * so the label is removed and the bridge does not re-file it next run),
 * refiled by deleting a box, and a box renamed under it.
 *
 * **Thread-level, because Apps Script labels are.** `GmailApp` labels threads,
 * not messages, so the answer is the union over every message in the thread —
 * a thread whose messages ended up in two boxes wears both labels, which is the
 * only honest thing a thread-level label can say.
 */
export async function POST(request: Request) {
  if (!authoriseSecret(request) && !(await getSession())) {
    return NextResponse.json({ error: WHY }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };

  /*
   * Taken by shape and bounded: this is called by a script anyone holding the
   * secret can edit, and an unbounded `in (...)` is a way to make one query do
   * arbitrary work. A thread of five hundred messages does not exist.
   */
  const ids = Array.isArray(body.ids)
    ? body.ids
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .slice(0, 500)
    : [];

  if (ids.length === 0) return NextResponse.json({ ok: true, labels: [] });

  const rows = await db
    .select({ box: boxes.name })
    .from(boxItems)
    .innerJoin(boxes, eq(boxes.id, boxItems.boxId))
    .where(and(eq(boxItems.kind, 'email'), inArray(boxItems.sourceId, ids)));

  /*
   * Built here rather than returned as box names, so the script never has to
   * know the naming rule and the two cannot come to disagree about it — the
   * same reason `safeName` is shared with the scanner bridge.
   */
  const labels = [
    ...new Set(rows.map((row) => `${ROOT}/Box/${safeName(row.box) || 'Box'}`)),
  ];

  return NextResponse.json({ ok: true, labels });
}
