'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { setBoxCalendars } from '@/lib/actions';
import type { BoxCategoryRow } from '@/lib/queries.shared';
import type { EntryType } from '@/lib/queries.shared';
import { FullScreen } from './full-screen';
import { TagFilter } from './tag-filter';
import { TypeFilter } from './type-filter';

/**
 * A box as a month.
 *
 * The feed already reads as a timeline — arrival is the filing system here, and
 * the day headings are the whole of it — but a list can only ever say "these
 * came one after another". A month says *when*: the fortnight nothing arrived,
 * the Tuesday four receipts did, the week the correspondence clustered. That is
 * a different question about the same rows, which is what makes it a view
 * rather than a feature.
 *
 * **Placed by arrival, not by the printed date.** Every entry has an arrival
 * date, so nothing is ever missing from the grid, and the month stays the same
 * filing system laid out differently rather than a second one that disagrees
 * with the feed. A bill dated July that arrived in August sits in August, where
 * you would go looking for it, and the pane still shows what the paper says.
 *
 * **And it can carry a Google calendar, chosen per box.** What was happening
 * that week is often exactly what explains the pile of receipts — but the
 * calendars that belong beside work correspondence are not the ones that belong
 * beside a songwriting journal, so the choice is the box's. It starts empty:
 * most boxes want none, and a month that arrived full of birthdays would be
 * noise nobody asked for.
 *
 * **Nothing is stored.** The events are read from Google when the month is
 * shown, exactly as the calendar page reads them — a stored copy is a second
 * version that can disagree with the real one, and the whole value of showing
 * them is that they agree.
 */

type Entry = {
  id: string;
  title: string;
  emoji: string | null;
  capturedAt: string;
  href: string;
};

type Source = { id: string; name: string; primary: boolean };

type Event = {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
  calendarName?: string;
};

/** Monday-first, because a week here starts where the working week does. */
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** The local day an ISO instant falls on, as `YYYY-MM-DD`. */
function dayKey(value: string): string {
  /*
   * An all-day event is a date with no time, and `new Date('2026-08-22')` is
   * UTC by specification — which west of Greenwich is the evening of the 21st,
   * so a birthday lands under the wrong heading for some readers and not
   * others. The same trap the day-range slider hit counting epoch days.
   */
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Every day drawn in the grid: the month, plus the days that fill its weeks. */
function gridFor(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  // `getDay` is Sunday-first; shift so Monday is 0.
  const lead = (first.getDay() + 6) % 7;

  const start = new Date(year, month, 1 - lead);
  const days: Date[] = [];

  // Six rows always, so the grid does not change height between months —
  // a calendar that reflows as you page through it is one you lose your place
  // in, and the cell you were looking at moves under the cursor.
  for (let i = 0; i < 42; i += 1) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }

  return days;
}

export function BoxCalendar({
  boxId,
  boxName,
  entries,
  closeHref,
  viewKey,
  chosen,
  categories,
  tagIds,
  excludedTags,
  tagCounts,
  typeCounts,
  requestedTypes,
  excludedTypes,
}: {
  boxId: string;
  boxName: string;
  /** Every entry in the box, with the address that opens it. */
  entries: Entry[];
  closeHref: string;
  /** The `view_prefs` row this box's choice is stored against. */
  viewKey: string;
  chosen: string[];
  /**
   * The same filters the feed carries, because they answer the same question
   * about the same rows — "only the receipts" is as reasonable a thing to ask
   * of a month as of a list. Shown rather than merely applied: a filter you
   * have to remember is a month that lies about a quiet fortnight.
   */
  categories: BoxCategoryRow[];
  tagIds: string[];
  excludedTags: string[];
  tagCounts: Record<string, number>;
  typeCounts: Record<string, number>;
  requestedTypes: EntryType[];
  excludedTypes: EntryType[];
}) {
  const today = new Date();
  const [at, setAt] = useState({ year: today.getFullYear(), month: today.getMonth() });

  const [sources, setSources] = useState<Source[] | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [picking, setPicking] = useState(false);
  const [, startTransition] = useTransition();
  const picker = useRef<HTMLDivElement>(null);

  const days = gridFor(at.year, at.month);

  /*
   * Read when the month or the choice changes, and never stored.
   *
   * The window is the whole grid rather than the month, so an event on a
   * leading or trailing day shows in the cell it is drawn in — otherwise the
   * last days of the previous month would look empty when they are not.
   */
  useEffect(() => {
    const from = days[0];
    const to = new Date(
      days[days.length - 1].getFullYear(),
      days[days.length - 1].getMonth(),
      days[days.length - 1].getDate() + 1,
    );

    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    // Always present, even empty: "none chosen" has to be distinguishable from
    // "not asked", or a box with no calendars would show all of them.
    params.append('only', '');
    for (const id of chosen) params.append('only', id);

    let live = true;

    fetch(`/api/calendar?${params}`)
      .then((r) => r.json())
      .then((body: { calendars?: Source[]; events?: Event[] }) => {
        if (!live) return;
        // The full list comes back whatever is chosen, because the picker
        // cannot offer to add a calendar it has never heard of.
        if (body.calendars) setSources(body.calendars);
        setEvents(body.events ?? []);
      })
      .catch(() => {
        // An unreachable Google costs you the events, never the month.
        if (live) setEvents([]);
      });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.year, at.month, chosen.join(',')]);

  /* Close the picker on a press outside — containment, not `stopPropagation`. */
  useEffect(() => {
    if (!picking) return;

    const away = (event: PointerEvent) => {
      if (picker.current?.contains(event.target as Node)) return;
      setPicking(false);
    };

    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [picking]);

  const byDay = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.capturedAt);
    byDay.set(key, [...(byDay.get(key) ?? []), entry]);
  }

  const eventsByDay = new Map<string, Event[]>();
  for (const event of events) {
    const key = dayKey(event.start);
    eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), event]);
  }

  const step = (by: number) =>
    setAt((was) => {
      const next = new Date(was.year, was.month + by, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  const toggle = (id: string) => {
    const next = chosen.includes(id)
      ? chosen.filter((c) => c !== id)
      : [...chosen, id];

    startTransition(async () => {
      await setBoxCalendars(viewKey, next);
    });
  };

  const todayKey = dayKey(today.toISOString());

  return (
    <FullScreen
      title={boxName}
      subtitle={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, by the day each arrived${
        tagIds.length || excludedTags.length || requestedTypes.length || excludedTypes.length
          ? ' · filtered'
          : ''
      }`}
      closeHref={closeHref}
      actions={
        <>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="The month before"
              className="px-1.5 text-[12px] text-grey-500 hover:text-grey-800"
            >
              ‹
            </button>
            <span className="min-w-[9rem] text-center text-[11px] tabular-nums text-grey-700">
              {monthName.format(new Date(at.year, at.month, 1))}
            </span>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="The month after"
              className="px-1.5 text-[12px] text-grey-500 hover:text-grey-800"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => setAt({ year: today.getFullYear(), month: today.getMonth() })}
              className="ml-1 text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
            >
              Today
            </button>
          </div>

          <div className="relative" ref={picker}>
            <button
              type="button"
              onClick={() => setPicking((was) => !was)}
              aria-expanded={picking}
              className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
            >
              Calendars{chosen.length > 0 ? ` (${chosen.length})` : ''}
            </button>

            {picking ? (
              <div className="absolute right-0 top-full z-10 mt-1 w-[15rem] rounded-sm border border-grey-300 bg-paper py-1 shadow-lg">
                {sources === null ? (
                  <p className="px-3 py-1.5 text-[11px] text-grey-500">Asking Google…</p>
                ) : sources.length === 0 ? (
                  <p className="px-3 py-1.5 text-[11px] leading-relaxed text-grey-500">
                    No calendars. Connect Google on the Google page — the
                    calendar is granted separately from Drive.
                  </p>
                ) : (
                  sources.map((source) => (
                    <label
                      key={source.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1 text-[12px] hover:bg-grey-150"
                    >
                      <input
                        type="checkbox"
                        checked={chosen.includes(source.id)}
                        onChange={() => toggle(source.id)}
                      />
                      <span className="truncate text-grey-800">{source.name}</span>
                    </label>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {/*
          The filters, above the grid rather than in the header: the header
          already holds the month, the way to today, the calendars and the way
          out, and these are two wrapping rows of chips. `filterHref` rebuilds
          from the whole current query, so `month=1` comes along and the chips
          keep you here.
        */}
        <div className="mb-2 flex shrink-0 flex-col gap-1.5">
          <TypeFilter
            boxId={boxId}
            counts={typeCounts}
            selected={requestedTypes}
            excluded={excludedTypes}
          />
          <TagFilter
            boxId={boxId}
            categories={categories}
            selected={tagIds}
            excluded={excludedTags}
            counts={tagCounts}
          />
        </div>

        <div className="grid shrink-0 grid-cols-7 gap-px">
          {DAY_NAMES.map((name) => (
            <div
              key={name}
              className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-grey-400"
            >
              {name}
            </div>
          ))}
        </div>

        {/*
          The grid takes the height that is left and each cell scrolls on its
          own. A day with nine receipts must not make its week taller than the
          others — that is the reflow a calendar exists not to do.
        */}
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px rounded-sm bg-grey-200">
          {days.map((day) => {
            const key = dayKey(day.toISOString());
            const outside = day.getMonth() !== at.month;
            const mine = byDay.get(key) ?? [];
            const theirs = eventsByDay.get(key) ?? [];

            return (
              <div
                key={key}
                className={[
                  'flex min-h-0 flex-col overflow-hidden bg-paper',
                  outside ? 'opacity-45' : '',
                ].join(' ')}
              >
                <div className="flex shrink-0 items-baseline justify-between px-1.5 pt-1">
                  <span
                    className={[
                      'text-[11px] tabular-nums',
                      key === todayKey
                        ? 'rounded-sm bg-selected px-1 font-semibold text-paper'
                        : 'text-grey-500',
                    ].join(' ')}
                  >
                    {day.getDate()}
                  </span>
                  {mine.length > 2 ? (
                    <span className="text-[10px] tabular-nums text-grey-400">
                      {mine.length}
                    </span>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
                  {/*
                    What was happening first, then what arrived. An appointment
                    is context for the pile of receipts under it, so it reads
                    better above them than mixed in among them — and it is
                    marked as *not yours* by the rule of the ledger: no link,
                    because the app does not own it and cannot open it.
                  */}
                  {theirs.map((event) => (
                    <p
                      key={event.id}
                      title={`${event.title}${event.calendarName ? ` · ${event.calendarName}` : ''}`}
                      className="truncate rounded-sm px-1 py-px text-[10px] text-waiting"
                    >
                      {event.allDay ? '' : `${clock.format(new Date(event.start))} `}
                      {event.title}
                    </p>
                  ))}

                  {mine.map((entry) => (
                    <Link
                      key={entry.id}
                      href={entry.href}
                      title={entry.title}
                      className="block truncate rounded-sm px-1 py-px text-[11px] text-grey-800 hover:bg-grey-150"
                    >
                      {entry.emoji ? `${entry.emoji} ` : ''}
                      {entry.title}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </FullScreen>
  );
}
