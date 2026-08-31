'use client';

import { useSearchParams } from 'next/navigation';
import type { BoxCategoryRow } from '@/lib/queries.shared';
import { FilterChip, filterHref } from './filter-chip';

/**
 * The tags worth offering right now — one row, no categories.
 *
 * Links rather than a form, so a filtered view has a URL you can keep: "every
 * Tesco fuel receipt" is a thing worth bookmarking, and a filter held in
 * component state is a filter you have to rebuild every visit.
 *
 * Adding tags narrows — the list needs *all* of them. A filter that widens as
 * you add to it is one you stop trusting after the first surprise. Right-click,
 * or hold on a touchscreen, and the tag is filtered *against* instead.
 *
 * **Flat, and that is the change worth explaining.** This used to be a row per
 * category with a heading on each, which cost a line per category before a
 * single tag was shown — three lines for four chips, and worse the more
 * categories a box grew. But the heading was rarely the thing you needed:
 * "Tesco", "Swindon" and "Receipt" say which axis they are on by being
 * themselves. So the categories are gone from here and live in the browser,
 * which is where the question "what tags are there" is actually asked.
 *
 * The exception is a name that appears in two categories — a Shell that is both
 * a vendor and a place — and only *those* carry their category, because that is
 * the only case where the bare name is genuinely ambiguous. Labelling every
 * chip to cover a collision that usually doesn't exist is the cost the old
 * layout was paying.
 *
 * **What survives the cut is the current count, so it moves as you filter.**
 * The counts come from the rows on screen, so after choosing Tesco the tags
 * offered next are the ones that still co-occur with it — not the box's
 * all-time favourites. Anything chosen is pinned to the front whatever its
 * rank: an excluded tag has a count of zero by definition, and dropping it
 * would leave no way to undo it.
 */

/**
 * How many chips before the row stops being glanceable.
 *
 * Fifteen is about two lines in a pane at its usual width. Past that you are
 * not reading a bar, you are searching one — which is what the browser is for,
 * and it is one press away.
 */
const QUICK_TAGS = 15;

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

  /** Every tag that would still find something, with the category it came from. */
  const live = categories.flatMap((category) =>
    category.tags
      .filter(
        (tag) =>
          (counts[tag.id] ?? 0) > 0 ||
          selected.includes(tag.id) ||
          excluded.includes(tag.id),
      )
      .map((tag) => ({ ...tag, category: category.name })),
  );

  if (live.length === 0) return null;

  /*
   * Which names need their category to be told apart. Compared the way
   * `resolveParty` and the tag matcher compare — case and space insensitively —
   * so "Pay At Pump" and "payatpump" count as the same word colliding.
   */
  const seen = new Map<string, Set<string>>();
  for (const tag of live) {
    const key = tag.name.toLowerCase().replace(/\s+/g, '');
    seen.set(key, (seen.get(key) ?? new Set()).add(tag.category));
  }

  const ambiguous = (name: string) =>
    (seen.get(name.toLowerCase().replace(/\s+/g, ''))?.size ?? 0) > 1;

  const ranked = [...live].sort((a, b) => {
    const chosenA = selected.includes(a.id) || excluded.includes(a.id) ? 1 : 0;
    const chosenB = selected.includes(b.id) || excluded.includes(b.id) ? 1 : 0;
    return (
      chosenB - chosenA ||
      (counts[b.id] ?? 0) - (counts[a.id] ?? 0) ||
      // Ties break on name so the bar doesn't reshuffle itself between two
      // renders that mean the same thing.
      a.name.localeCompare(b.name)
    );
  });

  const quick = ranked.slice(0, QUICK_TAGS);

  return (
    <div className="flex flex-wrap items-baseline gap-1">
      {quick.map((tag) => {
        const state = selected.includes(tag.id)
          ? 'include'
          : excluded.includes(tag.id)
            ? 'exclude'
            : 'off';

        return (
          <FilterChip
            key={tag.id}
            dragId={tag.id}
            label={ambiguous(tag.name) ? `${tag.category}: ${tag.name}` : tag.name}
            /* What you'd be left with. Worth the space: it turns the bar from a
               list of labels into a picture of what's in the box. */
            count={counts[tag.id] ?? 0}
            state={state}
            includeHref={filterHref(
              base,
              searchParams,
              'tag',
              'nottag',
              tag.id,
              // Click toggles to and from off; excluding is the other gesture,
              // so clicking a struck-through chip clears it rather than
              // flipping it.
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

      {/*
        The way into the whole vocabulary used to be a chip on the end of this
        row — which put it at the end of the very thing it opens, and below the
        fold on a narrow pane. It is a button in the pane header now, beside the
        control for how the box is looked at, because choosing tags and choosing
        a layout are the two things you do to a box constantly.
      */}
    </div>
  );
}
