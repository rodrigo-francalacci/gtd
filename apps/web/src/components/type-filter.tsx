'use client';

import { useSearchParams } from 'next/navigation';
import {
  ENTRY_TYPE_LABELS,
  ENTRY_TYPE_ORDER,
  type EntryType,
} from '@/lib/queries.shared';
import { FilterChip, filterHref } from './filter-chip';

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
  excluded,
}: {
  boxId: string;
  /** How many of the entries currently showing are of each type. */
  counts: Record<string, number>;
  selected: EntryType[];
  /** Types being filtered *against* — show everything that is not one. */
  excluded: EntryType[];
}) {
  const searchParams = useSearchParams();

  const base = `/box/${boxId}`;

  // Either state keeps a type listed whatever its count: an excluded type has
  // a count of zero by definition, and would otherwise become unreachable.
  const present = ENTRY_TYPE_ORDER.filter(
    (type) =>
      (counts[type] ?? 0) > 0 || selected.includes(type) || excluded.includes(type),
  );

  // One sort of thing in the whole box is not a choice worth offering.
  if (present.length < 2) return null;


  return (
    <div className="flex flex-wrap items-baseline gap-1">
      <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
        Type
      </span>

      {present.map((type) => {
        const state = selected.includes(type)
          ? 'include'
          : excluded.includes(type)
            ? 'exclude'
            : 'off';

        return (
          <FilterChip
            key={type}
            label={ENTRY_TYPE_LABELS[type]}
            count={counts[type] ?? 0}
            state={state}
            includeHref={filterHref(
              base,
              searchParams,
              'type',
              'nottype',
              type,
              // Click is a toggle to and from off; excluding is the other gesture, so
                  // clicking a struck-through chip clears it rather than flipping it.
                  state === 'off' ? 'include' : 'off',
            )}
            excludeHref={filterHref(
              base,
              searchParams,
              'type',
              'nottype',
              type,
              state === 'exclude' ? 'off' : 'exclude',
            )}
          />
        );
      })}
    </div>
  );
}
