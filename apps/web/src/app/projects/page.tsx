import { EmptyDetail } from '@/components/panes';
import { ProjectListPane } from '@/components/project-list-pane';

export default async function ProjectsPage(props: PageProps<'/projects'>) {
  const searchParams = await props.searchParams;
  const filter = typeof searchParams.filter === 'string' ? searchParams.filter : null;

  return (
    <>
      <ProjectListPane selectedId={null} filter={filter} />
      <EmptyDetail message="Select a project" />
    </>
  );
}
