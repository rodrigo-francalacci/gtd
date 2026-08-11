'use client';

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react';

/**
 * Custom drag MIME types. The payload itself is only readable on `drop`, but
 * `dataTransfer.types` IS readable during `dragover` — so a distinct type per
 * kind of thing is what lets a drop target decide whether to light up before
 * the user releases.
 */
export const DRAG_ACTION = 'application/x-gtd-action';
export const DRAG_PROJECT = 'application/x-gtd-project';

export function dragPayload(e: React.DragEvent, type: string): string | null {
  const raw = e.dataTransfer.getData(type);
  return raw === '' ? null : raw;
}

export function hasDragType(e: React.DragEvent, type: string): boolean {
  return Array.from(e.dataTransfer.types).includes(type);
}

type Identified = { id: string };

/**
 * A vertical list whose rows can be dragged to reorder.
 *
 * Reordering reports the two neighbours the row landed between rather than a
 * new index, so the server can position it correctly even when the list on
 * screen is a filtered subset of what's in the database.
 */
export function SortableList<T extends Identified>({
  items,
  mimeType,
  onReorder,
  renderItem,
  emptyState,
}: {
  items: T[];
  mimeType: string;
  onReorder: (id: string, prevId: string | null, nextId: string | null) => Promise<void>;
  renderItem: (item: T, isDragging: boolean) => ReactNode;
  emptyState?: ReactNode;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  /**
   * The optimistic override holds an *id order only* — never copies of the
   * rows. Row content (project, counts, waiting state) always comes from the
   * latest server props, so a drop that changes another row's data still
   * re-renders it. Caching whole objects here would freeze those fields until
   * the set of ids happened to change.
   */
  const [optimisticIds, setOptimisticIds] = useState<string[] | null>(null);

  const signature = items.map((i) => i.id).join(',');

  // Once the server comes back agreeing with us, drop the override.
  useEffect(() => {
    if (optimisticIds && optimisticIds.join(',') === signature) {
      setOptimisticIds(null);
    }
  }, [signature, optimisticIds]);

  const order = useMemo(() => {
    if (!optimisticIds) return items;
    const byId = new Map(items.map((i) => [i.id, i]));
    const ordered = optimisticIds
      .map((id) => byId.get(id))
      .filter((i): i is T => i !== undefined);
    const seen = new Set(optimisticIds);
    return [...ordered, ...items.filter((i) => !seen.has(i.id))];
  }, [items, optimisticIds]);

  const reset = () => {
    setDraggingId(null);
    setInsertAt(null);
  };

  /**
   * `id` and the insertion point both come from the drop event itself rather
   * than from state set during dragstart/dragover. State would work for a real
   * mouse drag — there are frames between the events — but reading the
   * authoritative values off the event makes the outcome independent of React
   * commit timing.
   */
  const handleDrop = (id: string | null, index: number) => {
    if (!id) return reset();

    const from = order.findIndex((i) => i.id === id);
    if (from === -1) return reset();

    // Dropping either side of yourself is a no-op.
    if (index === from || index === from + 1) return reset();

    const next = [...order];
    const [moved] = next.splice(from, 1);
    const target = index > from ? index - 1 : index;
    next.splice(target, 0, moved);

    setOptimisticIds(next.map((i) => i.id));
    reset();

    const prevId = next[target - 1]?.id ?? null;
    const nextId = next[target + 1]?.id ?? null;
    startTransition(async () => {
      await onReorder(id, prevId, nextId);
    });
  };

  /** Which side of a row the pointer is on: above it, or below it. */
  const insertionIndex = (e: React.DragEvent, index: number) => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientY - box.top < box.height / 2 ? index : index + 1;
  };

  if (order.length === 0 && emptyState) return <>{emptyState}</>;

  return (
    <div onDragLeave={(e) => e.currentTarget === e.target && setInsertAt(null)}>
      {order.map((item, index) => (
        <div
          key={item.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(mimeType, item.id);
            e.dataTransfer.effectAllowed = 'move';
            setDraggingId(item.id);
          }}
          onDragEnd={reset}
          onDragOver={(e) => {
            if (!hasDragType(e, mimeType)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setInsertAt(insertionIndex(e, index));
          }}
          onDrop={(e) => {
            if (!hasDragType(e, mimeType)) return;

            // An item from a different list isn't a reorder — leave the event
            // alone so a surrounding drop zone can decide what it means. This
            // is what lets a project's Active and Future buckets exchange
            // actions while each still reorders internally.
            const id = dragPayload(e, mimeType) ?? draggingId;
            if (!id || !order.some((item) => item.id === id)) return;

            e.preventDefault();
            e.stopPropagation();
            handleDrop(id, insertionIndex(e, index));
          }}
          className="relative"
        >
          {insertAt === index ? <InsertionLine /> : null}
          {renderItem(item, draggingId === item.id)}
          {insertAt === order.length && index === order.length - 1 ? (
            <InsertionLine atBottom />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function InsertionLine({ atBottom = false }: { atBottom?: boolean }) {
  return (
    <div
      aria-hidden
      className={[
        'pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-selected',
        atBottom ? 'bottom-0' : 'top-0',
      ].join(' ')}
    />
  );
}

/** The grab affordance shown on row hover. */
export function DragGrip() {
  return (
    <span
      aria-hidden
      className="mt-1 shrink-0 cursor-grab select-none text-[11px] leading-none text-grey-300 opacity-0 transition-opacity group-hover:opacity-100"
      title="Drag to reorder"
    >
      ⠿
    </span>
  );
}
