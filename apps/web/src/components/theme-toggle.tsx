'use client';

import { useEffect, useState, useTransition } from 'react';
import { setTheme } from '@/lib/actions';
import type { Theme } from '@/lib/pane';
import { IconMoon, IconScroll, IconSignal, IconSun, IconTube } from './icons';

/**
 * Light, dark, paper and the two consoles, as one button.
 *
 * The stored preference may be null, meaning "whatever the operating system
 * says" — which only the browser knows. So the button asks it on mount and
 * offers the next theme along from whatever is actually on screen, rather than
 * assuming a starting point the CSS may already have overruled.
 *
 * Until that first effect runs there is nothing honest to draw, so it renders a
 * space of the right size. A guessed icon would flip a moment later on every
 * load, which is worse than a blank for one frame.
 *
 * **A cycle rather than a menu**, and at five this is the argument's last
 * stand. The whole control is a 14-pixel glyph in the corner of the sidebar
 * beside the sign-out link, and anything with a panel attached would be the
 * loudest thing down there — but four presses is now the worst case, which is
 * one more than anybody should have to count. The two consoles being adjacent
 * is what keeps it bearable: going from one phosphor to the other is a single
 * press, and that is the journey somebody actually makes. A sixth theme is the
 * menu, and this comment should stop arguing at that point.
 */

/**
 * In order, quietest first.
 *
 * Light and dark are what an operating system asks for; paper and the consoles
 * are the ones you go looking for. The two tubes sit together at the end,
 * because green and amber are the same theme in two colours and swapping
 * between them should be one press rather than four.
 */
const ORDER = ['light', 'dark', 'paper', 'sci', 'amber'] as const;

type Real = (typeof ORDER)[number];

const ICON = {
  light: IconSun,
  dark: IconMoon,
  paper: IconScroll,
  sci: IconSignal,
  amber: IconTube,
} as const;

const CALLED = {
  light: 'light',
  dark: 'dark',
  paper: 'paper',
  sci: 'green console',
  amber: 'amber console',
} as const;

export function ThemeToggle({ preference }: { preference: Theme }) {
  const [now, setNow] = useState<Real | null>(preference);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (preference !== null) {
      setNow(preference);
      return;
    }
    // No stored choice: the media query decided, and only the browser can say
    // which way. Paper is never the answer here — nothing asks an operating
    // system for parchment.
    setNow(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }, [preference]);

  if (now === null) return <span className="h-3.5 w-3.5" aria-hidden />;

  const next = ORDER[(ORDER.indexOf(now) + 1) % ORDER.length];
  const Icon = ICON[next];

  return (
    <button
      type="button"
      title={`Switch to ${CALLED[next]} mode`}
      aria-label={`Switch to ${CALLED[next]} mode`}
      onClick={() => {
        // Flip locally first: the round trip is a revalidation of the whole
        // shell, and a button that waits for that feels broken.
        setNow(next);
        startTransition(async () => {
          await setTheme(next);
        });
      }}
      className="text-grey-400 transition-colors hover:text-grey-700"
    >
      <Icon />
    </button>
  );
}
