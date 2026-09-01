'use client';

import { useEffect } from 'react';

/**
 * Keeps a scrollbar visible for a moment after the scrolling stops.
 *
 * Hover alone is not enough: a touchpad flick or a wheel scroll moves the list
 * without the pointer ever being over the bar, and a scrollbar that stayed
 * invisible through that would leave you with no idea where you are in a long
 * sidebar. So the pane wears `.scrolling` while it moves and for a breath
 * afterwards.
 *
 * A class on the element rather than React state, and a `ref`-free query for
 * the same reason `ListKeys` finds rows by href: the pane is rendered by a
 * server component several files away, and threading a ref through it to
 * animate a scrollbar is more machinery than the effect is worth.
 *
 * Passive, because this listener never calls `preventDefault` and telling the
 * browser so is what keeps a scroll off the main thread.
 */
export function ScrollFade({ selector }: { selector: string }) {
  useEffect(() => {
    const pane = document.querySelector(selector);
    if (!pane) return;

    let idle: ReturnType<typeof setTimeout> | null = null;

    const onScroll = () => {
      pane.classList.add('scrolling');
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => pane.classList.remove('scrolling'), 700);
    };

    pane.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      if (idle) clearTimeout(idle);
      pane.removeEventListener('scroll', onScroll);
      pane.classList.remove('scrolling');
    };
  }, [selector]);

  return null;
}
