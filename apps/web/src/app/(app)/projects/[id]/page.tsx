import { notFound } from 'next/navigation';
import { DetailPane } from '@/components/panes';
import { ProjectActionsSection } from '@/components/project-actions-section';
import { ProjectDetail } from '@/components/project-detail';
import { ProjectListPane } from '@/components/project-list-pane';
import {
  getAreasAndGoals,
  getAttachments,
  getProject,
  getProjectActions,
} from '@/lib/queries';

export default async function ProjectPage(props: PageProps<'/projects/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const filter = typeof searchParams.filter === 'string' ? searchParams.filter : null;

  const project = await getProject(id);
  if (!project) notFound();

  const [projectActions, horizons, files] = await Promise.all([
    getProjectActions(id),
    getAreasAndGoals(),
    getAttachments('project', id),
  ]);
  const stalled =
    project.status === 'active' && !projectActions.some((a) => a.status === 'next');

  return (
    <>
      <ProjectListPane selectedId={id} filter={filter} />

      <DetailPane>
        <ProjectDetail
          project={project}
          attachments={files}
          stalled={stalled}
          horizons={horizons}
        />
        <ProjectActionsSection projectId={id} actions={projectActions} />
      </DetailPane>
    </>
  );
}
