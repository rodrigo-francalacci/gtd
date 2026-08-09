import { notFound } from 'next/navigation';
import { ActionItem } from '@/components/action-item';
import { DetailPane } from '@/components/panes';
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

            {openActions.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-grey-500">
                No open actions. Add the very next physical step above.
              </p>
            ) : (
              openActions.map((a) => (
                <ActionItem
                  key={a.id}
                  action={a}
                  href={`/now?action=${a.id}`}
                  selected={false}
                  showProject={false}
                />
              ))
            )}

            {doneActions.map((a) => (
              <ActionItem
                key={a.id}
                action={a}
                href={`/now?action=${a.id}`}
                selected={false}
                showProject={false}
              />
            ))}
          </div>
        </section>
      </DetailPane>
    </>
  );
}
