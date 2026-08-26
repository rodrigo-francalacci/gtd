'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoxTagRow } from '@/lib/queries.shared';
import { FilterChip, filterHref } from './filter-chip';

/**
 * The rest of a category's tags, when there are too many to show.
 *
 * A box's vocabulary only grows: document types stay at half a dozen, but
 * vendors become every shop you ever kept a receipt from. The bar shows the
 * ones that would narrow the list most and folds the rest in here, because a
 * filter taller than the list it filters has stopped being a filter.
 *
 * **A search field, not a longer list.** Past about twenty tags you are no
 * longer scanning, you are looking for one you already have in mind — and
 * typing three letters beats reading two hundred chips however they are
 * arranged. That is the whole reason this is worth opening rather than simply
 * showing everything in a taller bar.
 *
 * It lists the category's *whole* vocabulary, including the tags already on the
 * bar outside. Hiding those would make the search lie: type "tesco", find
 * nothing, and conclude there is no Tesco — when it was on screen all along,
 * three chips to the left.
 *
 * The chips are the same `FilterChip` the bar uses, so click still includes and
 * right-click or hold still excludes. A second way to express the same filter
 * with different gestures would be a thing to learn for no reason.
 */
export function TagPicker({
  categoryName,
  tags,
  counts,
  selected,
  excluded,
  hiddenCount,
  base,
  params,
}: {
  categoryName: string;
  /** Every tag in this category that would still find something. */
  tags: BoxTagRow[];
  counts: Record<string, number>;
  selected: string[];
  excluded: string[];
  /** How many are folded away, which is what the control says. */
  hiddenCount: number;
  base: string;
  params: URLSearchParams;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    // The field is the point of the panel, so it takes focus on open — you
    // pressed this because you already know what you are looking for.
    field.current?.focus();

    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const ranked = [...tags].sort(
      (a, b) =>
        (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || a.name.localeCompare(b.name),
    );

    return needle
      ? ranked.filter((tag) => tag.name.toLowerCase().includes(needle))
      : ranked;
  }, [tags, counts, query]);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={`${hiddenCount} more ${categoryName.toLowerCase()} — search them`}
        className="shrink-0 rounded-sm bg-grey-150 px-1.5 py-px text-[11px] tabular-nums text-grey-500 hover:bg-grey-300 hover:text-grey-800"
      >
        +{hiddenCount}
      </button>

      {open ? (
        <div
          ref={box}
          role="dialog"
          aria-label={`All ${categoryName}`}
          /*
           * Anchored to the row rather than to the button. The button sits at
           * the end of a wrapping row, so its horizontal position is whatever
           * the chips before it happened to leave — a panel hung off it opens
           * off the edge of a narrow pane about half the time. The row's left
           * edge is somewhere predictable.
           *
           * Width is capped rather than set, because a pane never scrolls
           * sideways: something wider than the pane would turn it into a
           * horizontal scroller and eat the swipe that moves the carousel.
           */
          className="absolute left-0 top-full z-30 mt-1 w-[min(20rem,100%)] rounded-sm border border-grey-300 bg-paper p-2 shadow-lg"
        >
          <input
            ref={field}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${categoryName.toLowerCase()}…`}
            aria-label={`Search ${categoryName}`}
            /* 16px, or iOS Safari zooms the pane in when this takes focus. */
            className="mb-2 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[16px] text-grey-800 placeholder:text-grey-400 focus:border-selected focus:outline-none md:text-[12px]"
          />

          <div
            /*
             * Choosing closes it. Both gestures bubble to here — the include is
             * a link and the exclude preventDefaults but does not stop
             * propagation — so one handler covers both. Staying open would
             * leave a panel of counts that are about to be wrong sitting over
             * the list they no longer describe.
             */
            onClick={() => setOpen(false)}
            onContextMenu={() => setOpen(false)}
            className="flex max-h-64 flex-wrap content-start gap-1 overflow-y-auto"
          >
            {found.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-grey-400">
                Nothing here matches “{query}”.
              </p>
            ) : (
              found.map((tag) => {
                const state = selected.includes(tag.id)
                  ? 'include'
                  : excluded.includes(tag.id)
                    ? 'exclude'
                    : 'off';

                return (
                  <FilterChip
                    key={tag.id}
                    label={tag.name}
                    count={counts[tag.id] ?? 0}
                    state={state}
                    includeHref={filterHref(
                      base,
                      params,
                      'tag',
                      'nottag',
                      tag.id,
                      state === 'off' ? 'include' : 'off',
                    )}
                    excludeHref={filterHref(
                      base,
                      params,
                      'tag',
                      'nottag',
                      tag.id,
                      state === 'exclude' ? 'off' : 'exclude',
                    )}
                  />
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
