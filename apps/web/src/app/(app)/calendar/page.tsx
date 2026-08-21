import { CalendarView } from '@/components/calendar-view';
import { getPreferences, paneWidth } from '@/lib/view-mode';

/**
 * What is booked, today first.
 *
 * The one view in this app that reads *from* Google rather than pushing to it,
 * and the exception is narrow: Google Calendar owns appointments, so this is a
 * window onto them and nothing more. Nothing here writes, and the detail pane
 * ends in a link to Google, which is where changes are made.
 *
 * The page renders nothing of the calendar itself — the events are fetched by
 * the client component below, because a request must not wait on Google. The
 * panes are on screen before Google has been asked anything.
 */
export default async function CalendarPage() {
  const prefs = await getPreferences();

  return <CalendarView paneWidth={paneWidth(prefs)} viewMode={prefs.viewMode} />;
}
