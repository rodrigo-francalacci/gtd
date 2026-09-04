import Link from 'next/link';
import { EmptyList, ListPane } from '@/components/panes';
import { EmojifyButton } from '@/components/emojify-button';
import { QuickAddProject } from '@/components/quick-add';
import { SortableProjectList } from '@/components/sortable-project-list';
import { PROJECT_COLUMNS } from '@/lib/columns';
import { getProjects, isStalled } from '@/lib/queries';
import { getPreferences, paneWidth } from '@/lib/view-mode';
import { densityKeys, getView } from '@/lib/view-prefs';

/**
 * The middle pane for the Projects section. Rendered by both `/projects` and
 * `/projects/[id]` — a layout can't do this because layouts don't receive
 * `searchParams`, and the stalled filter lives there.
 */
export async function ProjectListPane({
  selectedId,
  filter,
}: {
  selectedId: string | null;
  filter: string | null;
}) {
  const viewKey = densityKeys.path('/projects');
  const [all, prefs, view] = await Promise.all([
    getProjects(),
    getPreferences(),
    getView(viewKey),
  ]);
  const viewMode = view.density ?? prefs.viewMode;
  const stalledOnly = filter === 'stalled';
  const rows = stalledOnly ? all.filter(isStalled) : all;

  return (
    <ListPane
      title={stalledOnly ? 'Stalled projects' : 'Projects'}
      viewMode={viewMode}
      viewKey={viewKey}
      paneWidth={paneWidth(prefs)}
      columns={PROJECT_COLUMNS}
        /* The ids are the rows on screen — what you asked to mark is what
           you were looking at, filters and all. */
      actions={
        <EmojifyButton
          target="projects"
          ids={rows.map((p) => p.id)}
          marked={rows.filter((p) => p.emoji).length}
        />
      }
      subtitle={
        stalledOnly ? (
          <Link href="/projects" className="underline underline-offset-2">
            Show all projects
          </Link>
        ) : (
          `${all.filter((p) => p.status === 'active').length} active · drag across a heading to restage`
        )
      }
    >
      {!stalledOnly ? <QuickAddProject /> : null}

      {rows.length === 0 ? (
        <EmptyList
          message={
            stalledOnly
              ? 'No stalled projects — every active project has a next action.'
              : 'No projects yet. Add one above.'
          }
        />
      ) : (
        <SortableProjectList
          projects={rows.map((p) => ({
            ...p,
            href: `/projects/${p.id}${stalledOnly ? '?filter=stalled' : ''}`,
            // Double-click opens the project to work on; the filter rides
            // along so closing it puts you back in the view you were in.
            focusHref: `/projects/${p.id}?${stalledOnly ? 'filter=stalled&' : ''}focus=1`,
          }))}
          selectedId={selectedId}
          mode={viewMode}
        />
      )}
    </ListPane>
  );
}
