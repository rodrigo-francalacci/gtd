'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { setActionStatus } from '@/lib/actions';
import {
  ACTION_COLUMNS,
  PROJECT_ACTION_COLUMNS,
  WAITING_COLUMNS,
} from '@/lib/columns';
import { daysSince, isStale, type ActionRow } from '@/lib/queries.shared';
import { DragGrip } from './sortable';

/**
 * One row in the middle pane. The checkbox completes; the row body selects.
 *
 * Two densities: `comfortable` wraps metadata onto a second line, `compact`
 * lays the same fields out as table columns — the old Evernote list view.
 */
export function ActionItem({
  action,
  href,
  selected,
  showProject = true,
  isDragging = false,
  compact = false,
  variant = 'default',
}: {
  action: ActionRow;
  href: string;
  selected: boolean;
  showProject?: boolean;
  isDragging?: boolean;
  compact?: boolean;
  /** 'waiting' swaps the contexts column for who you're waiting on. */
  variant?: 'default' | 'waiting';
}) {
  const [pending, startTransition] = useTransition();

  const stale = action.status === 'waiting' && isStale(action.waitingSince);
  const days = daysSince(action.waitingSince);
  const done = action.status === 'done';

  const checkbox = (
    <button
      type="button"
      aria-label={done ? 'Mark not done' : 'Mark done'}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setActionStatus(action.id, done ? 'next' : 'done');
        })
      }
      className={[
        'h-3.5 w-3.5 shrink-0 rounded-[3px] border',
        done
          ? 'border-grey-500 bg-grey-500'
          : 'border-grey-400 bg-paper hover:border-grey-600',
      ].join(' ')}
    />
  );

  const stateLabel = () => {
    if (done) return <span className="text-grey-400">done</span>;
    if (action.status === 'future')
      return <span className="text-grey-500">future</span>;
    if (action.status !== 'waiting') return <span className="text-grey-400">next</span>;
    return (
      <span className={stale ? 'font-medium text-stale' : 'text-waiting'}>
        {days === null ? 'waiting' : `${days}d`}
      </span>
    );
  };

  if (compact) {
    const columns =
      variant === 'waiting'
        ? WAITING_COLUMNS
        : showProject
          ? ACTION_COLUMNS
          : PROJECT_ACTION_COLUMNS;

    return (
      <div
        style={{ gridTemplateColumns: columns.template }}
        className={[
          'group grid items-center gap-2 border-b border-grey-150 px-4 py-1 text-[12px]',
          selected ? 'bg-selected-bg' : 'hover:bg-grey-100',
          pending || isDragging ? 'opacity-40' : '',
        ].join(' ')}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <DragGrip />
          {checkbox}
          <Link
            href={href}
            draggable={false}
            className={[
              'min-w-0 flex-1 truncate',
              done
                ? 'text-grey-400 line-through'
                : selected
                  ? 'font-medium text-grey-900'
                  : 'text-grey-800',
            ].join(' ')}
          >
            {action.title}
          </Link>
        </div>

        {showProject ? (
          <span className="truncate text-grey-500">{action.projectTitle ?? '—'}</span>
        ) : null}

        <span className="truncate text-grey-500">
          {variant === 'waiting'
            ? (action.waitingOn ?? '—')
            : action.contexts.length > 0
              ? action.contexts.map((c) => c.name).join(', ')
              : '—'}
        </span>

        <span className="truncate">{stateLabel()}</span>
      </div>
    );
  }

  return (
    <div
      className={[
        'group flex items-start gap-2 border-b border-grey-150 px-4 py-2.5',
        selected ? 'bg-selected-bg' : 'hover:bg-grey-100',
        pending ? 'opacity-50' : '',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <DragGrip />
      <span className="mt-0.5">{checkbox}</span>

      {/* draggable={false}: an <a> is natively draggable and would hijack the
          row's drag with a link drag instead. */}
      <Link href={href} draggable={false} className="min-w-0 flex-1">
        <span
          className={[
            'block truncate text-[13px]',
            done
              ? 'text-grey-400 line-through'
              : selected
                ? 'font-medium text-grey-900'
                : 'text-grey-800',
          ].join(' ')}
        >
          {action.title}
        </span>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          {showProject && action.projectTitle ? (
            <span className="truncate text-grey-500">{action.projectTitle}</span>
          ) : null}

          {action.contexts.map((c) => (
            <span
              key={c.id}
              className="rounded-sm bg-grey-200 px-1.5 py-px text-grey-600"
              title={c.dimension}
            >
              {c.name}
            </span>
          ))}

          {action.status === 'waiting' ? (
            <span
              className={[
                'rounded-sm px-1.5 py-px font-medium',
                stale ? 'bg-stale-bg text-stale' : 'bg-waiting-bg text-waiting',
              ].join(' ')}
            >
              {days === null
                ? 'waiting'
                : stale
                  ? `waiting ${days}d — chase it`
                  : `waiting ${days}d`}
            </span>
          ) : null}

          {action.status === 'waiting' ? (
            <span className="truncate text-grey-500">
              {action.waitingOn ? `on ${action.waitingOn}` : 'on ?'}
            </span>
          ) : null}
        </div>
      </Link>
    </div>
  );
}
