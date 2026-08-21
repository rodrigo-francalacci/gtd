import type { Metadata, Viewport } from 'next';
import { MobileTabs } from '@/components/mobile-tabs';
import { requireSession } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'GTD',
  // Added to a home screen this becomes the app's name.
  appleWebApp: { capable: true, title: 'GTD', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /**
   * `resizes-content` keeps the primary action above the on-screen keyboard
   * instead of behind it. Pinch-zoom is deliberately left alone: disabling it
   * to stop iOS zooming a focused field is the wrong fix, and 16px text is the
   * right one.
   */
  interactiveWidget: 'resizes-content',
};

/**
 * The phone.
 *
 * A separate frontend rather than the desktop under media queries, and the
 * distinction is not about width. Media queries can hide and reflow; they
 * cannot restructure *interaction*. The desktop is drag-to-file, controls
 * revealed on hover, a resizable pane, three columns and a `c` hotkey. A phone
 * has one hand, no hover, no keyboard and no drag-and-drop at all, and it is
 * used standing up. Serving both from one component tree means every component
 * grows a branch for a device it is not being used on.
 *
 * This is the same call `/capture` already made by sitting outside the `(app)`
 * group; this finishes it.
 *
 * What is *not* duplicated is everything below the view: the Server Actions,
 * `lib/`, the queries and the upload path are the ones the desktop and the
 * Chrome extension use. Two view layers is a design decision; two
 * implementations of "what happens when you capture something" would be a bug
 * waiting to be fixed in only one of them.
 *
 * Gates on the session itself, because no group layout is doing it here — the
 * same reason `/capture` and `/signin` do.
 */
export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();

  return (
    /* `dvh`, not `vh`: mobile browsers shrink the viewport as their chrome
       slides away, and `vh` keeps the old number — which puts the tab bar
       below the fold on exactly the devices this is for. */
    <div className="flex h-[100dvh] flex-col bg-paper">
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      <MobileTabs />
    </div>
  );
}
