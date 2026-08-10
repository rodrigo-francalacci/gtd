'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { setListPaneWidth } from '@/lib/actions';
import { MAX_PANE_WIDTH, MIN_PANE_WIDTH } from '@/lib/pane';

/**
 * Wraps the list pane and gives it a draggable right edge.
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
  children,
}: {
  initialWidth: number;
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

  const clamp = (n: number) => Math.min(MAX_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, n));

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startX.current = e.clientX;
    startWidth.current = width;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setWidth(clamp(startWidth.current + (e.clientX - startX.current)));
  };

  const finish = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      setDragging(false);
      const final = clamp(startWidth.current + (e.clientX - startX.current));
      if (final !== startWidth.current) void setListPaneWidth(final);
    },
    [dragging],
  );

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
          // Double-click resets to the mode's default.
          setWidth(initialWidth);
          void setListPaneWidth(initialWidth);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 40 : 10;
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
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
