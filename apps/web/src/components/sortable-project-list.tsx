'use client';

import { useState, useTransition, type ReactNode } from 'react';
import type { ProjectStatus } from '@gtd/db';
import { moveProjectBetween, setProjectStatus } from '@/lib/actions';
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
  type ProjectRow as Row,
} from '@/lib/queries.shared';
import { ProjectRow } from './project-row';
import { DRAG_PROJECT, SortableList, dragPayload, hasDragType } from './sortable';

/**
 * Projects grouped by status. Dragging inside a group reorders it; dragging
 * across a group heading changes the project's status, which is the same
 * kanban move the Active/Future buckets make for actions.
 *
 * `SortableList` ignores drops of a project it doesn't contain, so those
 * bubble up to the surrounding group and land here.
 */
export type ProjectListItem = Row & { href: string };

/** The statuses you can drag between — the archive is reached by finishing. */
const BUCKETS: ProjectStatus[] = ['active', 'standby', 'someday'];

const HINTS: Partial<Record<ProjectStatus, string>> = {
  active: 'committed to now',
  standby: 'blocked, with a way back',
  someday: 'not now, not never',
};

export function SortableProjectList({
  projects,
  selectedId,
  compact = false,
}: {
  projects: ProjectListItem[];
  selectedId?: string | null;
  compact?: boolean;
}) {
  const [, startTransition] = useTransition();

  // Standby needs a return condition, so a drop there asks for one instead of
  // quietly parking the project with no way back.
  const [standbyFor, setStandbyFor] = useState<ProjectListItem | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const grouped = new Map<string, ProjectListItem[]>();
  for (const p of projects) {
    grouped.set(p.status, [...(grouped.get(p.status) ?? []), p]);
  }

  // Every bucket is shown even when empty — an empty group you can't see is an
  // empty group you can't drop into.
  const statuses = PROJECT_STATUS_ORDER.filter(
    (status) => BUCKETS.includes(status) || grouped.has(status),
  );

  const move = (id: string, status: ProjectStatus) => {
    const project = projects.find((p) => p.id === id);
    if (!project || project.status === status) return;

    if (status === 'standby') {
      setStandbyFor(project);
      setReason(project.standbyReason ?? '');
      setError(null);
      return;
    }

    startTransition(async () => {
      await setProjectStatus(id, status);
    });
  };

  const confirmStandby = () => {
    if (!standbyFor) return;
    if (!reason.trim()) {
      setError('What would bring this back?');
      return;
    }
    const id = standbyFor.id;
    startTransition(async () => {
      await setProjectStatus(id, 'standby', reason);
      setStandbyFor(null);
    });
  };

  return (
    <>
      {statuses.map((status) => (
        <ProjectBucket
          key={status}
          status={status}
          droppable={BUCKETS.includes(status)}
          count={grouped.get(status)?.length ?? 0}
          onDropProject={(id) => move(id, status)}
        >
          {standbyFor && status === 'standby' ? (
            <div className="border-b border-grey-200 bg-grey-50 px-4 py-2.5">
              <label className="block text-[11px] font-medium text-grey-600">
                Standby “{standbyFor.title}” — what brings it back?
              </label>
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmStandby();
                  if (e.key === 'Escape') setStandbyFor(null);
                }}
                placeholder="e.g. once the quote comes back"
                className="mt-1.5 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[12px] focus:border-grey-500 focus:outline-none"
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={confirmStandby}
                  className="rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper"
                >
                  Set standby
                </button>
                <button
                  type="button"
                  onClick={() => setStandbyFor(null)}
                  className="text-[11px] text-grey-500 underline underline-offset-2"
                >
                  Cancel
                </button>
                {error ? (
                  <span className="text-[11px] text-stale">{error}</span>
                ) : null}
              </div>
            </div>
          ) : null}

          <SortableList
            items={grouped.get(status) ?? []}
            mimeType={DRAG_PROJECT}
            onReorder={moveProjectBetween}
            emptyState={
              <p className="px-4 py-2.5 text-[12px] text-grey-400">
                Nothing here. Drag a project in.
              </p>
            }
            renderItem={(project, isDragging) => (
              <ProjectRow
                project={project}
                href={project.href}
                selected={project.id === selectedId}
                isDragging={isDragging}
                compact={compact}
              />
            )}
          />
        </ProjectBucket>
      ))}
    </>
  );
}

function ProjectBucket({
  status,
  droppable,
  count,
  onDropProject,
  children,
}: {
  status: ProjectStatus;
  droppable: boolean;
  count: number;
  onDropProject: (id: string) => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);

  return (
    <section
      onDragOver={
        droppable
          ? (e) => {
              if (!hasDragType(e, DRAG_PROJECT)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOver(true);
            }
          : undefined
      }
      onDragLeave={(e) => {
        // Only when the pointer actually leaves the group — moving between the
        // rows inside it fires dragleave too, and clearing on those would make
        // the highlight flicker all the way down the list.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOver(false);
        }
      }}
      // A reorder inside this group is handled — and stopped — by the list
      // below, so the bubble-phase handlers never see it. Capture runs first
      // and is not cancellable from below, which is what reliably clears the
      // highlight however the drag ends.
      onDropCapture={() => setOver(false)}
      onDragEndCapture={() => setOver(false)}
      onDrop={
        droppable
          ? (e) => {
              if (!hasDragType(e, DRAG_PROJECT)) return;
              e.preventDefault();
              setOver(false);

              const id = dragPayload(e, DRAG_PROJECT);
              if (id) onDropProject(id);
            }
          : undefined
      }
      className={over ? 'bg-selected-bg' : ''}
    >
      <h3 className="sticky top-0 z-20 flex items-baseline justify-between gap-2 bg-grey-100 px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
        <span>
          {PROJECT_STATUS_LABELS[status]}
          <span className="ml-1.5 tabular-nums text-grey-400">{count}</span>
        </span>
        {over ? (
          <span className="normal-case tracking-normal text-selected">
            Move here
          </span>
        ) : (
          <span className="font-normal normal-case tracking-normal text-grey-400">
            {HINTS[status] ?? ''}
          </span>
        )}
      </h3>

      {children}
    </section>
  );
}
