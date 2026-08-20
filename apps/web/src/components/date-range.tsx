'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

const label = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const DAY = 86_400_000;

/** Midnight at the start of a date, locally. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Days counted from a fixed first day, not from the epoch.
 *
 * Epoch-days looked simpler and were wrong: local midnight in a timezone ahead
 * of UTC is the *previous* day in UTC, so dividing by 86,400,000 floors to the
 * day before, and converting back needed an offset fudge that put the label a
 * day behind the URL. Counting from `earliest` with `setDate` sidesteps both —
 * the calendar does the arithmetic, including across a daylight-saving change.
 */
function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

function addDays(from: Date, days: number): Date {
  const date = startOfDay(from);
  date.setDate(date.getDate() + days);
  return date;
}

/** `YYYY-MM-DD` in local time — `toISOString` is UTC and shifts the date. */
function iso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * When, as a range you drag.
 *
 * A box is ordered by arrival, so "sometime last spring" is how you actually
 * remember where something is — closer to flicking through a pile than to
 * typing two dates into two fields. Two handles on one track say the same
 * thing with one gesture, and combine with the tags: both narrow the same list,
 * so the tag counts beside each label are counts *within* the chosen span.
 *
 * Two overlaid range inputs rather than a hand-built track. They come with
 * keyboard support, focus rings and touch targets already correct, which a div
 * with pointer handlers has to reinvent and usually gets wrong. The trick is
 * that the inputs are transparent to the pointer except at their thumbs — see
 * `.range-dual` in globals.css.
 */
export function DateRange({
  boxId,
  earliest,
  latest,
  from: fromDate,
  to: toDate,
}: {
  boxId: string;
  earliest: Date;
  latest: Date;
  /** The range currently in the URL, as `YYYY-MM-DD`. */
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  // Index 0 is the day the box starts; the handles slide over whole days.
  const min = 0;
  const max = daysBetween(earliest, latest);
  const dayAt = (index: number) => addDays(earliest, index);

  /**
   * Seeded once, and re-seeded by remounting.
   *
   * The handles have to follow the cursor, so they need local state; they also
   * have to follow the URL when it changes for some other reason — "Whole box",
   * or arriving on a kept link. An effect syncing the two is the usual answer
   * and the wrong one: it is a second source of truth that has to be kept in
   * step. The call site keys this component on the range instead, so a change
   * in the URL is a fresh mount and the initialiser runs again. Same rule as
   * every other pane in this app that holds a draft.
   */
  const [from, setFrom] = useState(
    fromDate ? Math.max(min, daysBetween(earliest, new Date(fromDate))) : min,
  );
  const [to, setTo] = useState(
    toDate ? Math.min(max, daysBetween(earliest, new Date(toDate))) : max,
  );

  // A box whose entries all landed on one day has no range to choose.
  if (max <= min) return null;

  /**
   * Written on release, never during the drag.
   *
   * Each commit is a server round trip that re-queries the box; doing that per
   * pixel would be the pane-resize mistake again, one request per frame.
   */
  const commit = (nextFrom: number, nextTo: number) => {
    const next = new URLSearchParams(params);

    if (nextFrom > min) next.set('from', iso(dayAt(nextFrom)));
    else next.delete('from');

    if (nextTo < max) next.set('to', iso(dayAt(nextTo)));
    else next.delete('to');

    // Dropping the selection keeps the URL honest: a filter at full width is
    // no filter, and should leave no trace to puzzle over later.
    next.delete('doc');

    const query = next.toString();
    router.replace(query ? `/box/${boxId}?${query}` : `/box/${boxId}`, {
      scroll: false,
    });
  };

  const narrowed = from > min || to < max;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[10px] text-grey-500">
        <span className="tabular-nums">
          {label.format(dayAt(from))} — {label.format(dayAt(to))}
        </span>
        {narrowed ? (
          <button
            type="button"
            onClick={() => {
              setFrom(min);
              setTo(max);
              commit(min, max);
            }}
            className="underline underline-offset-2 hover:text-grey-800"
          >
            Whole box
          </button>
        ) : null}
      </div>

      <div className="range-dual relative h-4">
        {/* The track, and the chosen span picked out on it. */}
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-grey-300" />
        <span
          className="pointer-events-none absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-selected"
          style={{
            left: `${((from - min) / (max - min)) * 100}%`,
            right: `${100 - ((to - min) / (max - min)) * 100}%`,
          }}
        />

        <input
          type="range"
          min={min}
          max={max}
          value={from}
          aria-label="Earliest"
          // Never past the other handle: crossing them would ask for a range
          // that runs backwards, and every result would vanish.
          onChange={(e) => setFrom(Math.min(Number(e.target.value), to))}
          onPointerUp={() => commit(from, to)}
          onKeyUp={() => commit(from, to)}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={to}
          aria-label="Latest"
          onChange={(e) => setTo(Math.max(Number(e.target.value), from))}
          onPointerUp={() => commit(from, to)}
          onKeyUp={() => commit(from, to)}
        />
      </div>
    </div>
  );
}
