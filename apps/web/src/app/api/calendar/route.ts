import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/session';
import { hasCalendarScope } from '@/lib/auth/google';
import { GoogleAuthError, getGrant } from '@/lib/auth/token';
import { CalendarApiDisabled, getUpcomingEvents } from '@/lib/google/calendar';
import { getPreferences } from '@/lib/view-mode';

export const dynamic = 'force-dynamic';
/** Several Google round trips — one per calendar — though all in parallel. */
export const maxDuration = 30;

/**
 * What is coming up, read fresh from Google.
 *
 * A route rather than a server-rendered page, and that is the point: the
 * standing rule is that a request must not wait on Google, so the calendar
 * view renders immediately and asks for this afterwards. A slow or unreachable
 * Google costs you a list that is still loading, never a page that will not
 * open.
 *
 * Nothing is cached and nothing is stored. The whole value of this view is
 * that it agrees with Google Calendar right now.
 */
export async function GET() {
  const unauthorised = await apiSession();
  if (unauthorised) return unauthorised;

  /**
   * The calendar is optional, and not having granted it is an ordinary state
   * rather than an error — most of the app works without it. Saying so
   * distinctly is what lets the view offer to connect instead of reporting a
   * failure it cannot explain.
   */
  const grant = await getGrant();
  if (!hasCalendarScope(grant?.scope)) {
    return NextResponse.json({ connected: false, calendars: [], events: [] });
  }

  try {
    const { hiddenCalendars } = await getPreferences();
    const { calendars, events } = await getUpcomingEvents(hiddenCalendars);
    return NextResponse.json({ connected: true, calendars, events });
  } catch (error) {
    // A withdrawn grant is not a broken calendar, and must not be reported as
    // one — the same distinction the file proxy had to learn.
    if (error instanceof GoogleAuthError) {
      return NextResponse.json(
        {
          connected: false,
          reconnect: true,
          error: 'Google has disconnected. Reconnect it on the Google page.',
          calendars: [],
          events: [],
        },
        { status: 401 },
      );
    }

    /**
     * Granted, valid, and still refused — because the API itself is switched
     * off for the Cloud project. Worth its own message: everything about the
     * connection is fine, so anything vaguer sends you to check the one part
     * that is working.
     */
    if (error instanceof CalendarApiDisabled) {
      return NextResponse.json(
        {
          connected: true,
          enableUrl: error.activationUrl,
          error:
            'The Google Calendar API is switched off for this project. Enable ' +
            'it in the Google Cloud console — the same step Drive and Gmail ' +
            'needed — then refresh.',
          calendars: [],
          events: [],
        },
        { status: 503 },
      );
    }

    console.error('calendar read failed', error);
    return NextResponse.json(
      {
        connected: true,
        error: 'Could not reach Google Calendar.',
        calendars: [],
        events: [],
      },
      { status: 502 },
    );
  }
}
