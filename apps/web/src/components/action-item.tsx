'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { setActionStatus } from '@/lib/actions';
import {
  ACTION_COLUMNS,
  PROJECT_ACTION_COLUMNS,
  WAITING_COLUMNS,
} from '@/lib/columns';
import type { ViewMode } from '@/lib/pane';
import { daysSince, isStale, standingOf, type ActionRow } from '@/lib/queries.shared';
import { DragGrip } from './sortable';
import { SimpleRow } from './simple-row';
import { IconCalendar, IconLater } from './icons';

/**
 * "Tue 14:00", "23 Feb", "not until 1 Mar" — or nothing at all.
 *
 * Read off the row rather than passed in, because every list that draws an
 * action wants the same answer and threading a flag through five call sites is
 * how two of them end up disagreeing.
 *
 * Today's bookings say nothing here: they are in the scheduled block with the
 * clock beside them already, and repeating it in the pool would only be
 * possible for a row that is in both, which none are.
 */
function whenLabel(action: ActionRow): string | null {
  const standing = standingOf(action.scheduledAt);

  if (action.scheduledAt && standing === 'ahead') {
    const when = action.scheduledAt;
    const sameYear = when.getFullYear() === new Date().getFullYear();
    return dayAndTime.format(when) + (sameYear ? '' : ` ${when.getFullYear()}`);
  }

  if (action.deferUntil) {
    // Local midnight, never `new Date('2026-03-01')`, which is UTC by
    // specification and reads as the previous evening west of Greenwich.
    const day = new Date(`${action.deferUntil}T00:00:00`);
    return Number.isNaN(day.getTime())
      ? null
      : `not until ${dayOnly.format(day)}`;
  }

  return null;
}

const dayAndTime = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const dayOnly = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
import { RowEmoji } from './row-emoji';

/**
 * One row in the middle pane. The checkbox completes; the row body selects.
 *
 * Three densities: `comfortable` wraps metadata onto a second line, `compact`
 * lays the same fields out as table columns — the old Evernote list view — and
 * `simple` drops the metadata entirely.
 */
export function ActionItem({
  action,
  href,
  selected,
  showProject = true,
  isDragging = false,
  mode = 'comfortable',
  variant = 'default',
  emojified = false,
}: {
  action: ActionRow;
  href: string;
  selected: boolean;
  showProject?: boolean;
  isDragging?: boolean;
  mode?: ViewMode;
  /** 'waiting' swaps the contexts column for who you're waiting on. */
  variant?: 'default' | 'waiting';
  /**
   * Whether *this list* has been emojified — not whether this row has an emoji.
   *
   * A row with none still holds the slot when its neighbours have one, or the
   * titles stop starting on the same line. So the answer has to come from the
   * list, which is the only thing that can see the other rows.
   */
  emojified?: boolean;
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

  if (mode === 'simple') {
    return (
      <SimpleRow
        href={href}
        title={action.title}
        emoji={emojified ? action.emoji : undefined}
        selected={selected}
        muted={done}
        /* Greyed but not crossed out — a finished step is the record of how
           this was done, not something to disregard. */
        struck={false}
        faded={pending || isDragging}
        control={checkbox}
        /*
         * A when, as a flag rather than as words.
         *
         * This view drops metadata on purpose, and a date is metadata — but a
         * row that has been put off until March or booked for Tuesday is not
         * *available*, and in a column of plain titles it would look identical
         * to one that is. That is the same argument the paperclip already won
         * here: what the row carries earns a mark, and the mark goes on the
         * right so the left edge stays straight. The words are in the title
         * attribute, which is where a flag's detail belongs.
         */
        after={
          whenLabel(action) ? (
            <span className="shrink-0 text-grey-400" title={whenLabel(action) ?? undefined}>
              {action.deferUntil ? <IconLater /> : <IconCalendar />}
            </span>
          ) : null
        }
      />
    );
  }

  if (mode === 'compact') {
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
          <RowEmoji emoji={emojified ? action.emoji : undefined} />
          <Link
            href={href}
            draggable={false}
            className={[
              'min-w-0 flex-1 truncate',
              done
                ? 'text-grey-400'
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
      <span className="mt-0.5">
        <RowEmoji emoji={emojified ? action.emoji : undefined} />
      </span>

      {/* draggable={false}: an <a> is natively draggable and would hijack the
          row's drag with a link drag instead. */}
      <Link href={href} draggable={false} className="min-w-0 flex-1">
        <span
          className={[
            'block truncate text-[13px]',
            done
              ? 'text-grey-400'
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

          {/*
            When, where there is a when.
            
            Both of these are rows that are *not* in today's scheduled block —
            one booked for a later day, one put off until a later day — so the
            chip is the only thing on screen saying so. Without it a deferred
            row seen on its project looks identical to a live one, and a row
            booked for Tuesday looks like something to do this afternoon.
            
            Greyscale, because neither is a warning: the semantic three are
            spoken for and a date is a fact rather than a state.
          */}
          {whenLabel(action) ? (
            <span className="rounded-sm bg-grey-150 px-1.5 py-px text-grey-600">
              {whenLabel(action)}
            </span>
          ) : null}
        </div>
      </Link>
    </div>
  );
}
