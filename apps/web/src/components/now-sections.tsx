'use client';

import { useState, useTransition, type ReactNode } from 'react';
import {
  createActionInSection,
  createNowSection,
  deleteNowSection,
  moveActionToSection,
  moveNowSectionBetween,
  renameNowSection,
} from '@/lib/actions';
import { DRAG_ACTION, dragPayload, hasDragType, reallyLeft } from './sortable';
import { RowMenu } from './row-menu';

/**
 * A heading you wrote, with the actions you dragged under it.
 *
 * The list already answers *what could I do* — this answers *in what order am I
 * going to*, which nothing else here expresses. A project says what a step
 * belongs to and a context says where it can be done; neither says "not until
 * the money is sorted". So a section holds nothing and means nothing: it is a
 * line of text with a drop target attached, and an action under one is exactly
 * the action it was.
 *
 * Rename and delete come from `RowMenu`, the same right-click and press-and-hold
 * every other row in the app answers to — a heading is a row, and giving it its
 * own pair of buttons would be two more controls to learn for something the
 * gesture already covers.
 */
export function NowSection({
  id,
  title,
  count,
  prevId,
  children,
  variant = 'row',
}: {
  id: string;
  title: string;
  count: number;
  /**
   * The heading above this one, so a heading dropped here lands between the two
   * — which is what dropping *on* something means everywhere else in this app.
   */
  prevId: string | null;
  children: ReactNode;
  /**
   * `row` stacks down the list pane; `column` is one lane of the board.
   *
   * The same drop target either way, which is the whole reason this is a
   * variant rather than a second component — a board that reimplemented the
   * drop would be a second place to get the `dragleave` trap right, and it is
   * the one that would be missed.
   */
  variant?: 'row' | 'column';
}) {
  const [over, setOver] = useState<'action' | 'section' | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section
      onDragOver={(e) => {
        const action = hasDragType(e, DRAG_ACTION);
        const section = hasDragType(e, DRAG_SECTION);
        if (!action && !section) return;

        // Marking this a valid target at all — without it no drop ever fires.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(action ? 'action' : 'section');
      }}
      /*
       * Cleared in the capture phase, for the reason the action buckets clear
       * theirs: a reorder handled by the list inside stops the bubble, and a
       * bubble-phase clear would then never run and leave the heading lit.
       */
      onDragLeaveCapture={(e) => {
        if (reallyLeft(e)) setOver(null);
      }}
      onDropCapture={() => setOver(null)}
      onDrop={(e) => {
        const action = dragPayload(e, DRAG_ACTION);
        const section = dragPayload(e, DRAG_SECTION);
        if (!action && !section) return;

        e.preventDefault();
        setOver(null);

        startTransition(async () => {
          if (action) await moveActionToSection(action, id);
          // A heading dropped on itself would be asked to sit between its own
          // neighbours, which is where it already is.
          else if (section && section !== id) {
            await moveNowSectionBetween(section, prevId, id);
          }
        });
      }}
      className={[
        variant === 'column'
          ? 'flex min-h-0 min-w-0 flex-col rounded-sm border border-grey-200'
          : '',
        pending ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined}
    >
      <RowMenu
        name={title}
        /*
         * The verb the arrangement was missing. Right-click is already how you
         * ask a row what it can do, and adding *into* a heading is the thing
         * you want most while you are arranging one — otherwise the action is
         * created in the ungrouped run and dragged up, which is three moves and
         * a step briefly in the wrong place.
         */
        onAdd={(next) => createActionInSection(id, next)}
        addLabel="Add an action here"
        onRename={(next) => renameNowSection(id, next)}
        onDelete={() => deleteNowSection(id)}
        deleteLabel="Remove the heading"
        deleteNote="The actions under it stay — they just stop being grouped."
      >
        <header
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_SECTION, id);
            e.dataTransfer.setData('text/plain', title);
            e.dataTransfer.effectAllowed = 'move';
          }}
          className={[
            'flex cursor-grab items-baseline gap-2 border-b px-4 py-1.5',
            variant === 'column' ? 'shrink-0' : '',
            over === 'action'
              ? 'border-selected bg-selected-bg'
              : over === 'section'
                ? 'border-selected border-t-2'
                : 'border-grey-200 bg-grey-100',
          ].join(' ')}
        >
          <h3 className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-grey-600">
            {title}
          </h3>
          <span className="shrink-0 tabular-nums text-[10px] text-grey-400">{count}</span>
        </header>
      </RowMenu>

      {/*
        A lane is a column of its own height with its own scrollbar: four lanes
        sharing the page's scroll would mean scrolling past the ones you are not
        looking at to reach the bottom of the one you are. `min-h-0` above the
        scroller, or a flex column grows to its content and the board scrolls
        instead.
      */}
      <div
        className={
          variant === 'column'
            ? 'min-h-0 flex-1 overflow-y-auto overflow-x-clip'
            : undefined
        }
      >
        {count === 0 ? (
          <p className="px-4 py-2 text-[11px] text-grey-400">Drag an action here.</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/**
 * What you have committed to today, above the pool of what you could do.
 *
 * The list already answers *what could I do now*; this answers *what did I say
 * I would do now*, which is a different and louder question. Its own block
 * rather than colour on the rows — his own two suggestions, and the block wins
 * because the whole value of a commitment is that it is separate from the
 * pool: a marked row in a list of forty is still a row in a list of forty.
 * Pinned entries in a box get their own block above the days for exactly this
 * reason.
 *
 * **Today and anything overdue, never what is coming.** A slot booked for next
 * Tuesday is not something to do now, and lifting it here would fill the block
 * with things that are not today's — which is the failure that makes people
 * stop reading a calendar. Those rows stay in the pool with their date beside
 * them, which is the marking half of the same idea.
 *
 * Not a drop target and not sortable: the order is the clock's, and a heading
 * you could drag onto would be offering to schedule something for a time
 * nobody named.
 */
export function NowScheduled({
  count,
  late,
  children,
}: {
  count: number;
  /** How many of them have already been and gone. */
  late: number;
  children: ReactNode;
}) {
  if (count === 0) return null;

  return (
    <section>
      <header className="flex items-baseline gap-2 border-b border-grey-200 bg-grey-100 px-4 py-1.5">
        <h3 className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-grey-600">
          Scheduled
        </h3>
        {late > 0 ? (
          /* Said in words rather than as a colour, because "three of these
             were meant to have happened" is the fact, and a red row only
             says that something is wrong with it. */
          <span className="shrink-0 text-[10px] text-stale">{late} gone by</span>
        ) : null}
        <span className="shrink-0 tabular-nums text-[10px] text-grey-400">{count}</span>
      </header>
      {children}
    </section>
  );
}

/** Its own type, so a heading being reordered is not read as an action. */
export const DRAG_SECTION = 'application/x-gtd-now-section';

/**
 * Everything not under a heading, and the target that takes an action back out.
 *
 * Always rendered once any heading exists — an empty group you cannot see is one
 * you cannot drop into, which is the rule the project status buckets already
 * follow. Without it there would be no way to ungroup an action at all.
 */
export function NowLoose({
  count,
  children,
  variant = 'row',
}: {
  count: number;
  children: ReactNode;
  /**
   * `row` stacks down the list pane; `column` is one lane of the board.
   *
   * The same drop target either way, which is the whole reason this is a
   * variant rather than a second component — a board that reimplemented the
   * drop would be a second place to get the `dragleave` trap right, and it is
   * the one that would be missed.
   */
  variant?: 'row' | 'column';
}) {
  const [over, setOver] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <section
      onDragOver={(e) => {
        if (!hasDragType(e, DRAG_ACTION)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeaveCapture={(e) => {
        if (reallyLeft(e)) setOver(false);
      }}
      onDropCapture={() => setOver(false)}
      onDrop={(e) => {
        const actionId = dragPayload(e, DRAG_ACTION);
        if (!actionId) return;

        e.preventDefault();
        setOver(false);
        startTransition(async () => void moveActionToSection(actionId, null));
      }}
      className={[
        variant === 'column'
          ? 'flex min-h-0 min-w-0 flex-col rounded-sm border border-grey-200'
          : '',
        pending ? 'opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined}
    >
      <header
        className={[
          'flex items-baseline gap-2 border-b px-4 py-1.5',
          variant === 'column' ? 'shrink-0' : '',
          over ? 'border-selected bg-selected-bg' : 'border-grey-200 bg-grey-100',
        ].join(' ')}
      >
        <h3 className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-grey-400">
          Everything else
        </h3>
        <span className="shrink-0 tabular-nums text-[10px] text-grey-400">{count}</span>
      </header>

      <div
        className={
          variant === 'column'
            ? 'min-h-0 flex-1 overflow-y-auto overflow-x-clip'
            : undefined
        }
      >
        {count === 0 ? (
          <p className="px-4 py-2 text-[11px] text-grey-400">
            Drag an action here to take it out of a section.
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/** One field, at the foot of the list, because adding one is a rare thing. */
export function AddNowSection() {
  const [title, setTitle] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const next = title.trim();
        if (!next) return;

        setTitle('');
        startTransition(async () => void createNowSection(next));
      }}
      className="border-t border-grey-150 px-4 py-2"
    >
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Add a heading — e.g. After sorting the money"
        aria-label="Add a heading"
        disabled={pending}
        /* 16px, or iOS Safari zooms the page in when it takes focus. */
        className="w-full bg-transparent text-[16px] text-grey-700 placeholder:text-grey-500 focus:outline-none md:text-[12px]"
      />
    </form>
  );
}
