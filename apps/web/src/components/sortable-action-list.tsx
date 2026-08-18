'use client';

import { moveActionBetween } from '@/lib/actions';
import type { ViewMode } from '@/lib/pane';
import type { ActionRow } from '@/lib/queries.shared';
import { ActionItem } from './action-item';
import { DRAG_ACTION, SortableList } from './sortable';

/**
 * `href` is precomputed per row by the server rather than passed as a builder
 * function — functions can't cross the server/client boundary.
 */
export type ActionListItem = ActionRow & { href: string };

/**
 * The actions list, drag-reorderable. Rows also carry the action drag type, so
 * the same drag can be dropped onto a project row to file it — the drop target
 * decides what the drag means.
 */
export function SortableActionList({
  actions,
  selectedId,
  showProject = true,
  mode = 'comfortable',
  variant = 'default',
  emptyState,
}: {
  actions: ActionListItem[];
  selectedId?: string | null;
  showProject?: boolean;
  mode?: ViewMode;
  variant?: 'default' | 'waiting';
  emptyState?: React.ReactNode;
}) {
  return (
    <SortableList
      items={actions}
      mimeType={DRAG_ACTION}
      onReorder={moveActionBetween}
      emptyState={emptyState}
      renderItem={(action, isDragging) => (
        <ActionItem
          action={action}
          href={action.href}
          selected={action.id === selectedId}
          showProject={showProject}
          isDragging={isDragging}
          mode={mode}
          variant={variant}
        />
      )}
    />
  );
}
