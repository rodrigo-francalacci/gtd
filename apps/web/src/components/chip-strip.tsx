'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * One line of filter chips that slides sideways instead of wrapping.
 *
 * The layout is `.chip-strip` in globals.css; what lives here is the one thing
 * CSS cannot do — **a wheel over the strip scrolls the strip**.
 *
 * A mouse wheel reports vertical movement, and a browser sends that to the
 * nearest *vertically* scrolling ancestor. Over a row that only scrolls
 * sideways it therefore does nothing to the row and scrolls the pane behind it
 * instead, which is the one place the desktop had no gesture at all: a finger
 * can slide the chips on a phone, and a mouse had to find the 8px scrollbar
 * under them.
 *
 * **It gives the wheel back at each end.** Once the strip has nothing left to
 * show in that direction the event is left alone, so the pane scrolls on as it
 * always did. Without that the strip becomes a trap: a wheel over the header
 * would silently stop the list moving, which reads as a frozen page.
 *
 * **A sideways wheel is left alone too** — a trackpad's own horizontal gesture
 * already scrolls this element natively, and intercepting it would double
 * every movement. `ctrlKey` is the browser's pinch-zoom and is never ours.
 *
 * `passive: false` is why this is an effect rather than an `onWheel` prop:
 * React attaches wheel handlers passively, and a passive listener may not call
 * `preventDefault`, which is the whole trick.
 */
export function ChipStrip({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      // A trackpad swipe already does the right thing; only the vertical
      // component of a mouse wheel needs translating.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (event.deltaY === 0) return;

      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;

      // At either end the page keeps the wheel, so the strip never traps it.
      const atStart = event.deltaY < 0 && el.scrollLeft <= 0;
      const atEnd = event.deltaY > 0 && el.scrollLeft >= max - 1;
      if (atStart || atEnd) return;

      /*
       * `deltaMode` is lines on some mice and pixels on most. A line is
       * nobody's unit here, so it is converted at roughly one row of chips —
       * without it those mice move the strip a pixel or two per notch.
       */
      const step = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;

      event.preventDefault();
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + step));
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div ref={strip} className={`chip-strip scrollbar-fade ${className}`.trim()}>
      {children}
    </div>
  );
}
