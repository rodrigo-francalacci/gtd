'use client';

import { moveActionBetween } from '@/lib/actions';
import { deleteAction, updateActionTitle } from '@/lib/actions';
import type { ViewMode } from '@/lib/pane';
import type { ActionRow } from '@/lib/queries.shared';
import { ActionItem } from './action-item';
import { RowMenu } from './row-menu';
import { copyIdItem } from '@/lib/copy-token';
import { DRAG_ACTION, SortableList } from './sortable';

/**
 * `href` is precomputed per row by the server rather than passed as a builder
 * function — functions can't cross the server/client boundary.
 */
/**
 * `focusHref` rides with `href` for the same reason: where a row goes when you
 * click it and where it goes when you open it are both facts the page knows and
 * the list does not. Optional, so a list that has no focus view simply does not
 * offer the gesture.
 */
export type ActionListItem = ActionRow & { href: string; focusHref?: string };

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
  sortable = true,
}: {
  actions: ActionListItem[];
  selectedId?: string | null;
  showProject?: boolean;
  mode?: ViewMode;
  variant?: 'default' | 'waiting';
  emptyState?: React.ReactNode;
  /**
   * Whether dragging inside this run reorders it.
   *
   * False where the order is a *fact* rather than a preference — the scheduled
   * block is in time order, and a drag there would look like it had done
   * nothing, because the list re-sorts itself by the clock on the next render.
   * A gesture that appears to do nothing is worse than a gesture that is not
   * offered.
   *
   * The rows are identical either way, which is the point of the flag: one row
   * renderer, so the menu, the emoji slot and the density cannot drift between
   * a list you can drag and one you cannot.
   */
  sortable?: boolean;
}) {
  /*
   * One row with an emoji is enough to put the slot on all of them. Decided
   * here rather than per row because a row cannot see its neighbours, and a
   * slot that appears only where there is a glyph is the ragged left edge the
   * whole arrangement exists to avoid.
   */
  const emojified = actions.some((action) => action.emoji);

  const row = (action: ActionListItem, isDragging: boolean) => (
        <RowMenu
          name={action.title}
          focusHref={action.focusHref}
          onRename={(next) => updateActionTitle(action.id, next)}
          onDelete={() => deleteAction(action.id)}
          /*
           * "Done and delete", not "Delete", because that is what it means for
           * an action. A task ends one of two ways: ticked, which keeps it in
           * the archive as a record, or finished with no record wanted at all.
           * This is the second. It is also the only route to it on a phone,
           * where there is no Delete key to press.
           */
          deleteLabel="Done and delete"
          deleteNote="Its files go to the Drive bin with it."
          /* So a note in a box can point at this step. The token, not the bare
             uuid: a uuid cannot say which table it names. */
          extra={[copyIdItem('action', action.id)]}
        >
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
        </RowMenu>
  );

  if (!sortable) {
    if (actions.length === 0) return <>{emptyState ?? null}</>;
    return <div>{actions.map((action) => <div key={action.id}>{row(action, false)}</div>)}</div>;
  }

  return (
    <SortableList
      items={actions}
      mimeType={DRAG_ACTION}
      onReorder={moveActionBetween}
      emptyState={emptyState}
      renderItem={row}
    />
  );
}
