'use client';

import { useEffect, useRef } from 'react';
import { setNoteHeight, type NoteSurface } from '@/lib/actions';

/**
 * Keeps the height you dragged *this* note to.
 *
 * Every note field opened at the same few rows however you had left it, so
 * writing anything longer began with dragging the corner — every time, on every
 * row. Remembered per row rather than per kind of editor, because the useful
 * height is a fact about the note in front of you: a one-line reminder and a
 * page about a renovation want different things.
 *
 * **Written once, when the drag ends.** A `ResizeObserver` fires continuously
 * while the corner moves, and saving there would be a request per pixel — the
 * mistake the pane resize already made and fixed. This waits for the movement
 * to stop.
 *
 * The *applying* is not done here: the row's height is rendered by the server
 * as an inline style, so the editor is already right on the first paint.
 * Setting it from an effect would show a short box and then jump, which is the
 * flash the preferences table exists to avoid.
 *
 * Note that a hidden tab runs no rendering lifecycle, so `ResizeObserver` never
 * delivers there — which is a fact about testing this, not about using it.
 */
export function RememberedHeight({
  surface,
  id,
  /** The element to watch — a ref shared with whatever is resizable. */
  target,
}: {
  surface: NoteSurface;
  id: string;
  target: React.RefObject<HTMLElement | null>;
}) {
  const saved = useRef<number | null>(null);

  useEffect(() => {
    const element = target.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    // A different note is a different height: nothing carried over from the
    // one that was open a moment ago.
    saved.current = null;

    let idle: ReturnType<typeof setTimeout> | null = null;

    const observer = new ResizeObserver(() => {
      if (idle) clearTimeout(idle);

      idle = setTimeout(() => {
        const height = Math.round(element.getBoundingClientRect().height);
        if (!height || height === saved.current) return;

        saved.current = height;
        void setNoteHeight(surface, id, height);
      }, 400);
    });

    observer.observe(element);

    return () => {
      if (idle) clearTimeout(idle);
      observer.disconnect();
    };
  }, [surface, id, target]);

  return null;
}
