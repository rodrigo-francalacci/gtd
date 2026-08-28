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
  /*
   * One row with an emoji is enough to put the slot on all of them. Decided
   * here rather than per row because a row cannot see its neighbours, and a
   * slot that appears only where there is a glyph is the ragged left edge the
   * whole arrangement exists to avoid.
   */
  const emojified = actions.some((action) => action.emoji);

  return (
    <SortableList
      items={actions}
      mimeType={DRAG_ACTION}
      onReorder={moveActionBetween}
      emptyState={emptyState}
      renderItem={(action, isDragging) => (
        <ActionItem
          emojified={emojified}
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
