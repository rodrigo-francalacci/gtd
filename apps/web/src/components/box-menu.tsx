'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearBoxEmoji, createBoxLabel, emojifyBox } from '@/lib/actions';
import { readAllWaiting } from '@/lib/read-document';

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
  waiting,
  labelName,
  children,
}: {
  boxId: string;
  name: string;
  /** Documents filed but not yet read, which is the count on the entry itself. */
  waiting: number;
  /**
   * What its Gmail label is called, or null when it has none yet.
   *
   * The name rather than a boolean, because once the label exists the only
   * useful thing to say is what to type into Gmail's label menu.
   */
  labelName: string | null;
  children: React.ReactNode;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  /** How many are left to read, while a read is running. */
  const [reading, setReading] = useState<number | null>(null);

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
        /*
         * Capture, not bubble, and that is the whole of the mobile fix.
         *
         * A long press ends in a click, and the row is a Next `Link` whose own
         * handler calls `router.push`. A bubble-phase listener on this wrapper
         * runs *after* that handler — so the navigation had already happened,
         * the pane changed under the menu, and the scroll that came with it
         * closed the menu before a finger could reach it. Nothing was broken
         * about the menu; it was being thrown away a frame after it opened.
         *
         * The capture phase runs ancestor-first, so this gets the click before
         * the link does, and `stopPropagation` means the link never sees it.
         */
        onClickCapture={(event) => {
          if (!consumed.current) return;
          event.preventDefault();
          event.stopPropagation();
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

          {/*
            The two that used to live in the box pane's header.

            A header is for what you are doing *while* you read a box, and
            neither of these is that: reading the queue is a thing you do once
            when something has arrived, and the tag vocabulary is a thing you go
            and edit. Both were taking permanent width from the one header that
            already had the most in it, and both are about the box rather than
            about the view — which is exactly what this menu is for.
          */}
          {waiting > 0 || reading !== null ? (
            <button
              type="button"
              role="menuitem"
              disabled={pending || reading !== null}
              onClick={() => {
                setNote(null);
                setReading(waiting);

                void (async () => {
                  const result = await readAllWaiting((left) => {
                    setReading(left);
                    router.refresh();
                  });

                  setReading(null);
                  router.refresh();
                  setNote(result.ok ? 'Read them.' : result.error);
                })();
              }}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-grey-800 hover:bg-grey-150 disabled:opacity-40"
            >
              {reading !== null
                ? `Reading… ${reading} left`
                : `Read the ${waiting} waiting`}
            </button>
          ) : null}

          <Link
            href={`/box?box=${boxId}`}
            role="menuitem"
            // Navigating away is the end of the menu's business.
            onClick={() => setAt(null)}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-grey-800 hover:bg-grey-150"
          >
            Manage tags
          </Link>

          <div className="my-1 border-t border-grey-200" />

          {/*
            The label you put on a message in Gmail to file it here — and the
            thread is archived once it is filed, so a message you have dealt
            with leaves your inbox.

            Made on request rather than with the box, because a label has no
            "when there is something to put in it" moment: it must exist before
            you can apply it, and pressing this *is* the wanting. Once it
            exists the menu says what it is called, which is the only thing you
            then need to know.
          */}
          {labelName ? (
            <p className="px-3 py-1.5 text-[11px] leading-relaxed text-grey-500">
              Label mail <span className="text-grey-700">{labelName}</span> to file
              it here.
            </p>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const made = await createBoxLabel(boxId);
                  if ('error' in made) throw new Error(made.error);
                }, 'Made it. Put it on a message in Gmail.')
              }
              title="A Gmail label that files messages into this box"
              className="block w-full px-3 py-1.5 text-left text-[12px] text-grey-800 hover:bg-grey-150 disabled:opacity-40"
            >
              {pending ? 'Making…' : 'Make its Gmail label'}
            </button>
          )}

          <div className="my-1 border-t border-grey-200" />

          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={(event) =>
              run(
                () => emojifyBox(boxId, event.altKey || event.shiftKey),
                'Emoji chosen.',
              )
            }
            title="Choose one for anything without an emoji. Hold Alt to redo them all."
            className="block w-full px-3 py-1.5 text-left text-[12px] text-grey-800 hover:bg-grey-150 disabled:opacity-40"
          >
            {pending ? 'Choosing…' : 'Emojify'}
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
