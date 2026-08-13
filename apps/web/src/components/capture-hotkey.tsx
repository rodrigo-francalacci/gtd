'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * `c` from anywhere goes to the inbox with the cursor in the capture field.
 *
 * The barrier to capturing is almost never the typing. It is that the thought
 * arrives while you are looking at a project three clicks away, and by the
 * time you have navigated to the inbox you are doing something else. One key
 * closes that gap.
 *
 * A bare letter rather than a chord because this is a single-user desktop app
 * with no competing shortcuts, and a chord you have to remember is a barrier
 * of its own. It yields to any field that is already focused, so typing "c" in
 * a search box or a note stays typing "c".
 */
export function CaptureHotkey() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'c' && event.key !== 'C') return;
      // Modified presses belong to the browser and the operating system —
      // Ctrl+C above all, which must never be intercepted.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (isTyping(target)) return;

      event.preventDefault();

      // Already on the inbox: no navigation, just take the cursor there. The
      // capture box listens for this because it owns the field, and the two
      // are rendered by different route segments.
      if (pathname === '/inbox') {
        window.dispatchEvent(new Event('gtd:focus-capture'));
        return;
      }

      router.push('/inbox');
      // The field mounts after the navigation commits, so the event has to
      // come second. One frame is enough on a client-side push; the capture
      // box also autofocuses on mount, which covers a slower one.
      requestAnimationFrame(() =>
        window.dispatchEvent(new Event('gtd:focus-capture')),
      );
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pathname, router]);

  return null;
}

/**
 * Whether the keystroke belongs to something the user is writing in.
 *
 * `isContentEditable` covers the ProseMirror note editor, which is neither an
 * input nor a textarea and would otherwise lose every "c" typed into it.
 */
function isTyping(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
