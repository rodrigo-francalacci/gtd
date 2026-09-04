import 'server-only';

import { getAccessToken } from '@/lib/auth/token';
import { GoogleApiError } from './client';

/**
 * Reading the calendar.
 *
 * The only part of this app that reads *from* Google rather than pushing to
 * it, and the exception is narrow enough to state: Google Calendar owns your
 * appointments outright. The app does not create, edit or delete them — the
 * detail pane ends in a link to Google Calendar, which is where changes are
 * made. Nothing here writes.
 *
 * Nothing is mirrored into Postgres either. A stored copy of a calendar is a
 * second version that can disagree with the real one, and the background
 * worker runs daily — a day-stale answer to "what does today look like" is
 * worse than no answer. So this is read-through, fetched when the view is
 * opened.
 */

const CALENDAR = 'https://www.googleapis.com/calendar/v3';

/**
 * The Calendar API is switched off in the Google Cloud project.
 *
 * Its own error because it is its own situation, and an easily misread one:
 * the OAuth consent succeeds, the scope is granted, the token is valid — and
 * every call still returns 403. Nothing about the connection is wrong, so
 * reporting it as "couldn't reach Google" sends you to look at the one thing
 * that is working. Each API has to be enabled per project, exactly as Drive
 * and Gmail were.
 */
export class CalendarApiDisabled extends Error {
  constructor(readonly activationUrl: string | null) {
    super('The Google Calendar API is not enabled for this project.');
  }
}

async function call<T>(url: string): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    // A calendar read is worth waiting a moment for and never worth hanging
    // on. The view degrades to "couldn't reach Google" rather than spinning.
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = await response.text();

    // Google says which API and hands back the console page that turns it on,
    // so the message can point at the fix rather than describe the symptom.
    if (response.status === 403 && detail.includes('SERVICE_DISABLED')) {
      throw new CalendarApiDisabled(activationUrlFrom(detail));
    }

    throw new GoogleApiError(`GET ${url} failed: ${response.status} ${detail}`, response.status);
  }

  return (await response.json()) as T;
}

/** The console URL Google embeds in a SERVICE_DISABLED body, if it is there. */
function activationUrlFrom(body: string): string | null {
  const match = /"activationUrl"\s*:\s*"([^"]+)"/.exec(body);
  return match ? match[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&') : null;
}

/**
 * One entry in the calendar list — a calendar you own or subscribe to.
 *
 * `selected` is whether it is ticked in Google Calendar's own sidebar. That is
 * a decision you already made about what counts as your day, so the app
 * honours it rather than asking again: a holidays calendar you unticked in
 * Google should not reappear here.
 */
type CalendarListEntry = {
  id: string;
  summary?: string;
  primary?: boolean;
  selected?: boolean;
  backgroundColor?: string;
  accessRole?: string;
};

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  /** Timed events carry `dateTime` with an offset; all-day ones carry `date`. */
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: {
    email?: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
  }[];
  recurringEventId?: string;
};

/** What the view needs, flattened and normalised. */
export type CalendarEvent = {
  id: string;
  calendarId: string;
  calendarName: string;
  title: string;
  description: string | null;
  location: string | null;
  /**
   * ISO 8601. For a timed event this carries Google's own UTC offset and is
   * rendered in the reader's timezone; for an all-day event it is midnight
   * local to whoever is looking, which is the only reading that keeps a
   * birthday on the right day.
   */
  start: string;
  end: string | null;
  allDay: boolean;
  /** Google Calendar's own page for the event — where edits happen. */
  link: string | null;
  meetingUrl: string | null;
  organiser: string | null;
  attendees: { name: string; email: string | null; response: string | null }[];
  /** True when this is one instance of a repeating event. */
  recurring: boolean;
};

/** One calendar, as the picker needs it. */
export type CalendarSource = {
  id: string;
  name: string;
  primary: boolean;
  hidden: boolean;
};

/**
 * Every calendar, whether or not it is being shown.
 *
 * Needs `calendar.readonly`; the narrower `calendar.events.readonly` cannot
 * enumerate calendars at all and can only read whichever one you name. That
 * is the whole reason for the broader scope — not events, but knowing which
 * calendars exist. Without it a second or shared calendar would be missing
 * and nothing would be able to tell you so.
 *
 * *All* of them come back, including the hidden ones: a picker that cannot
 * list what you have turned off is a picker you cannot undo anything with.
 */
async function calendars(): Promise<CalendarListEntry[]> {
  const body = await call<{ items?: CalendarListEntry[] }>(
    `${CALENDAR}/users/me/calendarList?minAccessRole=reader&maxResults=250`,
  );

  return body.items ?? [];
}

/**
 * Which calendars to leave out.
 *
 * `hidden` null means nothing has been chosen in this app, so Google's own
 * ticked state decides — a holidays calendar you unticked over there should
 * not reappear here uninvited. The first explicit choice writes a list, and
 * from then on Google's flags are not consulted at all: two owners of one
 * decision is how a setting starts changing on its own.
 */
function hiddenIds(list: CalendarListEntry[], hidden: string[] | null): Set<string> {
  if (hidden !== null) return new Set(hidden);
  return new Set(list.filter((c) => c.selected === false).map((c) => c.id));
}

/** How far ahead to look. Past this, "upcoming" stops being a useful word. */
const DEFAULT_DAYS = 60;

/** Per calendar. A subscribed holiday calendar can be dense. */
const PER_CALENDAR = 100;

/**
 * Everything coming up, across every calendar, in time order.
 *
 * `singleEvents` is not optional. Without it a recurring event comes back as
 * the *rule* that defines it rather than the instances it produces, so a
 * weekly stand-up would appear once, dated whenever the series began, and
 * probably in the past. It is also what makes `orderBy=startTime` legal —
 * Google rejects that ordering otherwise.
 *
 * Cancelled instances are dropped. A recurring event with one meeting called
 * off still returns that date, marked cancelled, and showing it would be
 * worse than showing nothing.
 */
export async function getUpcomingEvents(
  hidden: string[] | null,
  days = DEFAULT_DAYS,
): Promise<{ calendars: CalendarSource[]; events: CalendarEvent[] }> {
  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  return readEvents({ from: now, to: until, hidden });
}

/**
 * The same read, over any window and any set of calendars.
 *
 * `getUpcomingEvents` is now one caller of this — "from now, for a fortnight,
 * everything not hidden" — and a box's month view is the other: a calendar
 * month, and only the calendars that box has chosen. Written once because the
 * hard parts are shared and none of them is about which window you asked for:
 * `singleEvents`, dropping cancelled instances, one request per calendar in
 * parallel, and a failing calendar costing you that calendar rather than the
 * view.
 *
 * `only` is the opposite question to `hidden` and both are supported because
 * both are asked. App-wide, the question is which of my calendars am I
 * ignoring; per box, it is which of them belong beside this subject — so one
 * starts from all and subtracts, the other starts from none and adds.
 */
export async function readEvents({
  from,
  to,
  hidden = null,
  only = null,
}: {
  from: Date;
  to: Date;
  hidden?: string[] | null;
  only?: string[] | null;
}): Promise<{ calendars: CalendarSource[]; events: CalendarEvent[] }> {
  const now = from;
  const until = to;

  const list = await calendars();

  /*
   * An explicit list wins outright. An empty one means *none* — which is the
   * default for a box and has to be distinguishable from "not asked", or every
   * box would open showing every calendar you own.
   */
  const skip = only
    ? new Set(list.filter((c) => !only.includes(c.id)).map((c) => c.id))
    : hiddenIds(list, hidden);

  /**
   * Every calendar is reported, only the shown ones are read.
   *
   * The picker needs the full list or it cannot offer to un-hide anything;
   * fetching events for a calendar you have turned off would be work done to
   * be thrown away, and on a dense subscribed calendar that is not free.
   */
  const sources: CalendarSource[] = list.map((c) => ({
    id: c.id,
    name: c.summary ?? c.id,
    primary: Boolean(c.primary),
    hidden: skip.has(c.id),
  }));

  const shown = list.filter((c) => !skip.has(c.id));

  /**
   * One request per calendar, in parallel, and a failing calendar is skipped
   * rather than taken as a failure of the whole view. A single subscribed
   * calendar that has gone bad should cost you that calendar, not your day.
   */
  const perCalendar = await Promise.all(
    shown.map(async (calendar) => {
      const params = new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: until.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: String(PER_CALENDAR),
      });

      try {
        const body = await call<{ items?: GoogleEvent[] }>(
          `${CALENDAR}/calendars/${encodeURIComponent(calendar.id)}/events?${params}`,
        );

        return (body.items ?? [])
          .filter((event) => event.status !== 'cancelled')
          .map((event) => normalise(event, calendar));
      } catch {
        return [];
      }
    }),
  );

  // Merged across calendars, so Google's per-calendar ordering is no longer
  // enough — the whole set has to be sorted again.
  const events = perCalendar
    .flat()
    .filter((event): event is CalendarEvent => event !== null)
    .sort((a, b) => a.start.localeCompare(b.start));

  return { calendars: sources, events };
}

function normalise(
  event: GoogleEvent,
  calendar: CalendarListEntry,
): CalendarEvent | null {
  const startsAt = event.start?.dateTime ?? event.start?.date;
  if (!startsAt) return null;

  const allDay = !event.start?.dateTime;

  return {
    id: event.id,
    calendarId: calendar.id,
    calendarName: calendar.primary
      ? (calendar.summary ?? 'Calendar')
      : (calendar.summary ?? calendar.id),
    // An event with no title is legal and not rare — a blocked-out hour,
    // usually. "Busy" is what Google itself calls one.
    title: event.summary?.trim() || 'Busy',
    description: event.description?.trim() || null,
    location: event.location?.trim() || null,
    start: startsAt,
    end: event.end?.dateTime ?? event.end?.date ?? null,
    allDay,
    link: event.htmlLink ?? null,
    meetingUrl: event.hangoutLink ?? null,
    organiser: event.organizer?.displayName ?? event.organizer?.email ?? null,
    attendees: (event.attendees ?? []).map((a) => ({
      name: a.displayName ?? a.email ?? 'Someone',
      email: a.email ?? null,
      response: a.responseStatus ?? null,
    })),
    recurring: Boolean(event.recurringEventId),
  };
}
