import Link from 'next/link';
import { EmptyList, ListPane } from '@/components/panes';
import { QuickAddProject } from '@/components/quick-add';
import { getProjects, isStalled } from '@/lib/queries';

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
  const all = await getProjects();
  const stalledOnly = filter === 'stalled';
  const rows = stalledOnly ? all.filter(isStalled) : all;

  const grouped = new Map<string, typeof rows>();
  for (const p of rows) {
    grouped.set(p.status, [...(grouped.get(p.status) ?? []), p]);
  }

  const order = ['active', 'standby', 'someday', 'completed', 'dropped'];
  const labels: Record<string, string> = {
    active: 'Active',
    standby: 'Standby',
    someday: 'Someday',
    completed: 'Completed',
    dropped: 'Dropped',
  };

  return (
    <ListPane
      title={stalledOnly ? 'Stalled projects' : 'Projects'}
      subtitle={
        stalledOnly ? (
          <Link href="/projects" className="underline underline-offset-2">
            Show all projects
          </Link>
        ) : (
          `${all.filter((p) => p.status === 'active').length} active`
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
        order
          .filter((status) => grouped.has(status))
          .map((status) => (
            <section key={status}>
              <h3 className="sticky top-0 bg-grey-100 px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                {labels[status]}
              </h3>
              {grouped.get(status)!.map((p) => {
                const stalled = isStalled(p);
                return (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}${stalledOnly ? '?filter=stalled' : ''}`}
                    className={[
                      'block border-b border-grey-150 px-4 py-2.5',
                      p.id === selectedId ? 'bg-selected-bg' : 'hover:bg-grey-100',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'block truncate text-[13px]',
                        p.id === selectedId
                          ? 'font-medium text-grey-900'
                          : 'text-grey-800',
                      ].join(' ')}
                    >
                      {p.title}
                    </span>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                      {p.areaName ? (
                        <span className="text-grey-500">{p.areaName}</span>
                      ) : null}

                      {stalled ? (
                        <span className="rounded-sm bg-stale-bg px-1.5 py-px font-medium text-stale">
                          no next action
                        </span>
                      ) : p.nextActionCount > 0 ? (
                        <span className="text-grey-500">
                          {p.nextActionCount} next
                        </span>
                      ) : null}

                      {p.waitingCount > 0 ? (
                        <span className="rounded-sm bg-waiting-bg px-1.5 py-px text-waiting">
                          {p.waitingCount} waiting
                        </span>
                      ) : null}

                      {p.status === 'standby' && p.standbyReason ? (
                        <span className="truncate text-grey-500">
                          until: {p.standbyReason}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </section>
          ))
      )}
    </ListPane>
  );
}
