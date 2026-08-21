import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { SortChoice } from './sort';

/**
 * The columns a table offers each of the three orders.
 *
 * Named for the *question* rather than the column, because the answer differs
 * by table and the query shouldn't have to care: arrival is `created_at` on an
 * attachment and the *link's* `created_at` on a borrowed box document, which
 * is a genuinely different fact — when it was cited here, rather than when it
 * reached the box.
 */
export type SortColumns = {
  arrival: PgColumn | SQL;
  /**
   * An expression rather than strictly a column, because not every listable
   * row has a title column of its own. A box note has no title and its text
   * is the description, and sorting those under a null would put every one of
   * them at one end regardless of what it says.
   */
  title: PgColumn | SQL;
  useCount: PgColumn;
  lastUsedAt: PgColumn;
};

/**
 * Turn a chosen order into an ORDER BY.
 *
 * Every branch ends with arrival ascending. Not decoration: a list sorted on a
 * column with ties — and every one of these has ties — is otherwise in
 * whatever order Postgres finds convenient, which is stable right up until the
 * row count changes and the plan does. A list that reshuffles itself when you
 * add a file to it looks broken and is very hard to describe.
 */
export function orderFor(choice: SortChoice, cols: SortColumns): SQL[] {
  const { sort, descending } = choice;
  const dir = descending ? sql`desc` : sql`asc`;
  const arrivalAsc = sql`${cols.arrival} asc`;

  if (sort === 'alpha') {
    // Case-folded, or every capitalised name sorts above every lowercase one
    // and "apple.pdf" lands after "Zebra.pdf".
    return [sql`lower(${cols.title}) ${dir}`, arrivalAsc];
  }

  if (sort === 'usage') {
    /**
     * Count first, last-used as the tiebreak.
     *
     * The two say different things and both matter. The count is how much this
     * file has mattered over its whole life; the date is whether it still
     * does. Without the second, the twenty things opened exactly once come
     * back in an arbitrary order — and "opened once, yesterday" is a far
     * better row to see than "opened once, in March".
     *
     * Nulls last in both directions: a file never opened has no last-used
     * date, and it belongs at the bottom of "most used" and at the top of
     * "least used" — which `nulls last` gives for free, since the count has
     * already put it there.
     */
    return [
      sql`${cols.useCount} ${dir}`,
      sql`${cols.lastUsedAt} ${dir} nulls last`,
      arrivalAsc,
    ];
  }

  return [sql`${cols.arrival} ${dir}`];
}
