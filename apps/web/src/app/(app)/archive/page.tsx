import { ArchiveListPane } from '@/components/archive-list-pane';
import { DetailPane, EmptyDetail } from '@/components/panes';
import { ProjectActionsSection } from '@/components/project-actions-section';
import { ProjectDetail } from '@/components/project-detail';
import { attachmentsFor, documentsFor } from '@/lib/file-lists';
import {
  getAreasAndGoals,
  getArchivedProjects,
  getLinkableDocuments,
  getProject,
  getProjectActions,
} from '@/lib/queries';
import { getPreferences, paneWidth } from '@/lib/view-mode';

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
  const showDropped = searchParams.dropped === '1';

  const [archived, selected, prefs] = await Promise.all([
    getArchivedProjects(),
    selectedId ? getProject(selectedId) : Promise.resolve(null),
    getPreferences(),
  ]);

  const [selectedActions, horizons] = selected
    ? await Promise.all([getProjectActions(selected.id), getAreasAndGoals()])
    : [[], { areas: [], goals: [] }];

  // Read once, above the JSX. Each of these is a query plus a
  // preference lookup, and calling them inline would run both twice —
  // once for the rows and again for the order they are in.
  const files = selected ? await attachmentsFor('project', selected.id) : null;
  const docs = selected ? await documentsFor('project', selected.id) : null;

  return (
    <>
      <ArchiveListPane
        projects={archived}
        selectedId={selectedId}
        showDropped={showDropped}
        viewMode={prefs.viewMode}
        paneWidth={paneWidth(prefs)}
      />

      {selected ? (
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
        <EmptyDetail message="Select a finished project" />
      )}
    </>
  );
}
