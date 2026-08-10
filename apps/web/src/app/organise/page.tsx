import { EmptyList, ListPane } from '@/components/panes';
import { SortableActionList } from '@/components/sortable-action-list';
import { SortableProjectList } from '@/components/sortable-project-list';
import { UnfileTarget } from '@/components/unfile-target';
import { ACTION_COLUMNS, PROJECT_COLUMNS } from '@/lib/columns';
import { getNowActions, getProjects, getWaitingActions } from '@/lib/queries';
import { getViewMode } from '@/lib/view-mode';

/**
 * Filing view: projects on the left, loose actions on the right, drag across
 * to assign. Both columns are lists rather than a list + detail, because the
 * job here is moving things between them, not reading one of them.
 */
export default async function OrganisePage(props: PageProps<'/organise'>) {
  const searchParams = await props.searchParams;
  const showAll = searchParams.show === 'all';

  const [projects, next, waiting, viewMode] = await Promise.all([
    getProjects(),
    getNowActions([]),
    getWaitingActions(),
    getViewMode(),
  ]);
  const compact = viewMode === 'compact';

  // Unfiled actions are the ones this view exists to clear, so they lead.
  const all = [...next, ...waiting];
  const rows = showAll ? all : all.filter((a) => a.projectId === null);
  const unfiledCount = all.filter((a) => a.projectId === null).length;

  return (
    <>
      <ListPane
        title="Projects"
        subtitle="Drop an action on a project to file it"
        columns={PROJECT_COLUMNS}
        viewMode={viewMode}
      >
        <SortableProjectList
          projects={projects.map((p) => ({ ...p, href: `/projects/${p.id}` }))}
          compact={compact}
        />
      </ListPane>

      <ListPane
        title={showAll ? 'All actions' : 'Unfiled actions'}
        width="flex-1"
        columns={ACTION_COLUMNS}
        viewMode={viewMode}
        showToggle={false}
        subtitle={
          <div className="flex items-center gap-2">
            <span>
              {unfiledCount === 0
                ? 'Everything is filed'
                : `${unfiledCount} without a project`}
            </span>
            <a
              href={showAll ? '/organise' : '/organise?show=all'}
              className="underline underline-offset-2"
            >
              {showAll ? 'Show unfiled only' : 'Show all actions'}
            </a>
          </div>
        }
      >
        <UnfileTarget />
        <SortableActionList
          actions={rows.map((a) => ({ ...a, href: `/now?action=${a.id}` }))}
          compact={compact}
          emptyState={
            <EmptyList
              message={
                showAll
                  ? 'No open actions at all.'
                  : 'Every action belongs to a project. Nothing to file.'
              }
            />
          }
        />
      </ListPane>
    </>
  );
}
