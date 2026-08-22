'use client';

import Link from 'next/link';
import { LIST_ITEM_COLUMNS, PURCHASE_COLUMNS } from '@/lib/columns';
import {
  IMPACT_SHORT,
  WHERE_LABELS,
  formatMoney,
  type ListItemRow as Row,
} from '@/lib/queries.shared';
import type { ViewMode } from '@/lib/pane';
import { DragGrip } from './sortable';
import { SimpleRow } from './simple-row';
import { TrialTick } from './budget-trial';

/**
 * A list item. The visual weight is deliberately lower than an action row:
 * nothing here is a commitment until it's promoted, and the row says so.
 */
export function ListItemRow({
  item,
  href,
  selected,
  isPurchases,
  isDragging = false,
  mode = 'comfortable',
}: {
  item: Row;
  href: string;
  selected: boolean;
  isPurchases: boolean;
  isDragging?: boolean;
  mode?: ViewMode;
}) {
  const cost = item.fields?.cost;
  const impact = item.fields?.impact;
  const where = item.fields?.where;

  /*
   * Only a candidate can be tried, because trying one asks what committing it
   * would cost — and a committed item has already answered that. `TrialTick`
   * renders nothing off a budget list, so this stays out of the way of every
   * list that is not about money.
   */
  const tick =
    isPurchases && item.stage === 'candidate' ? <TrialTick id={item.id} /> : null;

  const stageLabel = (
    <span
      className={
        item.stage === 'committed'
          ? 'text-waiting'
          : item.stage === 'settled'
            ? 'text-grey-400'
            : 'text-grey-500'
      }
    >
      {item.stage === 'candidate'
        ? 'candidate'
        : item.stage === 'committed'
          ? 'committed'
          : 'done'}
    </span>
  );

  if (mode === 'simple') {
    return (
      <SimpleRow
        href={href}
        title={item.title}
        selected={selected}
        muted={item.stage === 'settled'}
        faded={isDragging}
        control={tick}
      />
    );
  }

  if (mode === 'compact') {
    const columns = isPurchases ? PURCHASE_COLUMNS : LIST_ITEM_COLUMNS;

    return (
      <div
        style={{ gridTemplateColumns: columns.template }}
        className={[
          'group grid items-center gap-2 border-b border-grey-150 px-4 py-1 text-[12px]',
          selected ? 'bg-selected-bg' : 'hover:bg-grey-100',
          isDragging ? 'opacity-40' : '',
        ].join(' ')}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <DragGrip />
          {tick}
          <Link
            href={href}
            draggable={false}
            className={[
              'min-w-0 flex-1 truncate',
              item.stage === 'settled'
                ? 'text-grey-400 line-through'
                : selected
                  ? 'font-medium text-grey-900'
                  : 'text-grey-800',
            ].join(' ')}
          >
            {item.title}
          </Link>
        </div>

        {isPurchases ? (
          <>
            <span className="tabular-nums text-grey-600">
              {typeof cost === 'number' ? formatMoney(cost) : '—'}
            </span>
            <span
              className={[
                'truncate',
                impact === 'blocks' ? 'text-stale' : 'text-grey-500',
              ].join(' ')}
            >
              {impact ? IMPACT_SHORT[impact] : '—'}
            </span>
            <span className="truncate">{stageLabel}</span>
          </>
        ) : (
          <>
            <span className="truncate">{stageLabel}</span>
            <span className="truncate text-grey-500">{item.projectTitle ?? '—'}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className={[
        'group flex items-start gap-2 border-b border-grey-150 px-4 py-2.5',
        selected ? 'bg-selected-bg' : 'hover:bg-grey-100',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <DragGrip />
      {/* Nudged down to sit on the title's baseline rather than above it —
          the row aligns to `items-start` so the metadata line stays put. */}
      {tick ? <span className="mt-1 flex">{tick}</span> : null}

      <Link href={href} draggable={false} className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={[
              'truncate text-[13px]',
              item.stage === 'settled'
                ? 'text-grey-400 line-through'
                : selected
                  ? 'font-medium text-grey-900'
                  : 'text-grey-800',
            ].join(' ')}
          >
            {item.title}
          </span>
          {isPurchases && typeof cost === 'number' ? (
            <span className="shrink-0 text-[12px] tabular-nums text-grey-600">
              {formatMoney(cost)}
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          {item.stage === 'candidate' ? (
            <span className="text-grey-400">candidate</span>
          ) : item.stage === 'committed' ? (
            <span className="rounded-sm bg-waiting-bg px-1.5 py-px font-medium text-waiting">
              committed
            </span>
          ) : (
            <span className="text-grey-400">done</span>
          )}

          {item.projectTitle ? (
            <span className="truncate text-grey-500">{item.projectTitle}</span>
          ) : null}

          {impact ? (
            <span
              className={[
                'rounded-sm px-1.5 py-px',
                impact === 'blocks'
                  ? 'bg-stale-bg text-stale'
                  : 'bg-grey-200 text-grey-600',
              ].join(' ')}
            >
              {IMPACT_SHORT[impact]}
            </span>
          ) : null}

          {where ? (
            <span className="rounded-sm bg-grey-200 px-1.5 py-px text-grey-600">
              {WHERE_LABELS[where]}
            </span>
          ) : null}
        </div>
      </Link>
    </div>
  );
}
