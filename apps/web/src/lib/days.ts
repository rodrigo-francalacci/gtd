/**
 * Cutting a list into days.
 *
 * Written for the inbox and immediately wanted by the Big Box, which is the
 * usual sign: both are lists you read from the top, where the only thing
 * separating one entry from another at a glance is when it turned up.
 *
 * Pure and free of `server-only`, so a Client Component can group too.
 *
 * Days are cut in the *server's* timezone, which is where every other date in
 * this app is formatted. That keeps a heading and the timestamps under it
 * telling the same story. It does mean neither is the user's timezone when the
 * server is somewhere else, which is one app-wide fix rather than something to
 * work around per list.
 */

/** The heading over a day: "18 August 2026". */
const dayName = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Within the last week the weekday is more use than the date. */
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });

/** Sortable, comparable key — the same calendar day gives the same string. */
const dayKey = new Intl.DateTimeFormat('en-CA');

const DAY_MS = 86_400_000;

export type Day<T> = { key: string; label: string; items: T[] };

export function dayLabel(date: Date, now = new Date()): string {
  const key = dayKey.format(date);

  if (key === dayKey.format(now)) return 'Today';
  if (key === dayKey.format(new Date(now.getTime() - DAY_MS))) return 'Yesterday';
  if (date >= new Date(now.getTime() - 6 * DAY_MS)) return weekday.format(date);

  return dayName.format(date);
}

/**
 * Group into days, preserving the order within each day.
 *
 * The caller sorts; this only cuts. A list that arrives newest-first stays
 * that way inside each heading, which is what "most recent on top" has to mean
 * all the way down or the ordering reverses halfway through a day.
 *
 * `newestFirst` defaults to true because that is what both original callers
 * wanted: a feed and a day-grouped inbox are read from the top. It became a
 * parameter once an attachments list could be asked for oldest-first — the
 * days have to run the same way as the rows inside them, or the list counts
 * forwards within each heading and backwards between them.
 */
export function groupByDay<T>(
  items: T[],
  dateOf: (item: T) => Date,
  newestFirst = true,
): Day<T>[] {
  const now = new Date();
  const days = new Map<string, T[]>();

  for (const item of items) {
    const key = dayKey.format(dateOf(item));
    days.set(key, [...(days.get(key) ?? []), item]);
  }

  return [...days.entries()]
    // The key is ISO-ordered, so a string sort is a date sort.
    .sort(([a], [b]) => (newestFirst ? b.localeCompare(a) : a.localeCompare(b)))
    .map(([key, rows]) => ({
      key,
      label: dayLabel(dateOf(rows[0]), now),
      items: rows,
    }));
}
