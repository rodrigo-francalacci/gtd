'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Make the detail pane assemble itself, in console mode only.
 *
 * Selecting a row is the moment the third pane fills with something new, and on
 * a terminal that is not an instant event — the screen is written, a line at a
 * time. So each section of the pane is dealt in turn: the heading, then the
 * body, then the attachments, then the rest, each wiped in left to right.
 *
 * **Why this needs JavaScript at all.** The stagger and the wipe are pure CSS —
 * see `console-deal` in `globals.css` — but a CSS animation runs when an element
 * is *created*, and React reconciles the detail pane in place when you pick a
 * different row. The DOM nodes survive, so the animation never runs a second
 * time. This restarts them by hand, which is the whole of what it does.
 *
 * **It does not remount anything**, and that is the point. The obvious fix is a
 * `key` on the pane that changes with the selection, but that would unmount and
 * rebuild the pane for *every* theme — a real behaviour change, affecting
 * drafts and focus, in service of one theme's decoration. A theme is not
 * allowed to cost the other three anything.
 *
 * Which is also why it checks `data-theme` before touching a single element: in
 * light, dark and paper this runs two comparisons per navigation and returns.
 */
export function ConsoleCascade() {
  const path = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    // Both tubes, and nothing else. A set rather than a comparison, because
    // there are two consoles now and a third would be a third phosphor rather
    // than a new idea.
    const theme = document.documentElement.dataset.theme;
    if (theme !== 'sci' && theme !== 'amber') return;

    const pane = document.querySelector('[data-pane="detail"]');
    if (!pane) return;

    /*
     * The sections, which are one level below the pane: the capped column holds
     * a single element per detail component, and that element's children are
     * the parts somebody would name — the header, the note, the attachments.
     * Read from the DOM rather than declared, so a pane that grows a section
     * gets it dealt without anybody remembering to say so.
     */
    const sections = pane.querySelectorAll<HTMLElement>(':scope > * > *');

    for (const section of sections) {
      /*
       * Clear, force a reflow, restore. Reading `offsetWidth` between the two
       * is what makes the browser notice the animation went away and came back
       * — without it the two assignments collapse into no change at all, which
       * is the classic way this trick silently does nothing.
       */
      section.style.animation = 'none';
      void section.offsetWidth;
      section.style.animation = '';
    }
  }, [path, search]);

  return null;
}
