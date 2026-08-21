import { notFound } from 'next/navigation';
import { attachmentsFor, documentsFor } from '@/lib/file-lists';
import { DetailPane } from '@/components/panes';
import { ProjectActionsSection } from '@/components/project-actions-section';
import { ProjectDetail } from '@/components/project-detail';
import { ProjectListPane } from '@/components/project-list-pane';
import {
  getAreasAndGoals,
  getLinkableDocuments,
  getProject,
  getProjectActions,
} from '@/lib/queries';

export default async function ProjectPage(props: PageProps<'/projects/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const filter = typeof searchParams.filter === 'string' ? searchParams.filter : null;

  const project = await getProject(id);
  if (!project) notFound();

  const [projectActions, horizons, files, docs, documentOptions] = await Promise.all([
    getProjectActions(id),
    getAreasAndGoals(),
    attachmentsFor('project', id),
    documentsFor('project', id),
    getLinkableDocuments('project', id, ''),
  ]);
  const stalled =
    project.status === 'active' && !projectActions.some((a) => a.status === 'next');

  return (
    <>
      <ProjectListPane selectedId={id} filter={filter} />

      <DetailPane>
        {/* key: even across a route param, React reconciles the same component
            in the same position and keeps its state — so /projects/a →
            /projects/b would hold a's title in the field. */}
        <ProjectDetail
          key={project.id}
          project={project}
          attachments={files.rows}
          fileOrder={files.order}
          documents={docs.rows}
          docOrder={docs.order}
          documentOptions={documentOptions}
          stalled={stalled}
          horizons={horizons}
        />
        <ProjectActionsSection projectId={id} actions={projectActions} />
      </DetailPane>
    </>
  );
}
