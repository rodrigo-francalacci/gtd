import { ArchiveListPane } from '@/components/archive-list-pane';
import { DetailPane, EmptyDetail } from '@/components/panes';
import { ProjectActionsSection } from '@/components/project-actions-section';
import { ProjectDetail } from '@/components/project-detail';
import { getArchivedProjects, getProject, getProjectActions } from '@/lib/queries';

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

  const [archived, selected] = await Promise.all([
    getArchivedProjects(),
    selectedId ? getProject(selectedId) : Promise.resolve(null),
  ]);

  const selectedActions = selected ? await getProjectActions(selected.id) : [];

  return (
    <>
      <ArchiveListPane
        projects={archived}
        selectedId={selectedId}
        showDropped={showDropped}
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
          <ProjectDetail project={selected} stalled={false} />
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
