'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { clearBoxEmoji, emojifyBox } from '@/lib/actions';

/**
 * The things you do *to* a box, from the box's own entry in the sidebar.
 *
 * Right-click on a desktop, press and hold on a touchscreen — the two gestures
 * that already mean "tell me about this thing" everywhere else on the machine,
 * which is why neither needs a control of its own taking up room.
 *
 * That is the point. Choosing emoji is a thing you do to a box roughly once,
 * and it was living in the box pane's header beside the pending count, the
 * gallery switch and the tag link — four controls in the one header that
 * already had the most in it. A rare action does not deserve permanent space,
 * and a header that wraps is worse than a menu you have to know about.
 *
 * It marks *every* document in the box rather than what happens to be on
 * screen, which is the opposite of what the list button does and is right for
 * the same reason: here you have named a box, not a view of one.
 */
export function BoxMenu({
  boxId,
  name,
  children,
}: {
  boxId: string;
  name: string;
  children: React.ReactNode;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const held = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Set by a long press only — the one gesture the browser turns into a click
   * afterwards, which would otherwise navigate to the box the moment the menu
   * opened. A right-click produces no click and must not set it, or the flag
   * would still be standing at the next ordinary press.
   */
  const consumed = useRef(false);

  const cancel = () => {
    if (held.current) clearTimeout(held.current);
    held.current = null;
  };

  const open = (x: number, y: number) => {
    setNote(null);
    // Clamped so a box near the bottom of a long sidebar does not open its menu
    // off the end of the window.
    setAt({ x: Math.min(x, window.innerWidth - 190), y: Math.min(y, window.innerHeight - 110) });
  };

  useEffect(() => {
    if (!at) return;

    const shut = () => setAt(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAt(null);
    };

    /*
     * Capture, and on the next tick. Listening in the bubble phase would catch
     * the very click that opened this and close it again immediately; the
     * timeout is what lets that click finish first.
     */
    const id = setTimeout(() => {
      document.addEventListener('pointerdown', shut, true);
      window.addEventListener('resize', shut);
      // A menu positioned in viewport coordinates is wrong the moment anything
      // scrolls, so it closes rather than following.
      window.addEventListener('scroll', shut, true);
      document.addEventListener('keydown', key);
    }, 0);

    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', shut, true);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', shut, true);
      document.removeEventListener('keydown', key);
    };
  }, [at]);

  const run = (job: () => Promise<unknown>, done: string) => {
    startTransition(async () => {
      const result = (await job()) as { ok?: boolean; error?: string } | undefined;
      setNote(result && result.ok === false ? (result.error ?? 'That did not work.') : done);
      // Left open, showing what happened. A menu that vanished on the click
      // would take the only report of a failure with it.
    });
  };

  return (
    <>
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          open(event.clientX, event.clientY);
        }}
        /*
         * Touch only. A mouse already has the right-click, and a 500ms timer on
         * every mouse press would turn a slow click — which is most clicks —
         * into a menu instead of a navigation.
         */
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse') return;
          consumed.current = false;
          const { clientX, clientY } = event;
          held.current = setTimeout(() => {
            consumed.current = true;
            open(clientX, clientY);
          }, 500);
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        // A finger that has drifted was scrolling the sidebar, not holding.
        onPointerMove={cancel}
        onClick={(event) => {
          if (!consumed.current) return;
          event.preventDefault();
          consumed.current = false;
        }}
        /*
         * iOS shows its own callout on a long press and never fires
         * `contextmenu`, so the hold above would open our menu underneath the
         * system one. This is what stops that.
         */
        className="[-webkit-touch-callout:none]"
      >
        {children}
      </div>

      {at ? (
        <div
          role="menu"
          aria-label={name}
          style={{ left: at.x, top: at.y }}
          className="fixed z-50 w-[11rem] rounded-sm border border-grey-300 bg-paper py-1 shadow-lg"
          // The menu is inside the closing listener's world, so a click on it
          // must not reach the document handler that shuts it.
          onPointerDown={(event) => event.stopPropagation()}
        >
          <p className="truncate px-3 pb-1 text-[10px] uppercase tracking-wider text-grey-400">
            {name}
          </p>

          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={() => run(() => emojifyBox(boxId), 'Emoji chosen.')}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-grey-800 hover:bg-grey-150 disabled:opacity-40"
          >
            {pending ? 'Choosing…' : 'Redo emoji'}
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={() => run(async () => clearBoxEmoji(boxId), 'Emoji cleared.')}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-grey-800 hover:bg-grey-150 disabled:opacity-40"
          >
            Clear emoji
          </button>

          {note ? (
            <p className="border-t border-grey-200 px-3 pt-1.5 text-[11px] text-grey-500">
              {note}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
