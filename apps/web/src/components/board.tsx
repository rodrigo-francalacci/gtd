'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { ViewMode } from '@/lib/pane';
import { ViewToggle } from './view-toggle';

/**
 * A grouped list, laid out as lanes across the whole window.
 *
 * Two lists here are already cut into groups you move things *between* — a
 * purchases list by what each thing would do, and the Now list by the headings
 * you write yourself. Both answer their question far better grouped than as one
 * column. What neither can do in a pane is the thing you actually spend the
 * time on: stacked down a narrow column, dragging from the bottom of one group
 * to the top of another is a drag across two scrolls, and you cannot see both
 * ends of it while you do it. Side by side it is one short movement with both
 * ends on screen.
 *
 * So this is not a new way of looking at either list — it is the same groups
 * with the same drop targets, given the width the gesture needs. Which is also
 * why it takes the window rather than sitting in pane two: four readable lanes
 * plus somewhere to read the selected row does not fit in a third of a screen,
 * and anything narrower would be the pane again with more steps.
 *
 * Generic on purpose. It knows about lanes, a reading side and a way out; what
 * a lane *is* and what the side shows are the page's business, because both are
 * Server Components with their own queries behind them.
 *
 * **The densities come with it.** They are the answer to "what do I need to see
 * about each row", and that question does not change because the rows are
 * arranged differently — a board of titles is exactly right when you are sorting
 * thirty things quickly, and the columns are exactly right when the prices are
 * what you are deciding on. The toggle is in the header for that reason.
 *
 * **Desktop, and the way in says so.** The button that opens this is hidden on
 * a phone, because four lanes on a 390-pixel screen is one lane you scroll
 * sideways to, and because dragging is a mouse gesture here — HTML5 DnD has no
 * touch support anywhere in this app. The board itself still degrades rather
 * than refusing: land on the URL on a narrow screen and the lanes stack, which
 * is the layout you already had.
 */
export function Board({
  title,
  subtitle,
  closeHref,
  deselectHref,
  viewMode,
  viewKey,
  columns,
  laneCount,
  side,
}: {
  title: string;
  /** The candidate count and the open total, as the list pane shows them. */
  subtitle: ReactNode;
  /** Back to the ordinary three panes, with every filter still on. */
  closeHref: string;
  /**
   * The board with nothing selected — where a click on empty space goes.
   *
   * Side by side, the reading column is the *only* thing that changes when you
   * select a row, and on a purchases list what it changes away from is the
   * budget: the thing you were consulting while you sorted. Clicking empty
   * space is how you put it back — the gesture a desktop has always had for
   * "never mind", and the one pane three already answers this way.
   */
  deselectHref: string;
  viewMode: ViewMode;
  viewKey: string;
  /** The lanes, rendered by the page. */
  columns: ReactNode;
  /**
   * How many there are, which the page knows and the DOM does not.
   *
   * A fixed four-column grid was right for the purchases list, which has
   * exactly four buckets, and wrong the moment the Now list arrived with three
   * headings and left a quarter of the board empty. Capped at four across:
   * past that the lanes wrap to a second row, which a board has the height for
   * and which beats five columns too narrow to read a title in.
   */
  laneCount: number;
  /**
   * The selected row, or whatever the page shows when nothing is — the budget
   * on a purchases list, a hint on the Now list.
   */
  side: ReactNode;
}) {
  const router = useRouter();

  /*
   * Escape closes it, which is what every full-screen thing on this machine
   * does. `router.push` rather than `back()`: the board is a URL, and the way
   * out has to be the same whether you opened it with the button, followed a
   * link into it, or refreshed the page while it was open.
   */
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      // Not while something is being typed into — Escape means "abandon this
      // field" first, and closing the whole board out from under a half-written
      // price is the kind of thing you only forgive once.
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable)
      ) {
        return;
      }

      router.push(closeHref);
    };

    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [router, closeHref]);

  return (
    <div
      /*
       * The surface markers, so the theme with three grounds reaches this too.
       *
       * `data-surface`, not `data-pane` — that is the attribute those rules
       * address, and getting it wrong is silent: the board simply renders on
       * the base tokens with no texture and no charcoal reading column, looking
       * like the one screen in the app that belongs to a different app.
       *
       * The lanes are the list and the reading side is the detail, because that
       * is what they are. A board is the same two panes at a different size.
       */
      data-surface="list"
      /*
       * `z-50`, and the number is not arbitrary.
       *
       * The sidebar's wrapper is `relative z-50`, so anything below that is
       * painted *under* the navigation — which at `z-30` meant the first lane
       * sat behind it, cut off, on a view whose whole point is seeing all four
       * at once. Matching it wins on source order instead, because the board is
       * rendered after the sidebar.
       *
       * It must not go higher. The row menus and the theme switcher portal to
       * the body at `z-50` too, and they are later in the document still — so
       * they land above this, which is what a right-click on a row here needs.
       * Raising the board would put every menu behind it.
       */
      className="fixed inset-0 z-50 flex flex-col bg-paper"
    >
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-grey-200 px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-[13px] font-semibold text-grey-900">{title}</h1>
          <p className="truncate text-[11px] text-grey-500">{subtitle}</p>
        </div>

        <div className="flex items-center gap-3">
          <ViewToggle mode={viewMode} viewKey={viewKey} />
          <Link
            href={closeHref}
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            Close
          </Link>
        </div>
      </header>

      {/*
        Lanes and the reading side.

        `minmax(0, …)` on both tracks rather than `auto`: a grid track sized by
        its content refuses to shrink below it, so one long purchase title would
        push the whole board wider than the window and the page would scroll
        sideways — which is the thing every pane in this app is told not to do.

        The side is `28rem` because it holds the same panel pane three does, and
        that pane's own measure is 38rem including its padding; narrower than
        about 28 and the note editor inside it starts wrapping at every comma.
      */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:overflow-hidden">
        {/*
          A click that lands on nothing deselects.

          Tested by what was *pressed* rather than by `target === currentTarget`
          — the empty space inside a lane belongs to the lane, not to this
          wrapper, so the strict test would catch only the gaps between lanes
          and miss the large obvious place to click. Anything interactive is
          left alone, which is the whole of the rule: a row, a checkbox, a grip
          and a menu all mean something already.
        */}
        <div
          style={{
            // Inline because the count is data, and Tailwind cannot generate a
            // class for a number it has never seen.
            gridTemplateColumns: `repeat(${Math.min(Math.max(laneCount, 1), 4)}, minmax(0, 1fr))`,
          }}
          onClick={(event) => {
            const hit = event.target as HTMLElement | null;
            if (
              hit?.closest(
                'a, button, input, textarea, select, label, [role="menu"], [draggable="true"]',
              )
            ) {
              return;
            }
            router.push(deselectHref);
          }}
          /*
           * The template above applies from `xl` up, where there is room for
           * lanes side by side; below that the arbitrary-value classes win and
           * the lanes stack or pair, which is the layout the pane already had.
           */
          className="grid min-h-0 grid-cols-1 gap-3 max-xl:!grid-cols-[repeat(2,minmax(0,1fr))] max-md:!grid-cols-1"
        >
          {columns}
        </div>

        <aside
          data-surface="detail"
          className="min-h-0 overflow-y-auto overflow-x-clip rounded-sm border border-grey-200 px-5 py-4"
        >
          {side}
        </aside>
      </div>
    </div>
  );
}
