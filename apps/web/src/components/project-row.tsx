'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { moveActionToProject } from '@/lib/actions';
import { isStalled, type ProjectRow as Row } from '@/lib/queries.shared';
import { DRAG_ACTION, DragGrip, dragPayload, hasDragType } from './sortable';

/**
 * A project row. Doubles as a drop target: dragging an action onto it files
 * the action under that project.
 */
export function ProjectRow({
  project,
  href,
  selected,
  isDragging = false,
  acceptsActions = true,
}: {
  project: Row;
  href: string;
  selected: boolean;
  isDragging?: boolean;
  acceptsActions?: boolean;
}) {
  const [over, setOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const stalled = isStalled(project);

  return (
    <div
      onDragOver={(e) => {
        if (!acceptsActions || !hasDragType(e, DRAG_ACTION)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!acceptsActions || !hasDragType(e, DRAG_ACTION)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const actionId = dragPayload(e, DRAG_ACTION);
        if (!actionId) return;
        startTransition(async () => {
          await moveActionToProject(actionId, project.id);
        });
      }}
      className={[
        'border-b border-grey-150',
        over ? 'bg-selected-bg ring-1 ring-inset ring-selected' : '',
        isDragging || pending ? 'opacity-40' : '',
      ].join(' ')}
    >
      <div
        className={[
          'group flex items-start gap-2 px-4 py-2.5',
          selected && !over ? 'bg-selected-bg' : '',
          !selected && !over ? 'hover:bg-grey-100' : '',
        ].join(' ')}
      >
        <DragGrip />

        <Link href={href} draggable={false} className="min-w-0 flex-1">
          <span
            className={[
              'block truncate text-[13px]',
              selected ? 'font-medium text-grey-900' : 'text-grey-800',
            ].join(' ')}
          >
            {project.title}
          </span>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            {project.areaName ? (
              <span className="text-grey-500">{project.areaName}</span>
            ) : null}

            {stalled ? (
              <span className="rounded-sm bg-stale-bg px-1.5 py-px font-medium text-stale">
                no next action
              </span>
            ) : project.nextActionCount > 0 ? (
              <span className="text-grey-500">{project.nextActionCount} next</span>
            ) : null}

            {project.waitingCount > 0 ? (
              <span className="rounded-sm bg-waiting-bg px-1.5 py-px text-waiting">
                {project.waitingCount} waiting
              </span>
            ) : null}

            {project.status === 'standby' && project.standbyReason ? (
              <span className="truncate text-grey-500">
                until: {project.standbyReason}
              </span>
            ) : null}
          </div>
        </Link>
      </div>
    </div>
  );
}
