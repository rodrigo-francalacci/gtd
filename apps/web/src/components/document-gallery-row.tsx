'use client';

import Link from 'next/link';
import { useState } from 'react';
import { documentLabel, mapUrl, type BoxItemRow } from '@/lib/queries.shared';
import { IconAudio, IconDocument, IconLink, IconPlace } from './icons';

const printed = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
});

/**
 * One entry, with its picture: thumbnail left, everything else right.
 *
 * A row rather than a tile in a grid. Two entries side by side halve the width
 * available to the summary, which is the part that tells you whether this is
 * the document you're after — and a scan's thumbnail only has to be big enough
 * to recognise a shape, not to read. So the picture stays small and fixed and
 * the text gets the rest of the line.
 *
 * The thumbnail is Drive's own rendering, so a PDF shows its first page.
 */
export function DocumentGalleryRow({
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

  const size = item.sizeBytes
    ? item.sizeBytes >= 1024 * 1024
      ? `${(item.sizeBytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(item.sizeBytes / 1024))} KB`
    : null;

  return (
    <Link
      href={href}
      className={[
        'flex gap-3 border-b border-grey-150 px-3 py-2.5',
        selected ? 'bg-selected-bg' : 'hover:bg-grey-100',
      ].join(' ')}
    >
      {/* Fixed square, so every row starts its text at the same place — a
          ragged left edge down a column of entries is the thing that makes a
          list tiring to scan. A note has no picture and gets none. */}
      {item.kind !== 'note' ? (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-grey-100">
          {item.kind === 'location' ? (
            <span className="text-grey-400">
              <IconPlace />
            </span>
          ) : audio ? (
            // A microphone, not the generic page. The page is also what a
            // failed render falls back to, so using it here made a perfectly
            // good recording look like something that had gone wrong.
            <span className="text-grey-500">
              <IconAudio />
            </span>
          ) : failed ? (
            <span className="text-grey-400">
              <IconDocument />
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- proxied bytes
            <img
              // 320 rather than the 56 this box renders at: Drive fits the
              // *longest* edge to the number, so a till receipt comes back
              // barely 80px wide at 200 and looks soft on a dense screen.
              src={`/api/box/${item.id}/thumbnail?size=320`}
              alt=""
              loading="lazy"
              onError={() => setFailed(true)}
              // Top-aligned: a document's identity is its head — the
              // letterhead, the shop name — and centring a tall scan crops
              // exactly that off.
              className="h-full w-full object-cover object-top"
            />
          )}
        </span>
      ) : null}

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={[
            'text-[13px] leading-snug',
            item.kind === 'note' ? 'whitespace-pre-wrap' : 'truncate',
            unread
              ? 'italic text-grey-500'
              : selected
                ? 'font-medium text-grey-900'
                : 'text-grey-800',
          ].join(' ')}
        >
          {item.kind === 'note' ? item.description : label}
        </span>

        {item.description && item.kind !== 'note' ? (
          <span className="line-clamp-2 text-[11px] leading-relaxed text-grey-500">
            {item.description}
          </span>
        ) : unread ? (
          <span className="text-[11px] text-grey-400">waiting to be read</span>
        ) : item.status === 'failed' && item.kind === 'document' ? (
          <span className="text-[11px] text-stale">could not be read</span>
        ) : null}

        {audio ? (
          <span
            className="mt-1 block"
            onClick={(e) => {
              // The transport must not also select the row and scroll the pane
              // out from under what you are listening to.
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <audio src={audio} controls preload="none" className="h-8 w-full max-w-sm" />
          </span>
        ) : null}

        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-grey-400">
          {size ? <span className="tabular-nums">{size}</span> : null}

          {item.docDate ? (
            <span className="tabular-nums">
              {printed.format(new Date(item.docDate))}
            </span>
          ) : null}

          {item.kind === 'location' && item.lat !== null && item.lng !== null ? (
            <a
              href={mapUrl(item.lat, item.lng)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="tabular-nums underline underline-offset-2 hover:text-grey-700"
            >
              {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
            </a>
          ) : null}

          {item.tags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-sm bg-grey-200 px-1 py-px text-[10px] text-grey-600"
              title={tag.category}
            >
              {tag.name}
            </span>
          ))}

          {item.linkCount > 0 ? (
            <span className="text-grey-400">
              <IconLink />
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}
