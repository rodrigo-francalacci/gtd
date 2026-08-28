'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { PreviewPane, useFilePreview, useOpenPreview } from './file-preview';
import { MobileBar } from './mobile-bar';
import { SidebarSlotTarget, useSidebarSlot } from './sidebar-slot';
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
  const { close, focused } = useFilePreview();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { open: tagsOpen, claim: claimSidebar } = useSidebarSlot();
  const pathname = usePathname();
  const params = useSearchParams();
  const track = useRef<HTMLElement>(null);
  /** Whether a history entry is standing in for the open preview pane. */
  const pushed = useRef(false);

  /**
   * Whether a *row* is chosen, as opposed to a list merely being open.
   *
   * Every one of these names a chosen row, and the list is exhaustive on
   * purpose — a missing one leaves that view unable to reach its own detail
   * pane on a phone, which is silent and looks like the pane is broken.
   *
   * Filters are deliberately absent: `ctx`, `tag`, `type`, `from`, `to`,
   * `impact`, `where`, `filter`, `show`, `step`, `q` and `dropped` all rewrite
   * the URL to narrow the list you are reading, and being thrown forward a
   * pane for that is the opposite of helpful.
   */
  const chosenBy = [
    'item',
    'doc',
    'action',
    'area',
    'goal',
    'event',
    'project',
    'box',
    /*
     * Not a row, but the same kind of thing: something the second pane can be
     * showing that you asked for. A purchases budget fills that pane whenever
     * no item is selected, which side by side needs no name — and one pane at
     * a time made it unreachable, because getting back to it means selecting
     * nothing and a phone has no empty space to click.
     */
    'budget',
  ].map((key) => params.get(key) ?? '');

  /**
   * A fingerprint of *which* row is chosen, for the effect to react to.
   *
   * Only ever compared with a previous fingerprint — never tested for
   * emptiness, which is what went wrong when this replaced the old check: nine
   * empty strings joined by a separator is `"||||||||"`, not `""`, so `chosen`
   * was true on every page in the app and every view opened one pane along.
   * Whether something is chosen is a question about the values, and is asked
   * of the values.
   */
  const selection = chosenBy.join('|');

  const chosen =
    chosenBy.some(Boolean) ||
    /**
     * Only projects put the choice in the path. `/box/<id>` and `/lists/<id>`
     * look like the same shape and are not: those are *lists* — a box's feed,
     * a list's items — which say what is chosen with `doc` and `item`. Treating
     * them as choices is what sent a tap on a box straight to the document
     * pane, past the feed you were trying to look at.
     */
    /^\/projects\/[^/]+/.test(pathname);

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
   *   2  the file — a preview was *asked for*
   *
   * `focused` rather than merely open, and that is the whole of the difference
   * between a file you clicked and one loaded on your behalf. A box document
   * has exactly one file behind it, so it is loaded the moment the document is
   * selected — the swipe to reach it then shows the document instead of an
   * empty pane that starts fetching when you arrive. Being *carried* there
   * would be the opposite: you asked to read the entry, not to look at the
   * scan.
   *
   * Correct on first paint too, which is what makes a link to a particular
   * project open that project rather than the list it happens to be in.
   */
  const target = preview && focused ? 2 : chosen ? 1 : 0;

  /*
   * `selection` is in the dependencies, and not for tidiness.
   *
   * Choosing a *second* row leaves `target` at 1 — a row was chosen before and
   * a row is chosen now — so with only the target to watch, this never ran
   * again. Swipe back to the list, tap another row, and nothing moved: the
   * pane you asked for was rendered, one screen to the right, with no
   * indication it was there. Which row is chosen has to be part of the
   * question, because "go to the detail" is an instruction about *this* row.
   */
  useEffect(() => {
    scrollToPane(track.current, target);
  }, [target, pathname, selection]);

  /**
   * Leaving a section closes the file you had open in it.
   *
   * The preview deliberately survives moving between rows — flicking through a
   * box's documents with one open is the point of it, and it is why the pane
   * belongs to the window rather than to the row it was opened from. But it
   * used to survive *everything*, and one screen at a time that is not a
   * lingering pane, it is a hijacked one: tap Boxes, tap a box, and you land
   * on a file from a project you left two taps ago, because the carousel
   * dutifully went to the pane that was still open.
   *
   * Keyed on the first path segment, so `/projects/a` to `/projects/b` keeps
   * it and `/projects/a` to `/box/x` does not. That is the same line the
   * original reasoning drew; it was simply never enforced, because side by
   * side a stale pane is merely beside you rather than in front of you.
   */
  const section = pathname.split('/')[1] ?? '';
  const lastSection = useRef(section);

  useEffect(() => {
    if (lastSection.current === section) return;
    lastSection.current = section;
    close();
    // The sidebar goes back too. A tag panel for a box you have left is a
    // panel about nothing, sitting on top of the navigation you need next.
    claimSidebar(null);
  }, [section, close, claimSidebar]);

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
    // Only a preview you asked for is a step forward. A preloaded one is a
    // pane sitting quietly to the right; pushing an entry for it would make
    // back appear to do nothing, having undone something invisible.
    if (!preview || !focused) return;

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
  }, [preview, focused, close]);

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
         *
         * A takeover is exempt: its links are filters, and choosing two or
         * three in a row is the normal way to use it.
         */
        onClick={(event) => {
          if (tagsOpen) return;
          if ((event.target as Element).closest('a')) setDrawerOpen(false);
        }}
        className={[
          'relative z-50 shrink-0',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-transform',
          /*
           * Wider while it is lent out. A navigation drawer wants to leave some
           * of the pane behind it visible, so you can see what you are leaving;
           * a panel you are reading and typing into wants the screen. Same
           * element, two jobs, and the width is the honest difference between
           * them.
           */
          tagsOpen ? 'max-md:w-[88vw]' : 'max-md:w-72',
          drawerOpen || tagsOpen
            ? 'max-md:translate-x-0'
            : 'max-md:-translate-x-full',
        ].join(' ')}
      >
        {sidebar}

        {/*
          Where a takeover panel portals to.

          A sibling of the navigation rather than a replacement for it: the panel
          covers it with an opaque background, so nothing has to be unmounted and
          the sidebar's own scroll position survives being borrowed. Empty and
          inert the rest of the time.
        */}
        <SidebarSlotTarget />
      </div>

      {/* Tapping away closes it — the standard way out of a drawer, and the
          one people try first. A takeover closes the same way, which is what
          makes it feel like the modal it is on a phone. */}
      {drawerOpen || tagsOpen ? (
        <button
          type="button"
          aria-label={tagsOpen ? 'Close tags' : 'Close menu'}
          onClick={() => {
            setDrawerOpen(false);
            claimSidebar(null);
          }}
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
 * Instant, not smooth, and that is not a preference. `scroll-snap-type:
 * mandatory` re-snaps whenever the track's contents change — and the moment
 * this is called is exactly such a moment, because a pane has just been added
 * or removed. The re-snap cancels an in-flight smooth scroll and returns to
 * the pane it was already showing, so the call was made, the right offset was
 * asked for, and nothing moved: tap a file and the preview opens off-screen
 * with no sign it exists.
 *
 * The animation was worth having — it is what shows that the new pane came
 * from the right and that swiping back returns — but not at the price of the
 * navigation silently failing. Keeping both would mean turning snapping off
 * around every programmatic scroll and putting it back afterwards, which is
 * more machinery in the path of the thing that has to work.
 */
function scrollToPane(track: HTMLElement | null, index: number): void {
  if (!track) return;

  /*
   * Clamped to the last pane there is.
   *
   * The target for an open preview is 2, which assumes a page renders a list
   * and a detail. Not every page does — the Google page is a single pane — so
   * on those the preview is child 1 and asking for 2 found nothing and did
   * nothing: the pane was rendered off screen, correct in every respect except
   * that no gesture had taken you to it.
   *
   * Clamping rather than counting at the call site, because the number of panes
   * is a fact about the DOM at this moment and this is the only code that reads
   * it. An index past the end can only ever mean the last one.
   */
  const last = track.children.length - 1;
  const pane = track.children[Math.min(index, last)] as HTMLElement | undefined;
  if (!pane) return;

  track.scrollTo({ left: pane.offsetLeft - track.offsetLeft, behavior: 'auto' });
}
