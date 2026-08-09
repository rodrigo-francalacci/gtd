'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { setActionStatus } from '@/lib/actions';
import { daysSince, isStale, type ActionRow } from '@/lib/queries.shared';

/**
 * One row in the middle pane. The checkbox completes; the row body selects.
 */
export function ActionItem({
  action,
  href,
  selected,
  showProject = true,
}: {
  action: ActionRow;
  href: string;
  selected: boolean;
  showProject?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const stale = action.status === 'waiting' && isStale(action.waitingSince);
  const days = daysSince(action.waitingSince);

  return (
    <div
      className={[
        'group flex items-start gap-2 border-b border-grey-150 px-4 py-2.5',
        selected ? 'bg-selected-bg' : 'hover:bg-grey-100',
        pending ? 'opacity-50' : '',
      ].join(' ')}
    >
      <button
        type="button"
        aria-label={action.status === 'done' ? 'Mark not done' : 'Mark done'}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await setActionStatus(action.id, action.status === 'done' ? 'next' : 'done');
          })
        }
        className={[
          'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[3px] border',
          action.status === 'done'
            ? 'border-grey-500 bg-grey-500'
            : 'border-grey-400 bg-paper hover:border-grey-600',
        ].join(' ')}
      />

      <Link href={href} className="min-w-0 flex-1">
        <span
          className={[
            'block truncate text-[13px]',
            action.status === 'done'
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
        </div>
      </Link>
    </div>
  );
}
