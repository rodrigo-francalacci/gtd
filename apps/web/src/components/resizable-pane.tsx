'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { setListPaneWidth } from '@/lib/actions';
import { MAX_PANE_WIDTH, MIN_PANE_WIDTH } from '@/lib/pane';

/**
 * The list pane, with one draggable vertical edge.
 *
 * Pointer events rather than HTML5 drag-and-drop: this is a continuous gesture
 * that needs the pane to follow the cursor, not a drop with a payload. Pointer
 * capture also means the drag survives the cursor leaving the 5px handle,
 * which is the usual way a naive resizer feels broken.
 *
 * The width is local state during the drag and written to the database once,
 * on release — persisting every pointermove would be a request per pixel.
 *
 * It once took an `edge`, a `min`/`max`, a commit handler and a class name,
 * because the preview pane was the second caller. The preview now takes
 * whatever is left over, so all of that had exactly one value each and has
 * gone rather than sitting here looking configurable.
 */
export function ResizablePane({
  initialWidth,
  defaultWidth,
  children,
}: {
  initialWidth: number;
  /**
   * What a double-click goes back to. Distinct from `initialWidth`, which is
   * whatever was last saved — resetting to that is a no-op, which is what the
   * handle used to do the moment you had dragged it once.
   */
  defaultWidth?: number;
  children: ReactNode;
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
    (n: number) => Math.min(MAX_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, n)),
    [],
  );

  const widthAt = (clientX: number) =>
    clamp(startWidth.current + (clientX - startX.current));

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
    if (final !== startWidth.current) void setListPaneWidth(final);
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
      className="relative flex shrink-0 flex-col border-r border-grey-200 bg-grey-50"
    >
      {children}

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize list pane"
        aria-valuenow={width}
        aria-valuemin={MIN_PANE_WIDTH}
        aria-valuemax={MAX_PANE_WIDTH}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onDoubleClick={() => {
          const reset = clamp(defaultWidth ?? initialWidth);
          setWidth(reset);
          void setListPaneWidth(reset);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const step = e.shiftKey ? 40 : 10;
          const next = clamp(width + (e.key === 'ArrowRight' ? step : -step));
          setWidth(next);
          void setListPaneWidth(next);
        }}
        className={[
          'absolute inset-y-0 -right-0.5 z-30 w-1.5 cursor-col-resize',
          dragging ? 'bg-selected' : 'hover:bg-grey-300',
        ].join(' ')}
      />
    </div>
  );
}
