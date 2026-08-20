'use client';

import Link from 'next/link';
import { useState } from 'react';
import { documentLabel, mapUrl, type BoxItemRow } from '@/lib/queries.shared';
import { IconDocument, IconLink, IconPlace } from './icons';

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
  const unread = item.kind === 'document' && item.status !== 'ready';
  const audio = item.mimeType?.startsWith('audio/') ? `/api/box/${item.id}/file` : null;

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
      {/* A note has no picture and shouldn't pretend to: forcing it into the
          same tall frame as a scan leaves most of the card empty, and a
          message is as long as it is. The text below carries it instead. */}
      {item.kind === 'note' ? null : (
      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-grey-100">
        {item.kind === 'location' ? (
          <span className="text-grey-400">
            <IconPlace />
          </span>
        ) : audio ? (
          <span className="text-grey-400">
            <IconDocument />
          </span>
        ) : failed ? (
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
      )}

      <div className="flex min-w-0 flex-col gap-1 p-2">
        {audio ? (
          <div onClick={(e) => e.preventDefault()}>
            <audio src={audio} controls preload="none" className="h-7 w-full" />
          </div>
        ) : null}

        {item.kind === 'note' ? (
          <span className="line-clamp-[10] whitespace-pre-wrap text-[12px] leading-relaxed text-grey-800">
            {item.description}
          </span>
        ) : (
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
        )}

        {item.description && item.kind !== 'note' ? (
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

          {item.kind === 'location' && item.lat !== null && item.lng !== null ? (
            <a
              href={mapUrl(item.lat, item.lng)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="tabular-nums text-grey-500 underline underline-offset-2"
            >
              {item.lat.toFixed(3)}, {item.lng.toFixed(3)}
            </a>
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
