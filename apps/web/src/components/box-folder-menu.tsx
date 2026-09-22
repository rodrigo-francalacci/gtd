'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createBoxFolder } from '@/lib/actions';
import type { BoxFolderRow } from '@/lib/queries.shared';

/**
 * The box's name in pane two, which is also the way into its folders.
 *
 * **The heading is the control.** A box has one name at the top of the list and
 * a folder is a narrowing of that list, so "Feed / Receipts" is the honest
 * thing to write there — and the thing you would click to change it is the
 * words themselves. A separate control would be a fourth button in the one
 * pane header that already carries the most.
 *
 * **Leaving is an item in the same menu**, rather than a × beside the
 * breadcrumb: going back to the whole box is the same kind of choice as going
 * into another drawer, and one list of places is easier than a control that
 * appears only while you are somewhere.
 *
 * **Every link keeps the rest of the query.** A folder narrows *with* the tags,
 * the types and the date range rather than instead of them, so the href is
 * built from the current parameters with `folder` swapped — the rule the filter
 * chips follow, for the same reason: the filter you were not touching must not
 * vanish because you touched another one.
 */
export function BoxFolderMenu({
  boxId,
  boxName,
  folders,
  folderId,
}: {
  boxId: string;
  boxName: string;
  folders: BoxFolderRow[];
  /** The folder being looked at, or null for the whole box. */
  folderId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ x: 0, y: 0 });
  const [naming, setNaming] = useState(false);
  const [, startTransition] = useTransition();

  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  /*
   * Closed by containment, never by `stopPropagation` — React attaches its
   * handlers at the root, which is a descendant of `document`, so a
   * capture-phase listener here always runs first and the menu would unmount
   * between pointerdown and pointerup on its own buttons.
   */
  useEffect(() => {
    if (!open) return;

    const away = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menu.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
      setNaming(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setNaming(false);
      }
    };

    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const here = folders.find((folder) => folder.id === folderId) ?? null;

  /** The same query, with `folder` set to one place or taken off entirely. */
  const hrefFor = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set('folder', id);
    else next.delete('folder');
    // A folder is a different set of rows, so a document chosen in the old one
    // would be a pane showing something the list no longer holds.
    next.delete('doc');
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const make = (name: string) => {
    const wanted = name.trim();
    if (!wanted) return;
    startTransition(async () => {
      const id = await createBoxFolder(boxId, wanted);
      setNaming(false);
      setOpen(false);
      // Straight into it: making a drawer is nearly always the first half of
      // putting something in it.
      if (id) router.push(hrefFor(id));
    });
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={here ? `In ${here.name} — choose another folder` : 'Choose a folder'}
        onClick={() => {
          // Measured from the click rather than in an effect once open: that
          // would be a setState inside an effect, which the compiler refuses,
          // for something the click already knows.
          const box = button.current?.getBoundingClientRect();
          if (box) setAt({ x: box.left, y: box.bottom + 4 });
          setOpen((was) => !was);
        }}
        className="flex min-w-0 items-baseline gap-1 truncate hover:text-grey-900"
      >
        <span className="truncate">{boxName}</span>
        {here ? (
          <>
            <span className="text-grey-400">/</span>
            <span className="truncate text-selected">{here.name}</span>
          </>
        ) : null}
        <span aria-hidden className="text-[9px] text-grey-400">
          ▾
        </span>
      </button>

      {open
        ? createPortal(
            /* Portalled to the body, because a pane is a stacking context and
               a menu overhanging its edge would be painted under pane three. */
            <div
              ref={menu}
              role="menu"
              style={{ left: at.x, top: at.y }}
              className="fixed z-50 max-h-[70vh] w-60 overflow-y-auto border border-grey-300 bg-paper py-1 shadow-lg"
            >
              <Link
                href={hrefFor(null)}
                onClick={() => setOpen(false)}
                className={[
                  'flex items-baseline justify-between gap-2 px-3 py-1.5 text-[12px] hover:bg-grey-100',
                  folderId === null ? 'font-medium text-selected' : 'text-grey-800',
                ].join(' ')}
              >
                <span className="truncate">All of {boxName}</span>
                <span className="shrink-0 text-[10px] text-grey-400">
                  {folderId === null ? 'here' : 'leave'}
                </span>
              </Link>

              {folders.length > 0 ? (
                <div className="my-1 border-t border-grey-200" />
              ) : null}

              {folders.map((folder) => (
                <Link
                  key={folder.id}
                  href={hrefFor(folder.id)}
                  onClick={() => setOpen(false)}
                  className={[
                    'flex items-baseline justify-between gap-2 px-3 py-1.5 text-[12px] hover:bg-grey-100',
                    folder.id === folderId ? 'font-medium text-selected' : 'text-grey-800',
                  ].join(' ')}
                >
                  <span className="truncate">{folder.name}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-grey-400">
                    {folder.count}
                  </span>
                </Link>
              ))}

              <div className="my-1 border-t border-grey-200" />

              {naming ? (
                <form
                  className="px-3 py-1.5"
                  action={(formData) => make(String(formData.get('name') ?? ''))}
                >
                  <input
                    name="name"
                    autoFocus
                    placeholder="New folder…"
                    autoComplete="off"
                    className="w-full border-b border-grey-300 bg-transparent pb-0.5 text-[12px] focus:border-grey-500 focus:outline-none"
                  />
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setNaming(true)}
                  className="w-full px-3 py-1.5 text-left text-[12px] text-grey-600 hover:bg-grey-100"
                >
                  New folder…
                </button>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
