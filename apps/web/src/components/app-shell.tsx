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

  /**
   * What you tapped comes to you.
   *
   * Side by side, selecting a row just fills the pane already on screen. One at
   * a time, the detail pane is off to the right — so without this you would tap
   * a project, watch nothing happen, and have to swipe to find out that it had.
   * The panes are a carousel you can move by hand; they still have to move on
   * their own when you have plainly asked for the next one.
   *
   * Keyed on what counts as a *selection*, not on any navigation. Choosing a
   * context on the Now list or a tag in a box also rewrites the URL, and being
   * thrown forward a pane for narrowing the list you are reading would be the
   * opposite of helpful. A different path is a selection (`/projects/<id>`);
   * so is one of the params that name a chosen row.
   */
  const selection = [
    pathname,
    ...['item', 'doc', 'action', 'area', 'goal', 'event'].map(
      (key) => params.get(key) ?? '',
    ),
  ].join('|');

  const previous = useRef(selection);

  useEffect(() => {
    const changed = previous.current !== selection;
    previous.current = selection;

    // Not on first paint: arriving at a URL that already names a row should
    // leave you at the list, which is the thing you can navigate from.
    if (!changed) return;
    scrollToPane(track.current, 1);
  }, [selection]);

  /**
   * Opening a file moves to it; closing one comes back.
   *
   * The preview is the far end of the same carousel, so the gesture and the
   * button agree — swipe left from the detail pane and you are looking at the
   * file, close it and you are back where you opened it from.
   */
  useEffect(() => {
    scrollToPane(track.current, preview ? 2 : 1);
  }, [preview]);

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
        {preview ? <PreviewPane file={preview} onClose={close} /> : null}
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
