'use client';

import { useEffect, useState, useTransition } from 'react';
import { setTheme } from '@/lib/actions';
import type { Theme } from '@/lib/pane';
import { IconMoon, IconSun } from './icons';

/**
 * Light / dark, as one button.
 *
 * The stored preference may be null, meaning "whatever the operating system
 * says" — which only the browser knows. So the button asks it on mount and
 * offers the opposite of whatever is actually on screen, rather than assuming
 * a starting point the CSS may already have overruled.
 *
 * Until that first effect runs there is nothing honest to draw, so it renders
 * a space of the right size. A guessed icon would flip a moment later on every
 * load, which is worse than a blank for one frame.
 */
export function ThemeToggle({ preference }: { preference: Theme }) {
  const [dark, setDark] = useState<boolean | null>(
    preference === null ? null : preference === 'dark',
  );
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (preference !== null) {
      setDark(preference === 'dark');
      return;
    }
    setDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, [preference]);

  if (dark === null) return <span className="h-3.5 w-3.5" aria-hidden />;

  const next = dark ? 'light' : 'dark';

  return (
    <button
      type="button"
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      onClick={() => {
        // Flip locally first: the round trip is a revalidation of the whole
        // shell, and a button that waits for that feels broken.
        setDark(!dark);
        startTransition(async () => {
          await setTheme(next);
        });
      }}
      className="text-grey-400 transition-colors hover:text-grey-700"
    >
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}
