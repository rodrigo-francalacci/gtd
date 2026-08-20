'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ENTRY_TYPE_LABELS,
  ENTRY_TYPE_ORDER,
  type EntryType,
} from '@/lib/queries.shared';

/**
 * Narrow a box by what sort of thing an entry is.
 *
 * The third axis, and the one you reach for when you remember the *shape* of
 * what you're after rather than anything about its contents — "it was a voice
 * note", "it was a place". Tags describe what a thing is about; this describes
 * what it is.
 *
 * Unlike the tags, these are OR: picking Audio and Places means either, since
 * nothing is ever both and requiring both would always return nothing. That is
 * the opposite rule to the tag bar sitting right above it, which is worth
 * knowing and is why the two are separate rows rather than one mixed line.
 *
 * Same discipline as the tags otherwise: only types actually present are
 * offered, with the count, so it can't send you to an empty list.
 */
export function TypeFilter({
  boxId,
  counts,
  selected,
}: {
  boxId: string;
  /** How many of the entries currently showing are of each type. */
  counts: Record<string, number>;
  selected: EntryType[];
}) {
  const searchParams = useSearchParams();

  const present = ENTRY_TYPE_ORDER.filter(
    (type) => (counts[type] ?? 0) > 0 || selected.includes(type),
  );

  // One sort of thing in the whole box is not a choice worth offering.
  if (present.length < 2) return null;

  const hrefFor = (type: EntryType) => {
    const next = selected.includes(type)
      ? selected.filter((t) => t !== type)
      : [...selected, type];

    // Built from the current URL, so the tags and the dates come along.
    const params = new URLSearchParams(searchParams);
    params.delete('type');
    next.forEach((t) => params.append('type', t));
    params.delete('doc');

    const query = params.toString();
    return query ? `/box/${boxId}?${query}` : `/box/${boxId}`;
  };

  return (
    <div className="flex flex-wrap items-baseline gap-1">
      <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
        Type
      </span>

      {present.map((type) => {
        const on = selected.includes(type);
        return (
          <Link
            key={type}
            href={hrefFor(type)}
            className={[
              'flex items-baseline gap-1 rounded-sm px-1.5 py-px text-[11px]',
              on
                ? 'bg-selected-bg font-medium text-selected'
                : 'bg-grey-200 text-grey-600 hover:bg-grey-300',
            ].join(' ')}
          >
            {ENTRY_TYPE_LABELS[type]}
            <span className="tabular-nums opacity-60">{counts[type] ?? 0}</span>
          </Link>
        );
      })}
    </div>
  );
}
