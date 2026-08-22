'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
 * How a row's grip starts a drag on a touchscreen.
 *
 * HTML5 drag and drop does not exist on touch — no `dragstart`, no
 * `dataTransfer`, nothing — so reordering was a desktop-only operation and the
 * phone was told to sort by name or date instead. That is a different thing:
 * sorting is a view, manual order is a decision, and a list whose order you
 * chose is not one a phone should only be able to read.
 *
 * Pointer events cover both, but they are not a drop-in replacement: they
 * arrive for *every* touch, including the one that is trying to scroll the
 * list or tap a row. So the grip is the only thing that starts a drag, and it
 * carries `touch-action: none` to claim the gesture from the scroller — which
 * is also why the grip becomes visible on a coarse pointer, where there is no
 * hover to reveal it.
 *
 * A context rather than props because the grip is rendered by the row
 * components, three or four levels below the list that owns the order, and
 * threading a handler through every row type would put drag mechanics in the
 * signature of things that only draw a title.
 */
type TouchDrag = {
  id: string;
  begin: (id: string, event: React.PointerEvent) => void;
  active: boolean;
};

const TouchDragContext = createContext<TouchDrag | null>(null);

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

  // -- touch ----------------------------------------------------------------

  const container = useRef<HTMLDivElement>(null);
  const dropAt = useRef<number | null>(null);

  /**
   * Where a finger at this height would insert, measured against the rows
   * themselves rather than tracked as the drag moves.
   *
   * The same reasoning as reading the drop event on a desktop: the rows are on
   * screen and their positions are the authority, so nothing depends on having
   * kept a running total correct through every move event.
   */
  const indexForY = useCallback((y: number): number => {
    const rows = container.current?.children;
    if (!rows) return 0;

    for (let i = 0; i < rows.length; i += 1) {
      const box = rows[i].getBoundingClientRect();
      if (y < box.top + box.height / 2) return i;
    }
    return rows.length;
  }, []);

  const beginTouchDrag = useCallback(
    (id: string, event: React.PointerEvent) => {
      // A mouse already has HTML5 drag and drop, which handles cross-list
      // drops and the drag image. Claiming it here would replace something
      // that works with something that does less.
      if (event.pointerType === 'mouse') return;

      event.preventDefault();
      event.stopPropagation();

      const grip = event.currentTarget as HTMLElement;

      // Capture is what keeps the drag alive once the finger leaves the row,
      // which it does immediately. Not fatal if the browser refuses — the
      // listeners below are on the grip either way.
      try {
        grip.setPointerCapture(event.pointerId);
      } catch {
        /* no capture; the drag still tracks while the finger is over it */
      }

      setDraggingId(id);
      dropAt.current = null;

      const move = (e: PointerEvent) => {
        const at = indexForY(e.clientY);
        dropAt.current = at;
        setInsertAt(at);
        autoScroll(container.current, e.clientY);
      };

      const finish = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', finish);
        grip.removeEventListener('pointercancel', cancel);

        const at = dropAt.current;
        dropAt.current = null;
        if (at === null) return reset();
        handleDrop(id, at);
      };

      const cancel = () => {
        dropAt.current = null;
        finish();
      };

      // On the grip, not the window: pointer capture routes every subsequent
      // event for this pointer here, so the drag survives the finger leaving
      // the row — which it does immediately, that being the point.
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', finish);
      grip.addEventListener('pointercancel', cancel);
    },
    // `handleDrop` and `reset` are redeclared each render and close over
    // `order`; the listeners are attached per drag, so they always see the
    // render that started it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indexForY, order],
  );

  if (order.length === 0 && emptyState) return <>{emptyState}</>;

  return (
    <div
      ref={container}
      onDragLeave={(e) => e.currentTarget === e.target && setInsertAt(null)}
    >
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
          <TouchDragContext.Provider
            // Per row, so the grip inside knows which row it belongs to
            // without every row component having to be told.
            value={{
              id: item.id,
              begin: beginTouchDrag,
              active: draggingId === item.id,
            }}
          >
            {renderItem(item, draggingId === item.id)}
          </TouchDragContext.Provider>
          {insertAt === order.length && index === order.length - 1 ? (
            <InsertionLine atBottom />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Keep scrolling while a finger is held near the top or bottom edge.
 *
 * Without it a drag can only reach as far as the screen: there is nowhere to
 * move the finger to, so a row can never be sent past the rows currently
 * visible. A mouse drag gets this from the browser and a touch drag does not.
 */
function autoScroll(list: HTMLElement | null, y: number): void {
  const pane = scrollParent(list);
  if (!pane) return;

  const box = pane.getBoundingClientRect();
  const edge = 56;

  if (y < box.top + edge) pane.scrollBy({ top: -12 });
  else if (y > box.bottom - edge) pane.scrollBy({ top: 12 });
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
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

/**
 * The grab affordance — and, on a touchscreen, the thing that does the
 * dragging.
 *
 * On a desktop it stays what it always was: decoration over a row that is
 * itself `draggable`, hidden until you hover, because a column of grips is
 * visual noise for a gesture the whole row already supports.
 *
 * A touchscreen has neither hover nor HTML5 drag, so both of those decisions
 * invert. `max-md:opacity-100` makes it permanently visible — an invisible
 * handle on a device with no hover is no handle — and `touch-action: none`
 * tells the browser this element's gestures are not scrolling, without which
 * the list slides away under the finger instead of the row moving.
 *
 * Outside a `SortableList` the context is absent and this is inert, exactly as
 * before: a grip on a row nothing can reorder should not pretend otherwise.
 */
export function DragGrip() {
  const drag = useContext(TouchDragContext);

  return (
    <span
      aria-hidden
      onPointerDown={drag ? (e) => drag.begin(drag.id, e) : undefined}
      style={drag ? { touchAction: 'none' } : undefined}
      className={[
        'shrink-0 cursor-grab select-none leading-none transition-opacity',
        // A fingertip target on a phone, a hairline on a desktop.
        'mt-1 text-[11px] max-md:mt-0 max-md:px-1.5 max-md:py-2 max-md:text-[15px]',
        drag?.active ? 'text-selected' : 'text-grey-300',
        'opacity-0 group-hover:opacity-100 max-md:opacity-100',
      ].join(' ')}
      title="Drag to reorder"
    >
      ⠿
    </span>
  );
}
