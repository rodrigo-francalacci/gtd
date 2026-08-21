/**
 * How a list of files is ordered, and whether it is cut into headed groups.
 *
 * Written for the two lists that hang off a detail pane — the attachments on a
 * project, action, list item or capture, and the box documents linked beside
 * them. Those are the lists that grow without anyone tending them: a project
 * running for a year accumulates thirty files in the order they happened to
 * arrive, and the order they happened to arrive stops being useful long before
 * the thirtieth.
 *
 * The lists in the middle pane are deliberately *not* in scope. Those are
 * arranged by hand, and dragging a row between two others is how you say what
 * matters — a sort that overrode it would be undoing the work.
 *
 * Free of `server-only` on purpose: the queries order by these and the control
 * renders them, and a vocabulary both halves must agree about belongs in one
 * file that neither owns.
 */

import { groupByDay } from './days';

/**
 * Three orders, answering three different questions about a pile of files.
 *
 * `arrival` is when it turned up — for an attachment that is when it was
 * uploaded, for a linked document when it was linked here. It is the default
 * and the one this list always had.
 *
 * `alpha` is by name, which is how you look for something you can already
 * name.
 *
 * `usage` is how often it has actually been opened — the only one of the three
 * nobody has to maintain. It rises on its own for the files you keep coming
 * back to, and sinks for the ones filed with great conviction and never
 * opened again.
 *
 * There is no `manual`: these rows have never had a drag grip or a position,
 * and inventing one would mean a second thing to keep in order.
 */
export const SORT_KEYS = ['arrival', 'alpha', 'usage'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type SortChoice = {
  sort: SortKey;
  /** Newest, Z–A, or most-used first. */
  descending: boolean;
  /** Cut into headed groups. What the groups are follows from `sort`. */
  grouped: boolean;
};

/**
 * Short labels for the control. Each names the *key*, never the direction —
 * the direction is a separate line beside it, and calling the key "A–Z" and
 * the direction "A–Z" prints "A–ZA–Z" in the menu.
 */
export const SORT_LABELS: Record<SortKey, string> = {
  arrival: 'Added',
  alpha: 'By name',
  usage: 'By use',
};

/**
 * Which way round each order runs, spelled out.
 *
 * "Descending" is not what any of them are called out loud, and a menu that
 * says "descending" makes you work out what that means for the sort you are
 * currently on.
 */
export const DIRECTION_LABELS: Record<SortKey, { asc: string; desc: string }> = {
  arrival: { asc: 'Oldest first', desc: 'Newest first' },
  alpha: { asc: 'A–Z', desc: 'Z–A' },
  usage: { asc: 'Least used', desc: 'Most used' },
};

/**
 * Which way a sort runs when you first pick it.
 *
 * Choosing "by use" and being shown the files you have never opened would be a
 * menu item doing the opposite of what it says.
 */
export function naturalDirection(sort: SortKey): boolean {
  return sort === 'usage';
}

/**
 * Only two of the three group into anything worth a heading.
 *
 * Days for arrival, first letters for A–Z. A usage count groups into "3" and
 * "2" and "1", which is a heading repeating what the row beside it already
 * says — so the toggle is withheld there rather than offered and ignored.
 */
export function canGroup(sort: SortKey): boolean {
  return sort === 'arrival' || sort === 'alpha';
}

/**
 * The heading a row falls under, for an A–Z grouping.
 *
 * Everything that isn't a letter goes under `#`, together: a list where
 * numbers, quotes and brackets each got a heading of their own would be mostly
 * headings. Case-folded, because "the" and "The" are the same shelf.
 */
export function initialOf(title: string): string {
  const first = title.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

/**
 * What these lists did before they could be sorted: oldest first, no headings.
 *
 * Nothing is written to `view_prefs` until something is chosen, so an
 * untouched app has an empty table and every pane behaves exactly as it did.
 */
export const DEFAULT_ATTACHMENT_SORT: SortChoice = {
  sort: 'arrival',
  descending: false,
  grouped: false,
};

export type Group<T> = { key: string; label: string | null; items: T[] };

/**
 * Cut a sorted list into whatever its sort implies, or don't.
 *
 * One helper rather than the same decision written out per pane, because the
 * branches have to agree: day headings must run the same way as the rows
 * inside them, and a grouping asked for under a sort that can't produce one
 * has to fall back to a single unlabelled run rather than a heading over
 * everything.
 *
 * A null label means "no heading" — one group holding the lot, which is what
 * an ungrouped list is.
 */
export function groupRows<T>(
  rows: T[],
  choice: SortChoice,
  get: { date: (row: T) => Date; title: (row: T) => string },
): Group<T>[] {
  if (!choice.grouped || !canGroup(choice.sort)) {
    return [{ key: 'all', label: null, items: rows }];
  }

  if (choice.sort === 'alpha') {
    return groupBy(rows, (row) => initialOf(get.title(row)));
  }

  return groupByDay(rows, get.date, choice.descending);
}

/**
 * Group rows under headings, given a label for each.
 *
 * The rows must already be in the order the headings imply — this cuts a
 * sorted list, it does not sort one. Runs of the same label become one group,
 * so a list that isn't actually sorted by the same key produces repeated
 * headings rather than silently reordering anything.
 */
export function groupBy<T>(
  rows: T[],
  labelOf: (row: T) => string,
): { key: string; label: string; items: T[] }[] {
  const groups: { key: string; label: string; items: T[] }[] = [];

  for (const row of rows) {
    const label = labelOf(row);
    const last = groups[groups.length - 1];

    if (last && last.label === label) last.items.push(row);
    else groups.push({ key: `${label}-${groups.length}`, label, items: [row] });
  }

  return groups;
}
