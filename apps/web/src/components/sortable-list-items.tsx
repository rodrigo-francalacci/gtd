'use client';

import { moveListItemBetween } from '@/lib/actions';
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
  emptyState,
}: {
  items: ListItemWithHref[];
  selectedId?: string | null;
  isPurchases: boolean;
  emptyState?: React.ReactNode;
}) {
  return (
    <SortableList
      items={items}
      mimeType={DRAG_LIST_ITEM}
      onReorder={moveListItemBetween}
      emptyState={emptyState}
      renderItem={(item, isDragging) => (
        <ListItemRow
          item={item}
          href={item.href}
          selected={item.id === selectedId}
          isPurchases={isPurchases}
          isDragging={isDragging}
        />
      )}
    />
  );
}
