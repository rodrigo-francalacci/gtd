'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

/**
 * Arrow keys move down a list; Delete removes what is selected.
 *
 * Clicking a row and then reaching for the mouse again to click the next one is
 * the motion you make most in this app — down the inbox, down a box, down the
 * actions you might do now. The rows are already addressed by the URL, so
 * moving the selection is a navigation and nothing here has to know what a row
 * *is*: a page hands over its ids in the order it drew them, paired with the
 * href each one opens at, and this walks that list.
 *
 * **Order comes from the page, never from the DOM.** Reading the rendered rows
 * would be a second source of truth that a filter, a grouping or a re-sort
 * could put out of step — and on a box, where changing an entry's date moves it
 * in the list, the two would disagree the moment you edited anything.
 */
export type KeyRow = { id: string; href: string };

export function ListKeys({
  rows,
  selectedId,
  onDelete,
  deleteLabel = 'Delete',
  deleteNote,
}: {
  rows: KeyRow[];
  selectedId: string | null;
  /**
   * What Delete does, when the list has an answer. Absent where a row cannot be
   * deleted from its list — a project's archive, say.
   */
  onDelete?: (id: string) => Promise<unknown>;
  deleteLabel?: string;
  deleteNote?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /**
   * The row Delete has been pressed on, waiting for Enter.
   *
   * A single keystroke that destroys something is not a shortcut, it is a
   * hazard — the key sits next to Backspace and this app has no undo. Two
   * keystrokes is still faster than any mouse route and is the difference
   * between quick and irreversible.
   */
  const [armed, setArmed] = useState<string | null>(null);

  /*
   * The confirmation is about one row, so it cannot outlive the selection
   * moving off it — *derived* rather than cleared in an effect, which would be
   * a second render every time you pressed an arrow, and which the compiler
   * refuses for that reason. An armed id that is no longer selected is simply
   * not shown, and the next arrow press overwrites it.
   */
  const confirming = armed === selectedId ? armed : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Modified presses belong to the browser and the operating system.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target as HTMLElement | null)) return;

      if (event.key === 'Escape' && confirming) {
        setArmed(null);
        return;
      }

      if (event.key === 'Enter' && confirming && onDelete) {
        event.preventDefault();
        const id = confirming;

        /*
         * Where to go once it is gone. Worked out *before* the delete, while
         * the row is still in the list — afterwards its neighbours are all this
         * component knows, and it would have to guess. The next row down, or
         * the one above when the last row goes.
         */
        const at = rows.findIndex((row) => row.id === id);
        const after = rows[at + 1] ?? rows[at - 1] ?? null;

        startTransition(async () => {
          await onDelete(id);
          setArmed(null);
          router.push(after ? after.href : stripSelection(rows, id));
        });
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!onDelete || !selectedId) return;
        // Backspace is the browser's "back" on some setups and a typo
        // everywhere else, so it only ever *arms* — never confirms.
        event.preventDefault();
        setArmed(selectedId);
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if (rows.length === 0) return;

      event.preventDefault();

      const at = rows.findIndex((row) => row.id === selectedId);

      /*
       * Nothing selected: the first row on the way down, the last on the way
       * up, which is what every list in every other program does.
       *
       * Deliberately no wrapping. In a list of two hundred, arriving at the
       * bottom and being thrown to the top loses your place with no way to get
       * it back — stopping at the end says "that is the end" and costs nothing.
       */
      const next =
        at === -1
          ? event.key === 'ArrowDown'
            ? 0
            : rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)));

      if (next === at) return;

      /*
       * `scroll: false` because the pane, not the window, is what scrolls here
       * — and the row being navigated to brings itself into view below. Letting
       * the router scroll as well fights that and lands somewhere between.
       */
      router.push(rows[next].href, { scroll: false });
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [rows, selectedId, confirming, onDelete, router]);

  /*
   * Keep the selected row in view as the selection walks past the fold.
   *
   * Found by the href the page gave us rather than by a marker attribute, so
   * no row component has to learn about this — and the thing matched is by
   * definition the anchor that opens the selected row, whatever draws it.
   */
  useEffect(() => {
    if (!selectedId) return;

    const href = rows.find((row) => row.id === selectedId)?.href;
    if (!href) return;

    const anchor = [...document.querySelectorAll('a')].find(
      (a) => a.getAttribute('href') === href,
    );

    // `nearest` so a row already on screen is left exactly where it is; only
    // one that has gone past an edge moves, and only far enough.
    anchor?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, rows]);

  if (!confirming) return null;

  const row = rows.find((r) => r.id === confirming);
  if (!row) return null;

  return (
    <div
      role="alertdialog"
      aria-label={`${deleteLabel}?`}
      className="sticky top-0 z-30 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-stale bg-stale-bg px-4 py-2 text-[12px] text-stale"
    >
      <span className="font-medium">{deleteLabel}?</span>
      {deleteNote ? <span className="text-[11px] opacity-80">{deleteNote}</span> : null}
      <span className="text-[11px] opacity-80">
        {pending ? 'Working…' : 'Enter to confirm · Esc to cancel'}
      </span>
    </div>
  );
}

/** The same page with nothing selected, for when the last row has gone. */
function stripSelection(rows: KeyRow[], id: string): string {
  const href = rows.find((row) => row.id === id)?.href ?? '/';
  const url = new URL(href, 'http://x');

  for (const [key, value] of [...url.searchParams.entries()]) {
    if (value === id) url.searchParams.delete(key);
  }

  return `${url.pathname}${url.search}`;
}

function isTyping(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
