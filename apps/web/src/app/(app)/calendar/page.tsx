import { ActionDetail } from '@/components/action-detail';
import { CalendarView } from '@/components/calendar-view';
import { attachmentsFor, documentsFor } from '@/lib/file-lists';
import {
  getAction,
  getActionQueue,
  getBlockerOptions,
  getContextsByDimension,
  getLinkableDocuments,
  getProjectOptions,
  getScheduledActions,
} from '@/lib/queries';
import { UPCOMING_DAYS } from '@/lib/google/calendar';
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
export default async function CalendarPage(props: PageProps<'/calendar'>) {
  const searchParams = await props.searchParams;

  /*
   * Which row is chosen, and whether it is one of ours.
   *
   * The keys in that param are namespaced — `event:<google id>` or
   * `action:<uuid>` — so this is the whole of telling them apart. An event's
   * detail is rendered by the client from the fetch, because Google's ids mean
   * nothing to the server; one of ours is a row we own, and it gets the pane
   * it gets everywhere else.
   */
  const chosen = typeof searchParams.event === 'string' ? searchParams.event : null;
  const actionId =
    chosen?.startsWith('action:') && UUID.test(chosen.slice(7)) ? chosen.slice(7) : null;

  const viewKey = densityKeys.path('/calendar');
  const [prefs, view, scheduled] = await Promise.all([
    getPreferences(),
    getView(viewKey),
    /*
     * Ours, so the server renders them.
     *
     * The Google half cannot be — a request must not wait on Google — but this
     * is a database read on the page's own path, and rendering it here is what
     * gives the view its best property: your own afternoon is drawn before
     * Google has been asked anything, and stays drawn if Google never answers.
     *
     * The same window as the events, from one definition, so the two halves of
     * the timeline stop at the same place.
     */
    getScheduledActions(UPCOMING_DAYS),
  ]);

  /*
   * The real pane, rendered here and handed down.
   *
   * Clicking a step on the timeline and getting a summary — with its notes,
   * its files and its contexts a page away — is exactly the friction the
   * calendar was meant to remove: you look at the day, you see the thing, you
   * want to open the quote attached to it. So this is the same `ActionDetail`
   * the Now list uses, with the same data, which also means the preview pane
   * behaves the way it does everywhere else, because it is the shell's and not
   * this page's.
   *
   * A Server Component can hand a rendered node to a Client Component, which
   * is what lets the calendar stay a client view — it has to be, since its
   * other half is fetched in the browser — while the pane beside it is server
   * data. It cannot hand it a *function*, which is why the addresses below are
   * strings.
   *
   * Everything is fetched only when something of ours is chosen: on a calendar
   * showing nothing but appointments this is six queries that never run.
   */
  const action = actionId ? await getAction(actionId) : null;

  const pane = action ? await actionPane(action) : null;

  return (
    <CalendarView
      actionPane={pane}
      paneWidth={paneWidth(prefs)}
      viewMode={view.density ?? prefs.viewMode}
      viewKey={viewKey}
      scheduled={scheduled}
      /* Formatted on the server, which is where every other date in the app
         is formatted — and which is also what stops the heading disagreeing
         with the day chips underneath it, or with itself across midnight. */
      today={todayLabel()}
    />
  );
}

/** A uuid and nothing else: the param is a URL and reaches the database. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Now list's detail pane, built for a step chosen on the timeline.
 *
 * Its own function so the six reads it needs sit together rather than in the
 * middle of the page, and so they are plainly conditional: nothing here runs
 * unless one of your own rows is selected.
 */
async function actionPane(action: NonNullable<Awaited<ReturnType<typeof getAction>>>) {
  const [groups, files, docs, projects, queue, documentOptions, blockers] =
    await Promise.all([
    getContextsByDimension(),
    attachmentsFor('action', action.id),
    documentsFor('action', action.id),
    getProjectOptions(),
    getActionQueue(action.id),
    getLinkableDocuments('action', action.id, ''),
      getBlockerOptions(action.id, action.projectId),
    ]);

  return (
    <ActionDetail
      /* `useState` seeded from props only runs on mount, so without this a
         second step chosen on the timeline would open showing the first
         one's draft title. */
      key={action.id}
      action={action}
      queue={queue}
      attachments={files.rows}
      fileOrder={files.order}
      documents={docs.rows}
      docOrder={docs.order}
      documentOptions={documentOptions}
      contextGroups={groups}
      parties={groups.person.map((p) => p.name)}
      projects={projects}
      blockers={blockers}
    />
  );
}
