'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

/**
 * Rename and delete, on the row itself.
 *
 * Right-click on a desktop, press and hold on a touchscreen — the same pair of
 * gestures the box entries in the sidebar already use, and for the same reason:
 * they mean "what can I do with this" everywhere else on the machine, so the
 * actions they reveal cost no space at all. A rename button on every row of
 * every list would be five hundred buttons to save five clicks.
 *
 * Renaming happens *in the menu* rather than by turning the row into a field.
 * A row is a link, and making it conditionally editable means every list has two
 * states and a way to get stuck between them; a small field in a popover has one
 * state and cannot be got wrong. Enter commits, Escape abandons.
 *
 * Deleting asks first, in the same menu, because none of these are undoable and
 * a menu item next to "Rename" is very easy to hit by accident.
 */
export function RowMenu({
  name,
  onRename,
  onDelete,
  deleteLabel = 'Delete',
  /** What deleting will actually do, when it is worth saying. */
  deleteNote,
  extra,
  className,
  children,
}: {
  /** What it is called now, which is what the field starts with. */
  name: string;
  /** Absent when this row cannot be renamed — a raw capture, say. */
  onRename?: (next: string) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  deleteLabel?: string;
  deleteNote?: string;
  /**
   * Anything else this row can do, above Rename.
   *
   * The reason this exists is touch. On a desktop an attachment's actions live
   * on the row and appear on hover; a finger has no hover, so every one of them
   * was unreachable on a phone — you could open a file and nothing else. The
   * menu already is the touch answer for a list row, so it is the touch answer
   * here too, and a row's less common verbs go in it rather than growing a
   * second menu of their own.
   */
  extra?: { label: string; run: () => Promise<unknown> | void }[];
  /**
   * Classes for the wrapper. It is a real element in the layout — an attachment
   * row makes it the flex row itself — so the caller has to be able to say what
   * shape it is.
   */
  className?: string;
  children: React.ReactNode;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [pending, startTransition] = useTransition();

  /**
   * The menu itself, so a press inside it can be told from a press outside.
   *
   * This is the whole of the fix, and `stopPropagation` on the menu could never
   * have been: the "click away" listener is registered on `document` in the
   * **capture** phase, and React attaches component handlers at its root
   * container — which is a descendant of `document`. So the close ran first, on
   * every press, including presses on the menu's own buttons. The menu unmounted
   * between pointerdown and pointerup, no click ever reached a button, and both
   * Rename and Delete looked like they simply did nothing.
   *
   * A containment test does not care what order anything fires in.
   */
  const menu = useRef<HTMLDivElement>(null);

  const held = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Set by a long press only — the one gesture the browser turns into a click
   * afterwards, which would otherwise follow the row's link the moment the menu
   * opened. A right-click produces no click and must not set it.
   */
  const consumed = useRef(false);

  const cancel = () => {
    if (held.current) clearTimeout(held.current);
    held.current = null;
  };

  const open = (x: number, y: number) => {
    setDraft(name);
    setRenaming(false);
    setConfirming(false);
    setAt({
      x: Math.min(x, window.innerWidth - 210),
      y: Math.min(y, window.innerHeight - 150),
    });
  };

  const shut = () => {
    setAt(null);
    setRenaming(false);
    setConfirming(false);
  };

  useEffect(() => {
    if (!at) return;

    const away = (event: Event) => {
      if (menu.current?.contains(event.target as Node)) return;
      shut();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') shut();
    };

    // Next tick and in capture, or the very press that opened this closes it.
    const id = setTimeout(() => {
      document.addEventListener('pointerdown', away, true);
      window.addEventListener('scroll', away, true);
      window.addEventListener('resize', away);
      document.addEventListener('keydown', key);
    }, 0);

    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
      document.removeEventListener('keydown', key);
    };
  }, [at]);

  if (!onRename && !onDelete) return <>{children}</>;

  return (
    <>
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          open(event.clientX, event.clientY);
        }}
        /*
         * Touch only. A mouse has the right-click already, and a 500ms timer on
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
        // A finger that has drifted was scrolling the list, not holding.
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
        /* iOS shows its own callout on a long press and never fires
           `contextmenu`, so ours would open underneath the system one. */
        className={['[-webkit-touch-callout:none]', className ?? ''].join(' ')}
      >
        {children}
      </div>

      {at ? (
        <div
          role="menu"
          aria-label={name}
          ref={menu}
          style={{ left: at.x, top: at.y }}
          className="fixed z-50 w-[13rem] rounded-sm border border-grey-300 bg-paper py-1 shadow-lg"
        >
          <p className="truncate px-3 pb-1 text-[10px] uppercase tracking-wider text-grey-400">
            {name}
          </p>

          {extra?.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await item.run();
                  shut();
                })
              }
              className="block w-full px-3 py-1.5 text-left text-[12px] text-grey-800 hover:bg-grey-150 disabled:opacity-40"
            >
              {item.label}
            </button>
          ))}

          {renaming && onRename ? (
            <form
              className="flex items-center gap-1 px-2 py-1"
              onSubmit={(event) => {
                event.preventDefault();
                const next = draft.trim();
                if (!next || next === name) {
                  shut();
                  return;
                }
                startTransition(async () => {
                  await onRename(next);
                  shut();
                });
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                autoFocus
                aria-label="New name"
                /* 16px, or iOS Safari zooms the page in when it takes focus. */
                className="min-w-0 flex-1 rounded-sm border border-grey-300 bg-paper px-1.5 py-1 text-[16px] text-grey-800 focus:border-selected focus:outline-none md:text-[12px]"
              />
              <button
                type="submit"
                disabled={pending}
                className="shrink-0 rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-40"
              >
                Save
              </button>
            </form>
          ) : onRename ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => setRenaming(true)}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-grey-800 hover:bg-grey-150"
            >
              Rename…
            </button>
          ) : null}

          {onDelete ? (
            confirming ? (
              <div className="px-3 py-1.5">
                {deleteNote ? (
                  <p className="mb-1 text-[11px] leading-relaxed text-grey-500">
                    {deleteNote}
                  </p>
                ) : null}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await onDelete();
                        shut();
                      })
                    }
                    className="rounded-sm bg-stale px-2 py-0.5 text-[11px] text-paper disabled:opacity-40"
                  >
                    {pending ? 'Working…' : 'Yes, ' + deleteLabel.toLowerCase()}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="text-[11px] text-grey-500 underline underline-offset-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirming(true)}
                className="block w-full px-3 py-1.5 text-left text-[12px] text-stale hover:bg-stale-bg"
              >
                {deleteLabel}…
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </>
  );
}
