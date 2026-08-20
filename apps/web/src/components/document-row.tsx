'use client';

import Link from 'next/link';
import { BOX_COLUMNS } from '@/lib/columns';
import type { ViewMode } from '@/lib/pane';
import { documentLabel, mapUrl, type BoxItemRow } from '@/lib/queries.shared';
import { IconLink, IconPlace } from './icons';
import { SimpleRow } from './simple-row';

const printed = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
});

/**
 * One document in a box.
 *
 * No checkbox and no drag grip: a document isn't done and doesn't reorder —
 * it arrived, and when it arrived is what the heading above it says. The only
 * thing a row can be is read or not yet read.
 */
export function DocumentRow({
  item,
  href,
  selected,
  mode = 'comfortable',
}: {
  item: BoxItemRow;
  href: string;
  selected: boolean;
  mode?: ViewMode;
}) {
  const label = documentLabel(item);
  const unread = item.kind === 'document' && item.status !== 'ready';

  /**
   * A voice note plays where it sits.
   *
   * Nothing transcribes audio here, so a recording has no title and no summary
   * — which makes it the one entry you cannot judge without hearing it. Making
   * you open a pane for that is the difference between a journal you speak
   * into and one you don't.
   */
  const audio = item.mimeType?.startsWith('audio/') ? `/api/box/${item.id}/file` : null;

  if (mode === 'simple') {
    return (
      <SimpleRow
        href={href}
        title={<span className={unread ? 'italic text-grey-500' : ''}>{label}</span>}
        selected={selected}
        grip={false}
        after={
          item.linkCount > 0 ? (
            <span className="shrink-0 text-grey-400" title="Linked to something">
              <IconLink />
            </span>
          ) : null
        }
      />
    );
  }

  if (mode === 'compact') {
    return (
      <Link
        href={href}
        style={{ gridTemplateColumns: BOX_COLUMNS.template }}
        className={[
          'grid items-center gap-2 px-4 py-1 text-[12px]',
          selected ? 'bg-selected-bg' : 'hover:bg-grey-100',
        ].join(' ')}
      >
        <span
          className={[
            'truncate',
            unread
              ? 'italic text-grey-500'
              : selected
                ? 'font-medium text-grey-900'
                : 'text-grey-800',
          ].join(' ')}
        >
          {label}
        </span>
        <span className="truncate text-grey-500">
          {item.tags.map((t) => t.name).join(', ') || '—'}
        </span>
        <span className="truncate tabular-nums text-grey-500">
          {item.docDate ? printed.format(new Date(item.docDate)) : '—'}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={[
        'block px-4 py-2.5',
        selected ? 'bg-selected-bg' : 'hover:bg-grey-100',
      ].join(' ')}
    >
      <span
        className={[
          'block text-[13px]',
          // A note is read, not scanned: it wraps to a few lines the way a
          // message does, where a filename is one line and truncates.
          item.kind === 'note' ? 'line-clamp-4 whitespace-pre-wrap' : 'truncate',
          unread
            ? 'italic text-grey-500'
            : selected
              ? 'font-medium text-grey-900'
              : 'text-grey-800',
        ].join(' ')}
      >
        {item.kind === 'note' ? item.description : label}
      </span>

      {audio ? (
        // Not a link: clicking the transport must not also select the row and
        // scroll the pane out from under the thing you are listening to.
        <div className="mt-1.5" onClick={(e) => e.preventDefault()}>
          <audio src={audio} controls preload="none" className="h-8 w-full max-w-sm" />
        </div>
      ) : null}

      {item.kind === 'location' && item.lat !== null && item.lng !== null ? (
        <span className="mt-1 flex items-center gap-1 text-[11px] text-grey-500">
          <IconPlace />
          <a
            href={mapUrl(item.lat, item.lng)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="tabular-nums underline underline-offset-2 hover:text-grey-800"
          >
            {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
          </a>
        </span>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        {unread && item.status === 'pending' ? (
          <span className="text-grey-400">waiting to be read</span>
        ) : item.status === 'failed' && item.kind === 'document' ? (
          <span className="text-stale">could not be read</span>
        ) : null}

        {item.docDate ? (
          <span className="tabular-nums text-grey-500">
            {printed.format(new Date(item.docDate))}
          </span>
        ) : null}

        {item.tags.map((tag) => (
          <span
            key={tag.id}
            className="rounded-sm bg-grey-200 px-1.5 py-px text-grey-600"
            title={tag.category}
          >
            {tag.name}
          </span>
        ))}

        {item.linkCount > 0 ? (
          <span className="flex items-center gap-1 text-grey-400">
            <IconLink />
            <span className="tabular-nums">{item.linkCount}</span>
          </span>
        ) : null}
      </div>
    </Link>
  );
}
