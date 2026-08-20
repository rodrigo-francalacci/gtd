'use client';

import Link from 'next/link';
import { useState } from 'react';
import { documentLabel, type BoxItemRow } from '@/lib/queries.shared';
import { IconDocument, IconLink } from './icons';

const printed = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
});

/**
 * One document as a card: what it looks like, then what it says.
 *
 * The picture earns its place. A scan is recognised by its shape — a
 * letterhead, a long thin till receipt, a two-column bill — well before its
 * title is read, and that is the same reason the paper version of this system
 * worked: you knew the letter by sight when you flicked past it.
 *
 * The thumbnail comes from Drive's own rendering, so a PDF shows its first
 * page rather than a generic icon.
 */
export function DocumentCard({
  item,
  href,
  selected,
}: {
  item: BoxItemRow;
  href: string;
  selected: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const label = documentLabel(item);
  const unread = item.status !== 'ready';

  return (
    <Link
      href={href}
      className={[
        'flex flex-col overflow-hidden rounded-sm border transition-colors',
        selected
          ? 'border-selected bg-selected-bg'
          : 'border-grey-200 bg-paper hover:border-grey-300',
      ].join(' ')}
    >
      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-grey-100">
        {failed ? (
          <span className="text-grey-300">
            <IconDocument />
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- proxied bytes
          <img
            src={`/api/box/${item.id}/thumbnail?size=400`}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            // Top-aligned: a document's identity is its head — the letterhead,
            // the shop name — and centring a tall scan crops exactly that off.
            className="h-full w-full object-cover object-top"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1 p-2">
        <span
          className={[
            'line-clamp-2 text-[12px] leading-snug',
            unread
              ? 'italic text-grey-500'
              : selected
                ? 'font-medium text-grey-900'
                : 'text-grey-800',
          ].join(' ')}
        >
          {label}
        </span>

        {item.description ? (
          <span className="line-clamp-3 text-[11px] leading-relaxed text-grey-500">
            {item.description}
          </span>
        ) : unread ? (
          <span className="text-[11px] text-grey-400">waiting to be read</span>
        ) : null}

        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
          {item.docDate ? (
            <span className="tabular-nums text-grey-500">
              {printed.format(new Date(item.docDate))}
            </span>
          ) : null}

          {item.tags.slice(0, 3).map((tag) => (
            <span
              key={tag.id}
              className="rounded-sm bg-grey-200 px-1 py-px text-grey-600"
              title={tag.category}
            >
              {tag.name}
            </span>
          ))}

          {item.tags.length > 3 ? (
            <span className="text-grey-400">+{item.tags.length - 3}</span>
          ) : null}

          {item.linkCount > 0 ? (
            <span className="text-grey-400">
              <IconLink />
            </span>
          ) : null}
        </span>
      </div>
    </Link>
  );
}
