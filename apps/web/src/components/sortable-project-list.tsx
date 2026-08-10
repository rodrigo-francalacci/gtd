'use client';

import { moveProjectBetween } from '@/lib/actions';
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
  type ProjectRow as Row,
} from '@/lib/queries.shared';
import { ProjectRow } from './project-row';
import { DRAG_PROJECT, SortableList } from './sortable';

/**
 * Projects grouped by status, each group independently drag-reorderable.
 * Reordering is scoped to a group because the groups are the visible headings —
 * dragging across a status heading would silently change a project's status,
 * which should be a deliberate act in the detail pane.
 */
export type ProjectListItem = Row & { href: string };

export function SortableProjectList({
  projects,
  selectedId,
}: {
  projects: ProjectListItem[];
  selectedId?: string | null;
}) {
  const grouped = new Map<string, ProjectListItem[]>();
  for (const p of projects) {
    grouped.set(p.status, [...(grouped.get(p.status) ?? []), p]);
  }

  return (
    <>
      {PROJECT_STATUS_ORDER.filter((status) => grouped.has(status)).map((status) => (
        <section key={status}>
          <h3 className="sticky top-0 z-20 bg-grey-100 px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
            {PROJECT_STATUS_LABELS[status]}
          </h3>
          <SortableList
            items={grouped.get(status)!}
            mimeType={DRAG_PROJECT}
            onReorder={moveProjectBetween}
            renderItem={(project, isDragging) => (
              <ProjectRow
                project={project}
                href={project.href}
                selected={project.id === selectedId}
                isDragging={isDragging}
              />
            )}
          />
        </section>
      ))}
    </>
  );
}
