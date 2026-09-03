'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { setTheme } from '@/lib/actions';
import type { Theme } from '@/lib/pane';
import { IconMoon, IconRiso, IconScroll, IconSignal, IconSun, IconTube } from './icons';

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
const ORDER = ['light', 'dark', 'paper', 'sci', 'amber', 'riso'] as const;

type Real = (typeof ORDER)[number];

const ICON = {
  light: IconSun,
  dark: IconMoon,
  paper: IconScroll,
  sci: IconSignal,
  amber: IconTube,
  riso: IconRiso,
} as const;

const CALLED = {
  light: 'light',
  dark: 'dark',
  paper: 'paper',
  sci: 'green console',
  amber: 'amber console',
  riso: 'riso',
} as const;

export function ThemeToggle({ preference }: { preference: Theme }) {
  const [now, setNow] = useState<Real | null>(preference);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ x: 0, y: 0 });
  const [, startTransition] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  /*
   * Close on a press outside, tested by containment rather than by stopping
   * propagation — the trap both context menus were caught by: React attaches
   * component handlers at its root, which is a descendant of `document`, so a
   * capture-phase listener here always runs first and `stopPropagation` on the
   * menu can never prevent it.
   */
  useEffect(() => {
    if (!open) return;

    const away = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menu.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };

    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

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

  const Icon = ICON[now];

  const choose = (theme: Real) => {
    setOpen(false);
    // Locally first: the round trip revalidates the whole shell, and a control
    // that waits for that feels broken.
    setNow(theme);
    startTransition(async () => {
      await setTheme(theme);
    });
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        title={`Theme: ${CALLED[now]}`}
        aria-label={`Theme: ${CALLED[now]}. Choose another.`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          /*
           * Measured here rather than in an effect once it is open.
           *
           * The menu is portalled to the body, so it has no ancestor to be
           * positioned against and the coordinates have to be taken from the
           * button. Doing that in an effect is a setState synchronously inside
           * one — a cascading render, which the compiler rightly refuses — and
           * the click already knows everything the effect would have measured.
           *
           * Upwards, because this control sits at the very bottom of the
           * sidebar and a list dropped downwards from there is off screen.
           */
          const r = button.current?.getBoundingClientRect();
          if (r) setAt({ x: r.left, y: window.innerHeight - r.top + 6 });
          setOpen((was) => !was);
        }}
        className="text-grey-400 transition-colors hover:text-grey-700"
      >
        <Icon />
      </button>

      {/*
        Portalled, for the reason both context menus are: `fixed` with a high
        `z-index` is only ever high *within* its stacking context, and the
        sidebar sits inside one.
      */}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label="Theme"
              style={{ left: at.x, bottom: at.y }}
              className="fixed z-50 w-[11rem] rounded-sm border border-grey-300 bg-paper py-1 shadow-lg"
            >
              {ORDER.map((theme) => {
                const Mark = ICON[theme];
                return (
                  <button
                    key={theme}
                    type="button"
                    role="menuitem"
                    onClick={() => choose(theme)}
                    className={[
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-grey-150',
                      theme === now ? 'font-medium text-grey-900' : 'text-grey-700',
                    ].join(' ')}
                  >
                    <Mark />
                    <span className="capitalize">{CALLED[theme]}</span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
