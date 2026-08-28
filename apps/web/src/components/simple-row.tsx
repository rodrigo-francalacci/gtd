'use client';

import Link from 'next/link';
import type { HTMLAttributes, ReactNode } from 'react';
import { DragGrip } from './sortable';
import { RowEmoji } from './row-emoji';

/**
 * One row in the titles-only view.
 *
 * Shared rather than written out per row type, because once the metadata is
 * gone there is nothing left to vary: an action, a project, a list item and a
 * capture are all just the line you wrote. Four near-identical copies would be
 * four places for the padding to drift apart.
 *
 * Controls stay; information goes. The checkbox and the drag grip are how you
 * act on a row rather than facts about it, so a view that dropped them would
 * be a weaker list instead of a quieter one — and the grip is invisible until
 * you hover, so it costs the view nothing.
 *
 * No hairline between rows either. Rules are what turn a list into a table,
 * and the one thing this view is for is not being one.
 */
export function SimpleRow({
  href,
  title,
  emoji,
  selected,
  muted = false,
  struck,
  faded = false,
  grip = true,
  control,
  after,
  highlight,
  ...handlers
}: {
  href: string;
  title: ReactNode;
  /**
   * One emoji in front of the title, in a slot of fixed width.
   *
   * `undefined` means this list has no emoji at all and there is no slot;
   * `null` means this row has none but its neighbours do, so the space is still
   * held. Reserved rather than conditional, for the same reason the flags above
   * are trailing — a glyph on only some rows leaves the left edge ragged, which
   * in a column of titles is the one thing there is to get right.
   */
  emoji?: string | null;
  selected: boolean;
  /** Finished: greyed back, as in the other views. */
  muted?: boolean;
  /**
   * Struck through as well. Defaults to `muted`, which is what it always
   * meant — until a finished *action* stopped wanting it. A done step on a
   * project is reference: how the thing was actually done, read months later
   * by someone doing it again. A line through it says "disregard", which is
   * the opposite. A settled purchase is different and keeps the rule: that
   * one really is closed, and the list is a shortlist rather than a record.
   */
  struck?: boolean;
  /** Mid-drag or mid-mutation. */
  faded?: boolean;
  grip?: boolean;
  /** A checkbox, for rows that have one. */
  control?: ReactNode;
  /**
   * Flags for what else the row carries — a paperclip, a note.
   *
   * Trailing, because they are on some rows and not others: in front of the
   * title they indented the rows that had them and left a ragged left edge,
   * which in a view whose entire content is a column of titles is the one
   * thing there is to get right.
   */
  after?: ReactNode;
  /** A live drop target, ringed the way the other densities ring it. */
  highlight?: boolean;
  // The rest are the drop handlers a project row needs. `title` is omitted
  // because a div's own `title` is a string and ours is a node — without the
  // omit, the intersection quietly becomes `never` and every caller fails on
  // a line that has nothing wrong with it.
} & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  return (
    <div
      {...handlers}
      className={[
        'group flex items-center gap-1.5 px-4 py-1.5 text-[13px]',
        highlight
          ? 'bg-selected-bg ring-1 ring-inset ring-selected'
          : selected
            ? 'bg-selected-bg'
            : 'hover:bg-grey-100',
        faded ? 'opacity-40' : '',
      ].join(' ')}
    >
      {grip ? <DragGrip /> : null}
      {control}
      <RowEmoji emoji={emoji} />

      {/* draggable={false}: an <a> drags itself by default, which would hijack
          the row's own drag with a link drag. */}
      <Link
        href={href}
        draggable={false}
        className={[
          'min-w-0 flex-1 truncate',
          muted
            ? (struck ?? true)
              ? 'text-grey-400 line-through'
              : 'text-grey-400'
            : selected
              ? 'font-medium text-grey-900'
              : 'text-grey-800',
        ].join(' ')}
      >
        {title}
      </Link>

      {after}
    </div>
  );
}
