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

  /*
   * The project is fetched *with* everything hanging off it, not before it.
   * Each of these is its own HTTP round trip on the Neon driver, so gating them
   * on the existence check made the pane wait twice for what it could wait for
   * once. Against an id that isn't there the four extra queries return nothing
   * and are thrown away by `notFound` a line later, which costs less than the
   * extra trip did on every project that does exist.
   */
  const [project, projectActions, horizons, files, docs, documentOptions] =
    await Promise.all([
      getProject(id),
      getProjectActions(id),
      getAreasAndGoals(),
      attachmentsFor('project', id),
      documentsFor('project', id),
      getLinkableDocuments('project', id, ''),
    ]);

  if (!project) notFound();

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
