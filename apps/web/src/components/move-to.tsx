'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { IconMove } from './icons';

/**
 * Moving something without dragging it.
 *
 * Every "move" in this app was a drag: an action onto a project to file it, a
 * project across a heading to restage it, an action between Active and Future.
 * HTML5 drag-and-drop has no touch support at all — not a degraded version, no
 * version — so on a phone those operations simply did not exist, and the app
 * was read-only in the places where it does its actual filing.
 *
 * This is the same operations behind an explicit control. It calls the very
 * same Server Actions the drags call, so there is one definition of what
 * filing an action means and this is a second way to ask for it, not a second
 * implementation of it.
 *
 * Shown on every screen rather than only on small ones. A menu is the better
 * interface for "move this to one of forty projects" even with a mouse —
 * dragging a row to a target that may be scrolled out of sight is precise work
 * for something you know the name of — and a control that appears only below
 * some width is one nobody learns is there.
 */
export function MoveTo({
  label,
  options,
  current,
  onMove,
}: {
  /** What the menu is for: "Move to project", "Change status". */
  label: string;
  options: { id: string | null; name: string; hint?: string }[];
  /** Marked as where it is now, and not offered as a destination. */
  current: string | null;
  onMove: (id: string | null) => Promise<unknown>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (id: string | null) => {
    setOpen(false);
    startTransition(async () => {
      await onMove(id);
      router.refresh();
    });
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        className={[
          'flex min-h-11 items-center gap-1 rounded-sm px-1 text-[11px] md:min-h-0',
          pending ? 'opacity-50' : '',
          open ? 'text-grey-800' : 'text-grey-500 hover:text-grey-800',
        ].join(' ')}
      >
        <IconMove />
        <span>{label}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 max-h-72 w-60 overflow-y-auto rounded-sm border border-grey-200 bg-paper py-1 shadow-lg"
        >
          {options.map((option) => {
            const here = option.id === current;

            return (
              <button
                key={option.id ?? 'none'}
                type="button"
                role="menuitem"
                // Where it already is is shown rather than hidden — a list that
                // silently omits the current answer makes you work out what it
                // left out to know where you are.
                disabled={here}
                onClick={() => choose(option.id)}
                className={[
                  'flex min-h-11 w-full flex-col justify-center px-3 py-1.5 text-left md:min-h-0',
                  here
                    ? 'cursor-default bg-grey-100 text-grey-500'
                    : 'text-grey-700 hover:bg-grey-100',
                ].join(' ')}
              >
                <span className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="min-w-0 truncate">{option.name}</span>
                  {here ? (
                    <span className="shrink-0 text-[10px] uppercase tracking-wider">
                      here
                    </span>
                  ) : null}
                </span>
                {option.hint ? (
                  <span className="text-[11px] text-grey-400">{option.hint}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
