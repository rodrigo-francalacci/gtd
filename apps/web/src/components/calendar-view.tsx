'use client';

import { useEffect, useState } from 'react';
import type { CalendarEvent } from '@/lib/google/calendar';
import { groupByDay, upcomingDayLabel } from '@/lib/days';
import type { ViewMode } from '@/lib/pane';
import { DayHeading } from './day-heading';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from './panes';
import { IconConnections, IconPlace, IconWaiting } from './icons';

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
  events: CalendarEvent[];
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
export function CalendarView({
  paneWidth,
  viewMode,
}: {
  paneWidth: number;
  viewMode: ViewMode;
}) {
  const [state, setState] = useState<Payload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(0);

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
  const days = groupByDay(events, toDate, false, upcomingDayLabel);

  const selected = events.find((e) => e.id === selectedId) ?? events[0] ?? null;

  return (
    <>
      <ListPane
        title="Calendar"
        viewMode={viewMode}
        paneWidth={paneWidth}
        showToggle={false}
        actions={
          state?.connected ? (
            <button
              type="button"
              onClick={() => setRefreshedAt(Date.now())}
              className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
            >
              Refresh
            </button>
          ) : null
        }
        subtitle={
          state === null
            ? 'Reading your calendar…'
            : !state.connected
              ? 'Not connected'
              : events.length === 0
                ? 'Nothing booked'
                : `${events.length} coming up · read-only`
        }
      >
        {state === null ? (
          <p className="px-4 py-6 text-[13px] text-grey-400">Reading your calendar…</p>
        ) : !state.connected ? (
          <Connect reconnect={state.reconnect} message={failed} />
        ) : events.length === 0 ? (
          <EmptyList message="Nothing in the next couple of months." />
        ) : (
          days.map((day) => (
            <section key={day.key}>
              <DayHeading label={day.label} />
              {day.items.map((event) => (
                <Row
                  key={`${event.calendarId}:${event.id}`}
                  event={event}
                  selected={event.id === selected?.id}
                  onSelect={() => setSelectedId(event.id)}
                />
              ))}
            </section>
          ))
        )}
      </ListPane>

      {selected ? (
        <DetailPane>
          <Detail event={selected} />
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
}: {
  event: CalendarEvent;
  selected: boolean;
  onSelect: () => void;
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

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={[
            'truncate text-[13px]',
            selected ? 'font-medium text-grey-900' : 'text-grey-800',
          ].join(' ')}
        >
          {event.title}
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
