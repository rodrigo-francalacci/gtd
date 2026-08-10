import { notFound } from 'next/navigation';
import { DetailPane } from '@/components/panes';
import { SortableActionList } from '@/components/sortable-action-list';
import { ProjectDetail } from '@/components/project-detail';
import { ProjectListPane } from '@/components/project-list-pane';
import { QuickAddAction } from '@/components/quick-add';
import { getProject, getProjectActions } from '@/lib/queries';

export default async function ProjectPage(props: PageProps<'/projects/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const filter = typeof searchParams.filter === 'string' ? searchParams.filter : null;

  const project = await getProject(id);
  if (!project) notFound();

  const projectActions = await getProjectActions(id);
  const openActions = projectActions.filter((a) => a.status !== 'done');
  const doneActions = projectActions.filter((a) => a.status === 'done');
  const stalled =
    project.status === 'active' && !projectActions.some((a) => a.status === 'next');

  return (
    <>
      <ProjectListPane selectedId={id} filter={filter} />

      <DetailPane>
        <ProjectDetail project={project} stalled={stalled} />

        <section className="mt-8 border-t border-grey-150 pt-5">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
            Actions
          </h2>

          <div className="overflow-hidden rounded-sm border border-grey-200">
            <QuickAddAction projectId={id} />

            <SortableActionList
              actions={openActions.map((a) => ({
                ...a,
                href: `/now?action=${a.id}`,
              }))}
              showProject={false}
              emptyState={
                <p className="px-4 py-3 text-[12px] text-grey-500">
                  No open actions. Add the very next physical step above.
                </p>
              }
            />

            <SortableActionList
              actions={doneActions.map((a) => ({
                ...a,
                href: `/now?action=${a.id}`,
              }))}
              showProject={false}
            />
          </div>
        </section>
      </DetailPane>
    </>
  );
}
