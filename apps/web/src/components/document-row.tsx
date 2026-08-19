'use client';

import Link from 'next/link';
import { BOX_COLUMNS } from '@/lib/columns';
import type { ViewMode } from '@/lib/pane';
import { documentLabel, type BoxItemRow } from '@/lib/queries.shared';
import { IconLink } from './icons';
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
  const unread = item.status !== 'ready';

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
          'block truncate text-[13px]',
          unread
            ? 'italic text-grey-500'
            : selected
              ? 'font-medium text-grey-900'
              : 'text-grey-800',
        ].join(' ')}
      >
        {label}
      </span>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        {item.status === 'pending' ? (
          <span className="text-grey-400">waiting to be read</span>
        ) : item.status === 'failed' ? (
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
