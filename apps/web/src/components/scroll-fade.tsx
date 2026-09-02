'use client';

import { useEffect } from 'react';

/**
 * Keeps a scrollbar visible for a moment after the scrolling stops.
 *
 * Hover alone is not enough: a touchpad flick or a wheel scroll moves the list
 * without the pointer ever being over the bar, and a scrollbar that stayed
 * invisible through that would leave you with no idea where you are in a long
 * list. So a pane wears `.scrolling` while it moves and for a breath afterwards.
 *
 * **One listener on the document, not one per pane.** It began as a
 * `querySelector` for a single element, which was right while the sidebar was
 * the only pane that faded — the sidebar is rendered once by the shell and
 * stays put. Panes two and three do not: they are rendered by whichever route
 * segment is showing and are replaced on every navigation, so an element found
 * once and listened to would be a stale node a click later, and the fade would
 * work until you went anywhere.
 *
 * `scroll` does not bubble, but it *does* capture — which is what makes one
 * listener at the top able to hear a pane four segments below it, including
 * panes that did not exist when this mounted. Nothing is queried, nothing is
 * re-attached on navigation, and a pane opts in by wearing the class.
 *
 * Passive, because this never calls `preventDefault` and saying so is what
 * keeps a scroll off the main thread.
 */
export function ScrollFade() {
  useEffect(() => {
    /*
     * Weak, so a pane that has been navigated away from is collectable while
     * its timer is still pending. The stray timeout that follows removes a
     * class from a detached node, which costs nothing — where a `Map` would
     * hold every pane the session ever scrolled.
     */
    const idle = new WeakMap<Element, ReturnType<typeof setTimeout>>();

    const onScroll = (event: Event) => {
      const pane = event.target;
      if (!(pane instanceof Element) || !pane.classList.contains('scrollbar-fade')) {
        return;
      }

      pane.classList.add('scrolling');

      const running = idle.get(pane);
      if (running) clearTimeout(running);
      idle.set(
        pane,
        setTimeout(() => pane.classList.remove('scrolling'), 700),
      );
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  return null;
}
