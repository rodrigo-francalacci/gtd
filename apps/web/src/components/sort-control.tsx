'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { setViewSort } from '@/lib/actions';
import {
  DIRECTION_LABELS,
  SORT_KEYS,
  SORT_LABELS,
  canGroup,
  naturalDirection,
  type SortChoice,
} from '@/lib/sort';
import { IconGroup, IconSort } from './icons';

/**
 * How a pane's file list is ordered.
 *
 * A menu rather than a row of buttons: this is a choice of key, plus a
 * direction, plus whether to cut it into groups — three questions, and seven
 * buttons crammed beside a section heading in a detail pane would be a control
 * panel where there is currently a label.
 *
 * The button says what the list is doing right now, so the answer is visible
 * without opening anything. That matters more here than for the density
 * toggle, which you can see by looking at the rows: "sorted by how often I
 * open it, most first" is not something a list *looks* like.
 */
export function SortControl({
  viewKey,
  choice,
}: {
  viewKey: string;
  choice: SortChoice;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);

  // Click-away and Escape. A menu you can only close by choosing something is
  // a menu that makes you change a setting to get out of it.
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

  const commit = (next: SortChoice) => {
    startTransition(() => void setViewSort(viewKey, next));
  };

  const direction = DIRECTION_LABELS[choice.sort];
  const groupable = canGroup(choice.sort);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="How this list is ordered"
        aria-haspopup="menu"
        aria-expanded={open}
        className={[
          'flex items-center gap-1 rounded-sm px-1 text-[11px]',
          pending ? 'opacity-50' : '',
          open ? 'text-grey-800' : 'text-grey-500 hover:text-grey-800',
        ].join(' ')}
      >
        <IconSort />
        <span>{choice.descending ? direction.desc : direction.asc}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-44 rounded-sm border border-grey-200 bg-paper py-1 shadow-lg"
        >
          {SORT_KEYS.map((key) => {
            const on = choice.sort === key;
            return (
              <button
                key={key}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() =>
                  commit({
                    sort: key,
                    // Picking the sort you are already on flips it, which is
                    // what clicking the current column header does everywhere
                    // else. Picking a new one starts it the way round it reads
                    // best — "by use" showing the files you have never opened
                    // would be a menu item doing the opposite of its name.
                    descending: on ? !choice.descending : naturalDirection(key),
                    grouped: choice.grouped && canGroup(key),
                  })
                }
                className={[
                  'flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-grey-100',
                  on ? 'font-medium text-grey-900' : 'text-grey-700',
                ].join(' ')}
              >
                <span>{SORT_LABELS[key]}</span>
                {on ? (
                  <span className="text-[10px] font-normal text-grey-500">
                    {choice.descending
                      ? DIRECTION_LABELS[key].desc
                      : DIRECTION_LABELS[key].asc}
                  </span>
                ) : null}
              </button>
            );
          })}

          {/* Only where it would do something. Days for arrival, first letters
              for A–Z; a usage count groups into "3" and "2" and "1", which is a
              heading repeating the row beside it. */}
          {groupable ? (
            <>
              <div className="my-1 border-t border-grey-200" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={choice.grouped}
                onClick={() => commit({ ...choice, grouped: !choice.grouped })}
                className={[
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-grey-100',
                  choice.grouped ? 'font-medium text-grey-900' : 'text-grey-700',
                ].join(' ')}
              >
                <IconGroup />
                <span>
                  {choice.sort === 'arrival' ? 'Group by day' : 'Group by letter'}
                </span>
                {choice.grouped ? (
                  <span className="ml-auto text-[10px] font-normal text-grey-500">on</span>
                ) : null}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
