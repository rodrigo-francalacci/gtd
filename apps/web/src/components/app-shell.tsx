'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { PreviewPane, useFilePreview, useOpenPreview } from './file-preview';
import { MobileBar } from './mobile-bar';
import { IconMenu } from './icons';

/**
 * The same panes, arranged two ways.
 *
 * On a wide screen this is the three-pane Evernote row it has always been. On a
 * phone the panes become panels of a horizontal swipe track: the list, then the
 * thing you tapped, then the file you opened — the same information in the same
 * order, traversed one screen at a time instead of seen all at once.
 *
 * *Nothing above this line changes.* Every page still returns its panes as
 * plain siblings, and this decides what that means, which is why the whole app
 * arrives on the phone at once rather than being rebuilt view by view. The
 * difference between the two devices was never the content of a pane. It was
 * whether you can see three at a time, and whether you have a mouse.
 *
 * Which means the media queries below are not the thing that was rightly
 * objected to. That was every *component* carrying a branch for a device it is
 * not on. This is one place, describing one difference, and the components
 * inside it know nothing about it.
 */
export function AppShell({
  sidebar,
  children,
}: {
  /** Pane 1. A fixed column on a desktop, a drawer on a phone. */
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const preview = useOpenPreview();
  const { close } = useFilePreview();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const params = useSearchParams();
  const track = useRef<HTMLElement>(null);
  /** Whether a history entry is standing in for the open preview pane. */
  const pushed = useRef(false);

  /**
   * Whether a *row* is chosen, as opposed to a list merely being open.
   *
   * `/projects` is a list to choose from; `/projects/<id>` is a choice. Some
   * views say so with a search parameter instead, which is the same fact in a
   * different place. Filters — a context, a tag, a date range — are neither:
   * they narrow the list you are reading and must not count.
   */
  const chosen =
    ['item', 'doc', 'action', 'area', 'goal', 'event'].some((key) =>
      params.get(key),
    ) || /^\/(projects|lists|box)\/[^/]+/.test(pathname);

  /**
   * Which pane the carousel should be showing.
   *
   * One derived number rather than an effect per event, because the previous
   * shape had two effects reaching for the same scroll position and the one
   * that ran on mount always won: it moved to pane 1 before anything had been
   * chosen, so opening any list landed you on the empty detail pane — which,
   * with only two panes, is the last one. Deriving the answer means there is
   * no moment when nobody has decided.
   *
   *   0  the list — nothing chosen
   *   1  the detail — a row is chosen
   *   2  the file — a preview is open
   *
   * Correct on first paint too, which is what makes a link to a particular
   * project open that project rather than the list it happens to be in.
   */
  const target = preview ? 2 : chosen ? 1 : 0;

  useEffect(() => {
    scrollToPane(track.current, target);
  }, [target, pathname]);

  /**
   * Back closes the preview instead of leaving the app.
   *
   * Only the preview needs this, and it is worth being clear why: going from a
   * list to a row *is* a navigation — the URL changes — so back already
   * returns you to the list without anything here. Opening a file does not
   * change the URL; the pane belongs to the window rather than to the row it
   * was opened from. So it is the one step forward the browser cannot see, and
   * on Android that means back would close the whole app from a file preview.
   *
   * One entry is pushed when the pane opens, and closing it always goes
   * through history — the × button included. Otherwise the button would leave
   * that entry behind and the next back press would do nothing visible, which
   * is worse than the problem being fixed.
   */
  useEffect(() => {
    if (!preview) return;

    // A marker, not a route: the URL is untouched, so nothing re-renders and a
    // reload lands exactly where it would have anyway.
    window.history.pushState({ gtdPreview: true }, '');
    pushed.current = true;

    const onPop = () => {
      pushed.current = false;
      close();
    };

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [preview, close]);

  const closePreview = () => {
    // Through history, so the button and the gesture end in the same place.
    if (pushed.current) window.history.back();
    else close();
  };

  return (
    <div
      data-preview={preview ? 'open' : 'closed'}
      className="group/shell flex h-[100dvh] w-screen flex-col md:flex-row"
    >
      {/* Pane 1. Static beside the panes on a desktop; on a phone it slides
          over them, because a phone has no width to spare for navigation that
          is only used between tasks. */}
      <div
        /*
         * Choosing something is the end of navigating, so the drawer closes on
         * the act of choosing rather than on the route changing afterwards.
         * Tying it to the route would also leave it open when you tap the view
         * you are already on — nothing changes, so nothing would close it.
         */
        onClick={(event) => {
          if ((event.target as Element).closest('a')) setDrawerOpen(false);
        }}
        className={[
          'z-50 shrink-0',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:w-72 max-md:transition-transform',
          drawerOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
        ].join(' ')}
      >
        {sidebar}
      </div>

      {/* Tapping away closes it — the standard way out of a drawer, and the
          one people try first. */}
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
          className="z-40 bg-ink/40 max-md:fixed max-md:inset-0 md:hidden"
        />
      ) : null}

      <main ref={track} className="pane-track min-h-0 flex-1">
        {children}
        {preview ? <PreviewPane file={preview} onClose={closePreview} /> : null}
      </main>

      <MobileBar onOpenMenu={() => setDrawerOpen(true)} menuIcon={<IconMenu />} />
    </div>
  );
}

/**
 * Move the carousel to a pane, if there is a carousel.
 *
 * A no-op side by side: the track does not scroll there, so `scrollTo` has
 * nowhere to go and asking costs nothing. That is why this needs no check for
 * which layout is in force — the layout is a fact about the element, and the
 * element already knows it.
 *
 * `smooth` because the movement is the explanation: it is what tells you the
 * pane you are now looking at came from the right, and that swiping back is
 * how you return. A jump would leave you somewhere new with no account of how.
 */
function scrollToPane(track: HTMLElement | null, index: number): void {
  if (!track) return;

  const pane = track.children[index] as HTMLElement | undefined;
  if (!pane) return;

  track.scrollTo({
    left: pane.offsetLeft - track.offsetLeft,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth',
  });
}
