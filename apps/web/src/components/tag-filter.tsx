'use client';

import Link from 'next/link';
import type { BoxCategoryRow } from '@/lib/queries.shared';

/**
 * Narrow a box by its own tags.
 *
 * Links rather than a form, so a filtered view has a URL you can keep: "every
 * Tesco fuel receipt" is a thing worth bookmarking, and a filter held in
 * component state is a filter you have to rebuild every visit.
 *
 * Adding tags narrows — the list needs *all* of them. A filter that widens as
 * you add to it is one you stop trusting after the first surprise.
 */
export function TagFilter({
  boxId,
  categories,
  selected,
}: {
  boxId: string;
  categories: BoxCategoryRow[];
  selected: string[];
}) {
  const withTags = categories.filter((c) => c.tags.length > 0);
  if (withTags.length === 0) return null;

  const hrefFor = (tagId: string) => {
    const next = selected.includes(tagId)
      ? selected.filter((t) => t !== tagId)
      : [...selected, tagId];

    const params = new URLSearchParams();
    next.forEach((t) => params.append('tag', t));
    const query = params.toString();

    return query ? `/box/${boxId}?${query}` : `/box/${boxId}`;
  };

  return (
    <div className="flex flex-col gap-1">
      {withTags.map((category) => (
        <div key={category.id} className="flex flex-wrap items-baseline gap-1">
          <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
            {category.name}
          </span>
          {category.tags.map((tag) => {
            const on = selected.includes(tag.id);
            return (
              <Link
                key={tag.id}
                href={hrefFor(tag.id)}
                className={[
                  'rounded-sm px-1.5 py-px text-[11px]',
                  on
                    ? 'bg-selected-bg font-medium text-selected'
                    : 'bg-grey-200 text-grey-600 hover:bg-grey-300',
                ].join(' ')}
              >
                {tag.name}
              </Link>
            );
          })}
        </div>
      ))}

      {selected.length > 0 ? (
        <Link
          href={`/box/${boxId}`}
          className="self-start text-[11px] text-grey-500 underline underline-offset-2"
        >
          Clear filter
        </Link>
      ) : null}
    </div>
  );
}
