'use client';

import { moveListItemBetween } from '@/lib/actions';
import { RowMenu } from './row-menu';
import { deleteListItem, updateListItemTitle } from '@/lib/actions';
import type { ViewMode } from '@/lib/pane';
import type { ListItemRow as Row } from '@/lib/queries.shared';
import { ListItemRow } from './list-item-row';
import { SortableList } from './sortable';

/** List items have their own drag type so they can't be crossed with actions. */
export const DRAG_LIST_ITEM = 'application/x-gtd-list-item';

export type ListItemWithHref = Row & { href: string };

export function SortableListItems({
  items,
  selectedId,
  isPurchases,
  mode = 'comfortable',
  emptyState,
}: {
  items: ListItemWithHref[];
  selectedId?: string | null;
  isPurchases: boolean;
  mode?: ViewMode;
  emptyState?: React.ReactNode;
}) {
  /*
   * One row with an emoji puts the slot on all of them. Decided here rather
   * than per row because a row cannot see its neighbours, and a slot that
   * appears only where there is a glyph is the ragged left edge the whole
   * arrangement exists to avoid.
   */
  const emojified = items.some((item) => item.emoji);

  return (
    <SortableList
      items={items}
      mimeType={DRAG_LIST_ITEM}
      onReorder={moveListItemBetween}
      emptyState={emptyState}
      renderItem={(item, isDragging) => (
        <RowMenu
          name={item.title}
          onRename={(next) => updateListItemTitle(item.id, next)}
          onDelete={() => deleteListItem(item.id)}
          deleteNote="Its files go to the Drive bin with it."
        >
        <ListItemRow
          emojified={emojified}
          item={item}
          href={item.href}
          selected={item.id === selectedId}
          isPurchases={isPurchases}
          isDragging={isDragging}
          mode={mode}
        />
        </RowMenu>
      )}
    />
  );
}
