import { FocusView } from '@/components/focus-view';
import { NoteEditor } from '@/components/note-editor';
import { updateProjectNotes } from '@/lib/actions';
import { notFound } from 'next/navigation';
import { attachmentsFor, documentsFor } from '@/lib/file-lists';
import { DetailPane } from '@/components/panes';
import { ProjectActionsSection } from '@/components/project-actions-section';
import { ProjectDetail } from '@/components/project-detail';
import { ProjectListPane } from '@/components/project-list-pane';
import { timelinesFor } from '@/lib/actions';
import {
  getAreasAndGoals,
  getBoxes,
  getLinkableDocuments,
  getProject,
  getProjectTree,
  getProjectActions,
} from '@/lib/queries';

export default async function ProjectPage(props: PageProps<'/projects/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const filter = typeof searchParams.filter === 'string' ? searchParams.filter : null;
  const hideNotes = searchParams.focus !== undefined;

  /*
   * The project is fetched *with* everything hanging off it, not before it.
   * Each of these is its own HTTP round trip on the Neon driver, so gating them
   * on the existence check made the pane wait twice for what it could wait for
   * once. Against an id that isn't there the four extra queries return nothing
   * and are thrown away by `notFound` a line later, which costs less than the
   * extra trip did on every project that does exist.
   */
  const [project, projectActions, horizons, files, docs, documentOptions, boxes, timelines, tree] =
    await Promise.all([
      getProject(id),
      getProjectActions(id),
      getAreasAndGoals(),
      attachmentsFor('project', id),
      documentsFor('project', id),
      getLinkableDocuments('project', id, ''),
      getBoxes(),
      timelinesFor(id),
      getProjectTree(id),
    ]);

  if (!project) notFound();

  const stalled =
    project.status === 'active' && !projectActions.some((a) => a.status === 'next');

  const detail = (
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
      boxes={boxes}
      timelines={timelines}
      hideNotes={hideNotes}
      tree={
        tree
          ? {
              drive: tree.drive,
              gmail: tree.gmail,
              fetchedAt: tree.fetchedAt.toISOString(),
              error: tree.error,
            }
          : null
      }
    />
  );

  /**
   * The project, opened to work on: what you have written about it on the left,
   * its status, files, documents, timelines and folders on the right.
   *
   * The steps come with it. A project's actions are the thing you are most
   * often writing *about*, and leaving them behind in a pane you can no longer
   * see would make the note harder to write, not easier.
   */
  if (searchParams.focus !== undefined) {
    return (
      <FocusView
        title={project.title}
        subtitle={stalled ? 'Active, and stalled' : project.status}
        closeHref={`/projects/${id}${filter ? '?filter=' + filter : ''}`}
        notes={
          <NoteEditor
            key={project.id}
            surface="project"
            id={project.id}
            height={project.noteHeight ?? null}
            dense={project.noteDense ?? null}
            initialContent={project.notes}
            onSave={updateProjectNotes.bind(null, project.id)}
            placeholder="What this is for, what you decided, what is in the way…"
            fill
          />
        }
        rest={
          <>
            {detail}
            <ProjectActionsSection projectId={id} actions={projectActions} />
          </>
        }
      />
    );
  }

  return (
    <>
      <ProjectListPane selectedId={id} filter={filter} />

      <DetailPane>
        {/* key: even across a route param, React reconciles the same component
            in the same position and keeps its state — so /projects/a →
            /projects/b would hold a's title in the field. */}
        {detail}
        <ProjectActionsSection projectId={id} actions={projectActions} />
      </DetailPane>
    </>
  );
}
