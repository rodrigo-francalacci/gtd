import 'server-only';

import { attachments, boxItems, db } from '@gtd/db';
import { eq, sql } from 'drizzle-orm';

export { USABLE, isUsableType, type UsableType } from './usage.shared';

import type { UsableType } from './usage.shared';

/**
 * Counting what actually gets opened.
 *
 * The one sort key nobody has to maintain. Arrival is a fact about the row and
 * a name is a fact about the file; this is a record of what you have really
 * been doing with it, and the only one of the three that keeps itself honest
 * as a project's file list grows past the point of being read.
 *
 * Deliberately small and dumb. It is not analytics and nothing is derived from
 * it beyond an ORDER BY, so there is no event log, no session and no history —
 * one integer and one date per row, both editable by hand from the pane,
 * because a counter you cannot correct eventually tells you something you know
 * to be wrong and offers no way to say so.
 */
const TABLES = {
  attachment: attachments,
  box_item: boxItems,
} as const;

/**
 * One more open.
 *
 * `updated_at` is deliberately not touched. Looking at something is not
 * editing it, and bumping the modification time on every open would quietly
 * destroy the one column that says when a row last actually changed — which
 * several things in this app do care about.
 *
 * Failures are swallowed by the caller, not here. A count is worth having and
 * worth nothing at all beside the file the user was trying to open.
 */
export async function bumpUsage(type: UsableType, id: string): Promise<void> {
  const table = TABLES[type];

  await db
    .update(table)
    .set({ useCount: sql`${table.useCount} + 1`, lastUsedAt: sql`now()` })
    .where(eq(table.id, id));
}

/**
 * Set the count by hand, or reset it.
 *
 * The escape hatch that makes the automatic version safe to sort by. A file
 * opened forty times during one bad week sits at the top of the pane for a
 * year afterwards, and being able to say "no, that was once" is what stops the
 * sort from slowly becoming a record of a fortnight in March.
 *
 * Clearing to zero clears the date too: a row with no opens has no last-open,
 * and leaving one behind would sort it above rows that genuinely have none.
 */
export async function setUsage(
  type: UsableType,
  id: string,
  count: number,
): Promise<void> {
  const table = TABLES[type];
  const next = Math.max(0, Math.min(1_000_000, Math.round(count)));

  await db
    .update(table)
    .set({
      useCount: next,
      lastUsedAt: next === 0 ? null : sql`coalesce(${table.lastUsedAt}, now())`,
    })
    .where(eq(table.id, id));
}
