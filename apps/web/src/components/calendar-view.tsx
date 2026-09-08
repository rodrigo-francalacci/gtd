'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { setActionStatus, setHiddenCalendars } from '@/lib/actions';
import type { CalendarEvent, CalendarSource } from '@/lib/google/calendar';
import { groupByDay, upcomingDayLabel } from '@/lib/days';
import type { ViewMode } from '@/lib/pane';
import type { ScheduledAction } from '@/lib/queries.shared';
import { RowEmoji } from './row-emoji';
import { DayHeading } from './day-heading';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from './panes';
import { IconCalendar, IconConnections, IconPlace, IconWaiting } from './icons';

/**
 * `start.date` is a calendar day with no time — an all-day event — and it must
 * be read as midnight *here*.
 *
 * `new Date('2026-08-22')` is parsed as UTC midnight by specification, which
 * west of Greenwich is the evening of the 21st: a birthday would sit under the
 * wrong heading, and only for people in negative offsets, which is exactly the
 * sort of bug that survives testing. Appending a time forces local parsing.
 * The same trap the date-range slider hit counting epoch days.
 */
function toDate(event: CalendarEvent): Date {
  return new Date(event.allDay ? `${event.start}T00:00:00` : event.start);
}

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

const full = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * The far end of the window, named as a date.
 *
 * An empty calendar should say where it stopped looking, and "the next 90
 * days" is a span rather than a place — "3 December" is the thing you can
 * check an event against. Computed in the browser, which is safe here for the
 * reason nothing else in this view is: the whole pane is client-rendered
 * against a fetch, so there is no server rendering for it to disagree with.
 */
function horizon(days = 90): string {
  const end = new Date();
  end.setDate(end.getDate() + days);
  return end.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "14:00 – 15:30", or "All day". */
function when(event: CalendarEvent): string {
  if (event.allDay) return 'All day';

  const start = clock.format(new Date(event.start));
  if (!event.end) return start;

  return `${start} – ${clock.format(new Date(event.end))}`;
}

type Payload = {
  connected: boolean;
  reconnect?: boolean;
  error?: string;
  /** Set when the Calendar API is switched off for the Cloud project. */
  enableUrl?: string | null;
  /** Every calendar, including the hidden ones — the picker needs them all. */
  calendars: CalendarSource[];
  events: CalendarEvent[];
  /**
   * How far ahead the read went, in days, straight from the server.
   *
   * The list is a window and an empty one is ambiguous — "nothing booked" and
   * "nothing booked *in the next three months*" are different statements, and
   * only the second one is true. Sent rather than restated here, because two
   * definitions of the window is how the pane comes to disagree with the read.
   */
  days?: number;
};

/**
 * What is coming up, grouped by day, today first.
 *
 * Read-only, deliberately. Google Calendar owns appointments outright and is
 * where they are made and changed; this is a window onto them, so that the
 * question the rest of the app keeps asking — what can I do now — can be
 * answered against a real day rather than an imagined one. Every event ends in
 * a link to Google, which is the only place that edits anything.
 *
 * Fetched here rather than server-rendered, because the standing rule is that
 * a request must not wait on Google. The panes appear immediately and fill in;
 * a slow or unreachable Google costs a list that is still loading, never a
 * page that will not open.
 */
/**
 * One line on the timeline, from either side.
 *
 * Google's appointments and your own booked steps are the same kind of claim
 * on the same afternoon, and reading them in two lists means doing the merge
 * in your head — which is the whole reason to draw them together. Nothing is
 * written to Google to achieve it: the two are simply shown in one column and
 * neither knows about the other.
 */
type Entry =
  | { key: string; at: Date; kind: 'event'; event: CalendarEvent }
  | { key: string; at: Date; kind: 'action'; action: ScheduledAction };

export function CalendarView({
  paneWidth,
  viewMode,
  viewKey,
  today,
  scheduled,
  actionPane,
}: {
  paneWidth: number;
  viewMode: ViewMode;
  /** Which list this is, so its density is remembered per list. */
  viewKey?: string;
  /**
   * Today, already written out.
   *
   * Passed in rather than computed here for two reasons that point the
   * same way: `new Date()` in a render is impure, and a client formatting
   * it would use the browser’s timezone while every day chip below uses
   * the server’s.
   */
  today: string;
  /**
   * Your own commitments, rendered by the server.
   *
   * They come as a prop rather than through the fetch because they are ours: a
   * database read, on the page's own critical path, with nothing to wait for.
   * That gives the view a useful property — the timeline is drawn with your
   * steps on it before Google has answered, and stays useful if Google never
   * does.
   */
  scheduled: ScheduledAction[];
  /**
   * The chosen step's real detail pane, rendered by the server.
   *
   * Clicking a step on the timeline used to give a summary with its notes, its
   * files and its contexts a page away — which is precisely the friction the
   * calendar exists to remove: you look at the day, you see the thing, you
   * want the quote attached to it. This is the same pane the Now list shows,
   * so opening a file from here fills the preview column exactly as it does
   * everywhere else, because that column belongs to the shell.
   *
   * Handed down as a node rather than built here, because it is server data
   * and this view has to be a client component — its other half is fetched in
   * the browser. Null whenever the chosen row is Google's, or nothing is
   * chosen at all.
   */
  actionPane: ReactNode;
}) {
  const [state, setState] = useState<Payload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(0);

  /**
   * The chosen event lives in the URL after all.
   *
   * It was local state, on the reasoning that the server renders none of this
   * and the ids are Google's, so a URL carrying one would point at nothing
   * until the fetch finished. That reasoning still holds and stopped being
   * the whole story: one pane at a time, the shell reads the URL to know
   * whether a row has been chosen, and a selection it cannot see is a detail
   * pane that never comes to you. Being invisible to the shell is a worse
   * failure than being briefly unresolvable.
   */
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get('event');

  const choose = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('event', id);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  useEffect(() => {
    let live = true;

    void (async () => {
      setFailed(null);
      try {
        const response = await fetch('/api/calendar');
        const body = (await response.json()) as Payload;
        if (!live) return;

        setState(body);
        if (body.error) setFailed(body.error);
      } catch {
        if (live) setFailed('Could not reach the app.');
      }
    })();

    return () => {
      live = false;
    };
  }, [refreshedAt]);

  const events = state?.events ?? [];

  /**
   * Ascending, and only days that have something.
   *
   * The box feed reads newest-first because it is a record of what has already
   * arrived; a calendar reads the other way for the same reason — the nearest
   * thing is the one you need. `groupByDay` only emits days it was given rows
   * for, so an empty Thursday simply is not there rather than appearing as a
   * heading over nothing.
   */
  /*
   * Merged into one time-ordered column before grouping.
   *
   * Sorted here rather than relying on either source: Google returns its
   * events in order and the query returns the actions in order, and two
   * ordered lists concatenated are not an ordered list. An all-day event has
   * `at` at local midnight, so it lands at the top of its day, which is where
   * it belongs.
   *
   * Keys are namespaced. Google's ids and our uuids cannot collide in
   * practice, but "cannot in practice" is how a selection ends up on the wrong
   * row once, unreproducibly.
   */
  const entries: Entry[] = [
    ...events.map(
      (event): Entry => ({ key: `event:${event.id}`, at: toDate(event), kind: 'event', event }),
    ),
    ...scheduled.map(
      (action): Entry => ({
        key: `action:${action.id}`,
        at: new Date(action.scheduledAt),
        kind: 'action',
        action,
      }),
    ),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  /*
   * One glyph anywhere in the column puts the slot on every row, Google's
   * included. A mark some rows carry and others do not is what leaves a left
   * edge ragged, and this column is read straight down.
   */
  const emojified = scheduled.some((action) => action.emoji);

  const days = groupByDay(entries, (entry) => entry.at, false, upcomingDayLabel);

  const selected = entries.find((e) => e.key === selectedId) ?? entries[0] ?? null;

  return (
    <>
      <ListPane
        title="Calendar"
        titleNote={today}
        viewMode={viewMode}
        viewKey={viewKey}
        paneWidth={paneWidth}
        showToggle={false}
        actions={
          state?.connected ? (
            <>
              {state.calendars.length > 1 ? (
                <CalendarPicker
                  calendars={state.calendars}
                  onChange={() => setRefreshedAt(Date.now())}
                />
              ) : null}
              <button
                type="button"
                onClick={() => setRefreshedAt(Date.now())}
                className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
              >
                Refresh
              </button>
            </>
          ) : null
        }
        subtitle={
          state === null
            ? 'Reading your calendar…'
            : !state.connected
              ? 'Not connected'
              : failed
                ? 'Cannot read the calendar'
                : entries.length === 0
                  ? `Nothing in the next ${state.days ?? 90} days`
                  : `${entries.length} in the next ${state.days ?? 90} days` +
                    (scheduled.length > 0 ? ` · ${scheduled.length} yours` : ' · read-only')
        }
      >
        {/*
          Your own steps are drawn even while Google is still being asked, and
          even when it cannot be reached at all — they are ours, they came with
          the page, and a broken connection to Google should cost you Google's
          half rather than your afternoon. So the loading and error states are
          shown *above* the timeline rather than instead of it, whenever there
          is anything of ours to draw.
        */}
        {state === null && entries.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-grey-400">Reading your calendar…</p>
        ) : !state?.connected && entries.length === 0 ? (
          <Connect reconnect={state?.reconnect} message={failed} />
        ) : (
          <>
            {state === null ? (
              <p className="px-4 py-2 text-[11px] text-grey-400">Reading your calendar…</p>
            ) : !state.connected ? (
              <Connect reconnect={state.reconnect} message={failed} />
            ) : failed ? (
              <Problem message={failed} enableUrl={state.enableUrl} />
            ) : null}

            {entries.length === 0 ? (
              <EmptyList message={`Nothing booked between now and ${horizon(state?.days)}.`} />
            ) : (
              days.map((day) => (
                <section key={day.key}>
                  <DayHeading label={day.label} />
                  {day.items.map((entry) =>
                    entry.kind === 'event' ? (
                      <Row
                        key={entry.key}
                        event={entry.event}
                        selected={entry.key === selected?.key}
                        onSelect={() => choose(entry.key)}
                        withCheckbox={scheduled.length > 0}
                        emojified={emojified}
                      />
                    ) : (
                      <ActionRowLine
                        key={entry.key}
                        action={entry.action}
                        selected={entry.key === selected?.key}
                        onSelect={() => choose(entry.key)}
                        emojified={emojified}
                      />
                    ),
                  )}
                </section>
              ))
            )}
          </>
        )}
      </ListPane>

      {selected ? (
        <DetailPane>
          {selected.kind === 'event' ? (
            <Detail event={selected.event} />
          ) : (
            /*
             * The server's pane, or a plain line while it is on its way.
             *
             * Choosing a row is a navigation — the key goes in the URL — so
             * the pane arrives on the next render rather than instantly. The
             * fallback is what stops that reading as an empty pane, and it
             * also covers the case where the row has been ticked off in
             * another tab and no longer exists.
             */
            (actionPane ?? (
              <p className="px-1 text-[12px] text-grey-400">Opening {selected.action.title}…</p>
            ))
          )}
        </DetailPane>
      ) : (
        <EmptyDetail
          message={state?.connected === false ? 'Calendar not connected' : 'Select an event'}
        />
      )}
    </>
  );
}

/**
 * Which calendars to show.
 *
 * Ticked means shown, which is the only way round a person reads a list of
 * calendars — but what gets *stored* is the unticked ones. That asymmetry is
 * deliberate and is what makes a calendar you add in Google next month appear
 * here without being asked for: it is not in the hidden list, so it shows.
 * Storing the ticked ones instead would leave it silently absent, which is the
 * failure this whole feature was shaped to avoid.
 *
 * A calendar deleted at Google simply stops being listed. Its id may linger in
 * the stored list, where it matches nothing and costs nothing.
 */
function CalendarPicker({
  calendars,
  onChange,
}: {
  calendars: CalendarSource[];
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = calendars.filter((c) => !c.hidden).length;

  const toggle = async (id: string) => {
    const next = calendars
      .filter((c) => (c.id === id ? !c.hidden : c.hidden))
      .map((c) => c.id);

    setSaving(true);
    try {
      await setHiddenCalendars(next);
      // Refetch rather than filter what is already here: a calendar being
      // shown again has events nobody has asked Google for yet.
      onChange();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Which calendars to show"
        aria-haspopup="menu"
        aria-expanded={open}
        className={[
          'flex items-center gap-1 rounded-sm px-1 text-[11px]',
          saving ? 'opacity-50' : '',
          open ? 'text-grey-800' : 'text-grey-500 hover:text-grey-800',
        ].join(' ')}
      >
        <IconCalendar />
        <span className="tabular-nums">
          {shown} of {calendars.length}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 max-h-80 w-64 overflow-y-auto rounded-sm border border-grey-200 bg-paper py-1 shadow-lg"
        >
          {calendars.map((calendar) => (
            <button
              key={calendar.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={!calendar.hidden}
              disabled={saving}
              onClick={() => void toggle(calendar.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-grey-700 hover:bg-grey-100 disabled:opacity-50"
            >
              <input
                type="checkbox"
                checked={!calendar.hidden}
                readOnly
                tabIndex={-1}
                className="pointer-events-none shrink-0"
              />
              <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
              {calendar.primary ? (
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
                  main
                </span>
              ) : null}
            </button>
          ))}

          <p className="border-t border-grey-200 px-3 pb-1 pt-2 text-[10px] leading-relaxed text-grey-500">
            A calendar you add in Google later will appear here on its own.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One of your own steps, on the timeline.
 *
 * Deliberately the same shape as an event's row — the same time column, the
 * same title weight — because the point of drawing them together is that they
 * are the same kind of claim on the same afternoon. What separates them is the
 * emoji and the checkbox, which is exactly right: the emoji is how you already
 * recognise that row in the Now list, and a thing you can *tick off* is not an
 * appointment.
 *
 * **The emoji travels**, which is the rule the whole column follows: a row you
 * have learned to recognise by its shape must keep that shape when it changes
 * list, or the calendar becomes a second, unfamiliar list of the same work.
 * The slot is reserved on every row once any row has one, so the titles stay
 * on one left edge.
 */
function ActionRowLine({
  action,
  selected,
  onSelect,
  emojified,
}: {
  action: ScheduledAction;
  selected: boolean;
  onSelect: () => void;
  /** Whether any row in this column has a glyph, so the slot is held on all. */
  emojified: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const at = new Date(action.scheduledAt);
  const until = action.scheduledEnd ? new Date(action.scheduledEnd) : null;

  return (
    <div
      className={[
        'flex w-full items-baseline gap-3 border-b border-grey-150 px-4 py-2',
        pending ? 'opacity-50' : '',
        selected ? 'bg-selected-bg' : 'hover:bg-grey-100',
      ].join(' ')}
    >
      <span className="w-24 shrink-0 tabular-nums text-[11px] text-grey-600">
        {clock.format(at)}
        {until ? `–${clock.format(until)}` : ''}
      </span>

      {/*
        Ticking it off from the timeline is most of why this is here: reading
        down the day and doing the things as they come is the whole activity,
        and having to leave for the Now list to mark one done breaks it.
      */}
      <button
        type="button"
        aria-label="Mark done"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await setActionStatus(action.id, 'done');
            router.refresh();
          })
        }
        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[3px] border border-grey-400 bg-paper hover:border-grey-600"
      />

      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          <RowEmoji emoji={emojified ? action.emoji : undefined} />
          <span
            className={[
              'truncate text-[13px]',
              selected ? 'font-medium text-grey-900' : 'text-grey-800',
            ].join(' ')}
          >
            {action.title}
          </span>
        </span>

        {action.projectTitle ? (
          <span className="truncate text-[11px] text-grey-500">{action.projectTitle}</span>
        ) : null}
      </button>
    </div>
  );
}

/**
 * A button, not a link.
 *
 * Every other row in this app navigates, because every other row is server
 * data addressed by a search param. These events are never rendered by the
 * server and their ids are Google's, so a URL carrying one would point at
 * nothing until the fetch finished and at nothing at all if the event moved.
 * Selection lives in the pane instead.
 */
function Row({
  event,
  selected,
  onSelect,
  withCheckbox,
  emojified,
}: {
  event: CalendarEvent;
  selected: boolean;
  onSelect: () => void;
  /**
   * Whether anything in this column has a checkbox, and so whether this row
   * has to leave room for one it will never have.
   *
   * An appointment cannot be ticked off — Google owns it and nothing here
   * writes — so the control is genuinely absent rather than disabled. But a
   * mark that only some rows carry is what makes a column of titles ragged,
   * which in a list you read down by the clock is the one thing to get right.
   * The same rule `RowEmoji` follows for its own slot.
   */
  withCheckbox: boolean;
  emojified: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'flex w-full items-baseline gap-3 border-b border-grey-150 px-4 py-2 text-left',
        selected ? 'bg-selected-bg' : 'hover:bg-grey-100',
      ].join(' ')}
    >
      {/* Fixed width so every title starts at the same place — a ragged left
          edge down a column of times is what makes a list tiring to scan. */}
      <span
        className={[
          'w-24 shrink-0 tabular-nums text-[11px]',
          event.allDay ? 'text-grey-400' : 'text-grey-600',
        ].join(' ')}
      >
        {when(event)}
      </span>

      {/* Held open, never drawn: see `withCheckbox`. */}
      {withCheckbox ? <span aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : null}

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          {emojified ? <RowEmoji emoji={null} /> : null}
          <span
            className={[
              'truncate text-[13px]',
              selected ? 'font-medium text-grey-900' : 'text-grey-800',
            ].join(' ')}
          >
            {event.title}
          </span>
        </span>

        {event.location ? (
          <span className="flex items-center gap-1 truncate text-[11px] text-grey-500">
            <IconPlace />
            <span className="truncate">{event.location}</span>
          </span>
        ) : null}
      </span>

      {event.recurring ? (
        <span className="shrink-0 text-grey-300" title="Repeats">
          <IconWaiting />
        </span>
      ) : null}
    </button>
  );
}

function Detail({ event }: { event: CalendarEvent }) {
  const date = toDate(event);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-grey-500">
          {event.calendarName}
          {event.recurring ? ' · repeats' : ''}
        </span>
        <h1 className="text-[17px] font-medium text-grey-900">{event.title}</h1>
        <p className="text-[13px] text-grey-600">
          {full.format(date)}
          <span className="text-grey-400"> · </span>
          <span className="tabular-nums">{when(event)}</span>
        </p>
      </header>

      {event.location ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-[10px] uppercase tracking-wider text-grey-500">Where</h2>
          <p className="text-[13px] text-grey-800">{event.location}</p>
        </section>
      ) : null}

      {event.meetingUrl ? (
        <a
          href={event.meetingUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-sm border border-grey-200 px-3 py-2 text-[12px] text-grey-700 hover:bg-grey-100"
        >
          <IconConnections />
          <span className="truncate">Join the meeting</span>
        </a>
      ) : null}

      {event.attendees.length > 0 ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-[10px] uppercase tracking-wider text-grey-500">
            Who
            <span className="ml-1.5 tabular-nums text-grey-400">
              {event.attendees.length}
            </span>
          </h2>
          <ul className="flex flex-col">
            {event.attendees.map((person) => (
              <li
                key={person.email ?? person.name}
                className="flex items-baseline justify-between gap-2 border-b border-grey-150 py-1 text-[12px] last:border-0"
              >
                <span className="min-w-0 truncate text-grey-800">{person.name}</span>
                {person.response && person.response !== 'needsAction' ? (
                  <span className="shrink-0 text-[11px] text-grey-500">
                    {RESPONSE[person.response] ?? person.response}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {event.description ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-[10px] uppercase tracking-wider text-grey-500">Notes</h2>
          {/* Google allows HTML here. Rendered as text rather than markup: this
              is somebody else's content arriving from an invitation, and the
              app has no business executing any of it. */}
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-grey-700">
            {event.description}
          </p>
        </section>
      ) : null}

      {event.organiser ? (
        <p className="text-[11px] text-grey-500">Organised by {event.organiser}</p>
      ) : null}

      {/* The only thing that changes an event. Everything above is a window. */}
      {event.link ? (
        <footer className="mt-2 border-t border-grey-150 pt-3">
          <a
            href={event.link}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            Open in Google Calendar ↗
          </a>
          <p className="mt-1 text-[11px] text-grey-400">
            This app only reads your calendar. Changes are made in Google.
          </p>
        </footer>
      ) : null}
    </div>
  );
}

const RESPONSE: Record<string, string> = {
  accepted: 'Yes',
  declined: 'No',
  tentative: 'Maybe',
};

/**
 * Connected, and still refused.
 *
 * Distinct from the not-connected state and must not offer to connect again:
 * the consent already succeeded, and sending you back round it would be the
 * app blaming the one part that is working. Where Google names the fix — as it
 * does for an API that is switched off — the link goes straight there.
 */
function Problem({
  message,
  enableUrl,
}: {
  message: string;
  enableUrl?: string | null;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-6">
      <p className="text-[13px] leading-relaxed text-stale">{message}</p>

      {enableUrl ? (
        <a
          href={enableUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block w-fit rounded-sm bg-grey-800 px-2.5 py-1 text-[12px] text-paper"
        >
          Open the Google console ↗
        </a>
      ) : null}
    </div>
  );
}

function Connect({ reconnect, message }: { reconnect?: boolean; message: string | null }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-6">
      <p className="text-[13px] leading-relaxed text-grey-600">
        {message ??
          'Connect your Google Calendar to see what is coming up beside your actions.'}
      </p>

      <a
        href="/api/auth/signin?scopes=calendar"
        className="inline-block w-fit rounded-sm bg-grey-800 px-2.5 py-1 text-[12px] text-paper"
      >
        {reconnect ? 'Reconnect Google' : 'Connect Calendar'}
      </a>

      <p className="max-w-prose text-[11px] leading-relaxed text-grey-500">
        Read-only. The app can list your calendars and read what is on them; it
        cannot create, change or delete anything, and it never writes to your
        calendar. It is asked for separately from Drive and Gmail, so the rest
        of the app works whether or not you grant it.
      </p>
    </div>
  );
}
