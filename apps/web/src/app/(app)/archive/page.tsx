import { ActionDetail } from '@/components/action-detail';
import { ArchiveListPane } from '@/components/archive-list-pane';
import { DetailPane, EmptyDetail } from '@/components/panes';
import { ProjectActionsSection } from '@/components/project-actions-section';
import { ProjectDetail } from '@/components/project-detail';
import { attachmentsFor, documentsFor } from '@/lib/file-lists';
import {
  getAreasAndGoals,
  getAction,
  getArchivedActions,
  getContextsByDimension,
  getArchivedProjects,
  getLinkableDocuments,
  getProject,
  getProjectActions,
  getProjectOptions,
} from '@/lib/queries';
import { search } from '@/lib/search';
import { getPreferences, paneWidth } from '@/lib/view-mode';
import { densityKeys, getView } from '@/lib/view-prefs';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * A finished project is worth keeping for what it recorded — the notes, and
 * what was actually done. So the archive reuses the full project detail rather
 * than showing a stripped-down summary.
 */
export default async function ArchivePage(props: PageProps<'/archive'>) {
  const searchParams = await props.searchParams;
  const selectedId =
    typeof searchParams.project === 'string' ? searchParams.project : null;
  /*
   * An archived action opens in the third pane exactly as a live one does.
   *
   * A list of finished work you cannot open is a receipt, not a record — and
   * the record is the whole reason this is kept: the notes explaining what was
   * actually done, and the files that were on it. The same `ActionDetail` the
   * Now pane uses, because it is the same row.
   */
  const selectedActionId =
    typeof searchParams.action === 'string' ? searchParams.action : null;
  const showDropped = searchParams.dropped === '1';
  const view = searchParams.view === 'actions' ? 'actions' : 'projects';
  const find = typeof searchParams.find === 'string' ? searchParams.find.trim() : '';


  const viewKey = densityKeys.path('/archive');
  const [
    archived,
    archivedActions,
    hits,
    selected,
    selectedAction,
    prefs,
    stored,
  ] = await Promise.all([
    getArchivedProjects(),
    getArchivedActions(),
    // Archive-only, so searching here cannot hand back the live work you were
    // not looking at. Skipped entirely when nothing has been searched for.
    find ? search(find, 60, 'archive') : Promise.resolve([]),
    selectedId ? getProject(selectedId) : Promise.resolve(null),
    selectedActionId ? getAction(selectedActionId) : Promise.resolve(null),
    getPreferences(),
    getView(viewKey),
  ]);

  const viewMode = stored.density ?? prefs.viewMode;

  const [selectedActions, horizons] = selected
    ? await Promise.all([getProjectActions(selected.id), getAreasAndGoals()])
    : [[], { areas: [], goals: [] }];

  // Read once, above the JSX. Each of these is a query plus a
  // preference lookup, and calling them inline would run both twice —
  // once for the rows and again for the order they are in.
  const files = selected ? await attachmentsFor('project', selected.id) : null;
  const docs = selected ? await documentsFor('project', selected.id) : null;

  // The same three reads the Now pane makes, and only when there is an action
  // in the third pane to make them for.
  const [actionFiles, actionDocs, contextGroups, projectOptions] = selectedAction
    ? await Promise.all([
        attachmentsFor('action', selectedAction.id),
        documentsFor('action', selectedAction.id),
        getContextsByDimension(),
        getProjectOptions(),
      ])
    : [null, null, null, null];

  return (
    <>
      <ArchiveListPane
        projects={archived}
        actions={archivedActions}
        hits={hits}
        view={view}
        find={find}
        selectedId={selectedId}
        selectedActionId={selectedActionId}
        showDropped={showDropped}
        viewMode={viewMode}
        viewKey={viewKey}
        paneWidth={paneWidth(prefs)}
      />

      {selectedAction ? (
        <DetailPane>
          <p className="mb-3 text-[11px] uppercase tracking-wider text-grey-400">
            Done
            {selectedAction.completedAt
              ? ` · ${dateFormat.format(selectedAction.completedAt)}`
              : ''}
          </p>

          {/* Fully editable, like an archived project: the notes are where you
              write down what you learned, and that is often afterwards. */}
          {/* key: `useState(action.title)` only runs on mount. */}
          <ActionDetail
            key={selectedAction.id}
            action={selectedAction}
            attachments={actionFiles!.rows}
            fileOrder={actionFiles!.order}
            documents={actionDocs!.rows}
            docOrder={actionDocs!.order}
            documentOptions={await getLinkableDocuments('action', selectedAction.id, '')}
            contextGroups={contextGroups!}
            parties={contextGroups!.person.map((party) => party.name)}
            projects={projectOptions!}
          />
        </DetailPane>
      ) : selected ? (
        <DetailPane>
          <p className="mb-3 text-[11px] uppercase tracking-wider text-grey-400">
            {selected.status === 'dropped' ? 'Dropped' : 'Completed'}
            {selected.completedAt ? ` · ${dateFormat.format(selected.completedAt)}` : ''}
          </p>

          {/* Same editable detail as a live project: reopening it is just a
              status change, and notes stay editable so you can add what you
              learned after the fact. */}
          {/* key: `useState(project.title)` only runs on mount. */}
          <ProjectDetail
            key={selected.id}
            project={selected}
            attachments={files!.rows}
            fileOrder={files!.order}
            documents={docs!.rows}
            docOrder={docs!.order}
            documentOptions={await getLinkableDocuments('project', selected.id, '')}
            stalled={false}
            horizons={horizons}
          />
          <ProjectActionsSection
            projectId={selected.id}
            actions={selectedActions}
            archived
          />
        </DetailPane>
      ) : (
        <EmptyDetail
          message={
            view === 'actions' ? 'Select a finished action' : 'Select a finished project'
          }
        />
      )}
    </>
  );
}
