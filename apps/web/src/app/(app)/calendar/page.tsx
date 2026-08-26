import { CalendarView } from '@/components/calendar-view';
import { todayLabel } from '@/lib/days';
import { getPreferences, paneWidth } from '@/lib/view-mode';
import { densityKeys, getView } from '@/lib/view-prefs';

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
  const viewKey = densityKeys.path('/calendar');
  const [prefs, view] = await Promise.all([getPreferences(), getView(viewKey)]);

  return (
    <CalendarView
      paneWidth={paneWidth(prefs)}
      viewMode={view.density ?? prefs.viewMode}
      viewKey={viewKey}
      /* Formatted on the server, which is where every other date in the app
         is formatted — and which is also what stops the heading disagreeing
         with the day chips underneath it, or with itself across midnight. */
      today={todayLabel()}
    />
  );
}
