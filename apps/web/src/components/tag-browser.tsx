'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoxCategoryRow } from '@/lib/queries.shared';
import { FilterChip, filterHref } from './filter-chip';
import { useSidebarSlot } from './sidebar-slot';

/**
 * The whole of a box's tag vocabulary, in the sidebar's place.
 *
 * The bar outside shows the tags that would narrow the list most, flat and
 * without their categories, because that is what a shortcut is for. This is the
 * other question — *what tags are there* — and it is a different shape: grouped,
 * complete, searchable, and read down a column rather than across a line.
 *
 * It borrows the sidebar rather than opening over the list, which is worth
 * being explicit about. The list is what you are filtering; covering it means
 * choosing tags blind. The sidebar is navigation you are not using while you do
 * this, it is already the right shape for a long grouped list, and on a phone it
 * is already a drawer — so the panel is a modal there and a column here without
 * either being written separately.
 *
 * **Choosing does not close it.** A popover that shuts on the first click is
 * right for a quick action and wrong here: narrowing a box is two or three tags
 * and you want to see each one's effect on the counts before picking the next.
 * They update in place, because the page re-renders on the server and these are
 * its props.
 */
export function TagBrowser({
  boxId,
  boxName,
  categories,
  selected,
  excluded,
  counts,
  showing,
}: {
  boxId: string;
  boxName: string;
  categories: BoxCategoryRow[];
  selected: string[];
  excluded: string[];
  counts: Record<string, number>;
  /** How many entries the current filters leave, so the panel can say. */
  showing: number;
}) {
  const slot = useSidebarSlot();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const base = `/box/${boxId}`;

  /**
   * Only what would still find something — the same rule the bar follows.
   *
   * A tag on none of the remaining entries leads to an empty list, so offering
   * it is offering a dead end, and a panel full of dead ends is one you stop
   * reading. A tag already chosen stays listed whatever its count: an excluded
   * one is zero by definition, and hiding it would leave no way to undo it.
   */
  const live = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return categories
      .map((category) => ({
        ...category,
        tags: category.tags
          .filter(
            (tag) =>
              (counts[tag.id] ?? 0) > 0 ||
              selected.includes(tag.id) ||
              excluded.includes(tag.id),
          )
          .filter((tag) => !needle || tag.name.toLowerCase().includes(needle))
          .sort(
            (a, b) =>
              (counts[b.id] ?? 0) - (counts[a.id] ?? 0) ||
              a.name.localeCompare(b.name),
          ),
      }))
      .filter((category) => category.tags.length > 0);
  }, [categories, counts, selected, excluded, query]);

  const chosen = selected.length + excluded.length;

  if (slot.owner !== 'tag-browser' || !slot.node) return null;

  return createPortal(
    <div className="absolute inset-0 z-10 flex flex-col bg-grey-50">
      <header className="flex items-baseline gap-2 border-b border-grey-200 px-3 py-3">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold uppercase tracking-wide text-grey-700">
          {boxName} tags
        </h2>
        <button
          type="button"
          onClick={() => slot.claim(null)}
          className="shrink-0 text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
        >
          Done
        </button>
      </header>

      <div className="border-b border-grey-200 px-3 py-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tags…"
          aria-label="Search tags"
          /* 16px, or iOS Safari zooms the page in when it takes focus — and on
             a phone this panel *is* the page. */
          className="w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[16px] text-grey-800 placeholder:text-grey-400 focus:border-selected focus:outline-none md:text-[12px]"
        />

        <p className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] text-grey-500">
          <span className="tabular-nums">
            {showing} {showing === 1 ? 'entry' : 'entries'} showing
          </span>
          {chosen > 0 ? (
            <Link
              href={clearedHref(boxId, searchParams)}
              className="underline underline-offset-2 hover:text-grey-800"
            >
              Clear {chosen}
            </Link>
          ) : null}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {live.length === 0 ? (
          <p className="py-4 text-[12px] text-grey-400">
            {query.trim() ? `Nothing matches “${query.trim()}”.` : 'No tags here yet.'}
          </p>
        ) : (
          live.map((category) => (
            <section key={category.id} className="mb-4">
              <h3 className="mb-1.5 text-[10px] uppercase tracking-wider text-grey-400">
                {category.name}
              </h3>
              <div className="flex flex-wrap gap-1">
                {category.tags.map((tag) => (
                  <FilterChip
                    key={tag.id}
                    label={tag.name}
                    count={counts[tag.id] ?? 0}
                    state={
                      selected.includes(tag.id)
                        ? 'include'
                        : excluded.includes(tag.id)
                          ? 'exclude'
                          : 'off'
                    }
                    includeHref={filterHref(
                      base,
                      searchParams,
                      'tag',
                      'nottag',
                      tag.id,
                      selected.includes(tag.id) ? 'off' : 'include',
                    )}
                    excludeHref={filterHref(
                      base,
                      searchParams,
                      'tag',
                      'nottag',
                      tag.id,
                      excluded.includes(tag.id) ? 'off' : 'exclude',
                    )}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>,
    slot.node,
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
