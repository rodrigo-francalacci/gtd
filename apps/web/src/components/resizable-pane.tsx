'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { setListPaneWidth } from '@/lib/actions';
import { MAX_PANE_WIDTH, MIN_PANE_WIDTH } from '@/lib/pane';

/**
 * A pane with one draggable vertical edge.
 *
 * Pointer events rather than HTML5 drag-and-drop: this is a continuous gesture
 * that needs the pane to follow the cursor, not a drop with a payload. Pointer
 * capture also means the drag survives the cursor leaving the 5px handle,
 * which is the usual way a naive resizer feels broken.
 *
 * The width is local state during the drag and written to the database once,
 * on release — persisting every pointermove would be a request per pixel.
 */
export function ResizablePane({
  initialWidth,
  defaultWidth,
  children,
  edge = 'right',
  min = MIN_PANE_WIDTH,
  max = MAX_PANE_WIDTH,
  label = 'Resize list pane',
  onCommit = setListPaneWidth,
  className = 'border-r border-grey-200 bg-grey-50',
}: {
  initialWidth: number;
  /**
   * What a double-click goes back to. Distinct from `initialWidth`, which is
   * whatever was last saved — resetting to that is a no-op, which is what the
   * handle used to do the moment you had dragged it once.
   */
  defaultWidth?: number;
  children: ReactNode;
  /**
   * Which side the handle sits on. A pane at the right of the window grows as
   * the cursor moves *left*, so the delta is signed by this rather than by the
   * caller remembering to negate it.
   */
  edge?: 'left' | 'right';
  min?: number;
  max?: number;
  label?: string;
  onCommit?: (width: number) => void | Promise<unknown>;
  className?: string;
}) {
  const [width, setWidth] = useState(initialWidth);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(initialWidth);

  // Adopt a new server value (e.g. after switching density) unless the user is
  // mid-drag, in which case their gesture wins.
  useEffect(() => {
    if (!dragging) setWidth(initialWidth);
  }, [initialWidth, dragging]);

  const clamp = useCallback(
    (n: number) => Math.min(max, Math.max(min, n)),
    [min, max],
  );

  const direction = edge === 'right' ? 1 : -1;
  const widthAt = (clientX: number) =>
    clamp(startWidth.current + direction * (clientX - startX.current));

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    startWidth.current = width;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setWidth(widthAt(e.clientX));
  };

  const finish = (e: React.PointerEvent) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
    const final = widthAt(e.clientX);
    if (final !== startWidth.current) void onCommit(final);
  };

  // Keep the whole window showing a resize cursor and stop text selecting
  // while the gesture is live.
  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previous;
      document.body.style.userSelect = '';
    };
  }, [dragging]);

  return (
    <div
      style={{ width }}
      className={['relative flex shrink-0 flex-col', className].join(' ')}
    >
      {children}

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onDoubleClick={() => {
          const reset = clamp(defaultWidth ?? initialWidth);
          setWidth(reset);
          void onCommit(reset);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const step = (e.shiftKey ? 40 : 10) * direction;
          const next = clamp(width + (e.key === 'ArrowRight' ? step : -step));
          setWidth(next);
          void onCommit(next);
        }}
        className={[
          'absolute inset-y-0 z-30 w-1.5 cursor-col-resize',
          edge === 'right' ? '-right-0.5' : '-left-0.5',
          dragging ? 'bg-selected' : 'hover:bg-grey-300',
        ].join(' ')}
      />
    </div>
  );
}
