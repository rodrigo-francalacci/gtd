'use client';

import { useEffect, useState, useTransition } from 'react';
import { setTheme } from '@/lib/actions';
import type { Theme } from '@/lib/pane';
import { IconMoon, IconScroll, IconSignal, IconSun } from './icons';

/**
 * Light, dark, paper and console, as one button.
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
 * **A cycle rather than a menu**, still — at four it is the last moment that is
 * true. The whole control is a 14-pixel glyph in the corner of the sidebar
 * beside the sign-out link, and anything with a panel attached would be the
 * loudest thing down there. Three presses is now the worst case, and the icon
 * always says what the next one gives you. A fifth theme would need the menu.
 */

/**
 * In order, quietest first.
 *
 * Light and dark are what an operating system asks for; paper and console are
 * the two you go looking for. Console is last because it is the furthest from
 * a document and the least likely to be somebody's every day.
 */
const ORDER = ['light', 'dark', 'paper', 'sci'] as const;

type Real = (typeof ORDER)[number];

const ICON = {
  light: IconSun,
  dark: IconMoon,
  paper: IconScroll,
  sci: IconSignal,
} as const;

const CALLED = {
  light: 'light',
  dark: 'dark',
  paper: 'paper',
  sci: 'console',
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
