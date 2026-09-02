'use client';

import { useEffect, useRef } from 'react';
import { setNoteHeight, type NoteSurface } from '@/lib/actions';

/**
 * Keeps the height you dragged an editor to.
 *
 * Every note field in the app opened at the same four rows however you had left
 * it, so writing anything longer than a sentence began with dragging the corner
 * — every time, on every row. The height is a preference about how you like to
 * write, not a fact about the document, which is why it is remembered per
 * *surface* rather than per row: one for the rich editor that projects, actions
 * and list items share, one for a box entry's field. Per row would still open
 * every new document short, which is the case that annoys most.
 *
 * **Written once, when the drag ends.** A `ResizeObserver` fires continuously
 * while the corner is moving, and saving there would be a request per pixel —
 * the mistake the pane resize already made and fixed. This waits for the
 * movement to stop.
 *
 * The *applying* is not done here at all: the height arrives as a CSS variable
 * set by the app layout, which is server-rendered, so the editor is already the
 * right size on first paint. Setting it from an effect would show four rows and
 * then jump, which is the flash the preferences table exists to avoid.
 */
export function RememberedHeight({
  surface,
  /** The element to watch — a ref shared with whatever is resizable. */
  target,
}: {
  surface: NoteSurface;
  target: React.RefObject<HTMLElement | null>;
}) {
  const saved = useRef<number | null>(null);

  useEffect(() => {
    const element = target.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    let idle: ReturnType<typeof setTimeout> | null = null;

    const observer = new ResizeObserver(() => {
      if (idle) clearTimeout(idle);

      idle = setTimeout(() => {
        const height = Math.round(element.getBoundingClientRect().height);
        if (!height || height === saved.current) return;

        saved.current = height;

        /*
         * Set on the element the server set it on, so the *other* editors of
         * this surface follow immediately rather than after a navigation.
         *
         * Deliberately not `documentElement`: the layout defines these on a
         * wrapper, and a custom property is inherited from the nearest ancestor
         * that sets it — so a value on `<html>` would sit *outside* the wrapper
         * and be shadowed by it, and the live update would silently do nothing
         * while looking exactly right in the devtools.
         */
        document
          .querySelector<HTMLElement>('[data-note-heights]')
          ?.style.setProperty(
            surface === 'note' ? '--note-height' : '--box-note-height',
            `${height}px`,
          );

        void setNoteHeight(surface, height);
      }, 400);
    });

    observer.observe(element);

    return () => {
      if (idle) clearTimeout(idle);
      observer.disconnect();
    };
  }, [surface, target]);

  return null;
}
