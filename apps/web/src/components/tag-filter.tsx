'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { BoxCategoryRow } from '@/lib/queries.shared';
import { FilterChip, filterHref } from './filter-chip';

/**
 * Narrow a box by its own tags.
 *
 * Links rather than a form, so a filtered view has a URL you can keep: "every
 * Tesco fuel receipt" is a thing worth bookmarking, and a filter held in
 * component state is a filter you have to rebuild every visit.
 *
 * Adding tags narrows — the list needs *all* of them. A filter that widens as
 * you add to it is one you stop trusting after the first surprise.
 *
 * Right-click, or hold on a touchscreen, and the tag is filtered *against*
 * instead: everything except this. The other question a box asks constantly,
 * and one that previously needed every other tag selected by hand — which is
 * not the same thing, and stops working the moment a new tag appears.
 *
 * And it only offers what is still there. Once Tesco is selected, a tag that
 * appears on none of the remaining receipts leads to an empty list, so showing
 * it is offering a dead end — the bar fills up with roads that go nowhere and
 * you stop reading it. The counts come from the rows on screen, so what is
 * listed is exactly what would still find something.
 */
export function TagFilter({
  boxId,
  categories,
  selected,
  excluded,
  counts,
}: {
  boxId: string;
  categories: BoxCategoryRow[];
  selected: string[];
  /** Tags being filtered *against* — show everything that doesn't carry one. */
  excluded: string[];
  /** How many of the entries currently showing carry each tag. */
  counts: Record<string, number>;
}) {
  const searchParams = useSearchParams();
  const base = `/box/${boxId}`;

  const withTags = categories
    .map((category) => ({
      ...category,
      // A tag in either state stays listed whatever its count, or there would
      // be no way to undo it — an excluded tag has a count of zero by
      // definition, so this is the only thing keeping it reachable.
      tags: category.tags.filter(
        (tag) =>
          (counts[tag.id] ?? 0) > 0 ||
          selected.includes(tag.id) ||
          excluded.includes(tag.id),
      ),
    }))
    .filter((category) => category.tags.length > 0);

  if (withTags.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {withTags.map((category) => (
        <div key={category.id} className="flex flex-wrap items-baseline gap-1">
          <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
            {category.name}
          </span>
          {category.tags.map((tag) => {
            const state = selected.includes(tag.id)
              ? 'include'
              : excluded.includes(tag.id)
                ? 'exclude'
                : 'off';

            return (
              <FilterChip
                key={tag.id}
                label={tag.name}
                /* What you'd be left with. Worth the space: it turns the bar
                   from a list of labels into a picture of what's in the box. */
                count={counts[tag.id] ?? 0}
                state={state}
                includeHref={filterHref(
                  base,
                  searchParams,
                  'tag',
                  'nottag',
                  tag.id,
                  // Click is a toggle to and from off; excluding is the other gesture, so
                  // clicking a struck-through chip clears it rather than flipping it.
                  state === 'off' ? 'include' : 'off',
                )}
                excludeHref={filterHref(
                  base,
                  searchParams,
                  'tag',
                  'nottag',
                  tag.id,
                  state === 'exclude' ? 'off' : 'exclude',
                )}
              />
            );
          })}
        </div>
      ))}

      {selected.length > 0 || excluded.length > 0 ? (
        <Link
          href={clearedHref(boxId, searchParams)}
          className="self-start text-[11px] text-grey-500 underline underline-offset-2"
        >
          Clear tags
        </Link>
      ) : null}
    </div>
  );
}

/** Drop the tags, both kinds, and keep everything else — the dates included. */
function clearedHref(boxId: string, params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.delete('tag');
  next.delete('nottag');
  next.delete('doc');
  const query = next.toString();
  return query ? `/box/${boxId}?${query}` : `/box/${boxId}`;
}
