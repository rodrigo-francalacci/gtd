'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { formatMoney, type ListItemRow } from '@/lib/queries.shared';

/**
 * Costing a combination before committing to it.
 *
 * The budget could only ever tell you what you had already decided: an item
 * counted towards committed spend once it had been promoted, and promoting is
 * the commitment. So the one question worth asking — *what would these three
 * come to?* — could only be answered by making them real and undoing it, which
 * spawns actions, files them on projects, and leaves a trail through Waiting
 * For. Nobody does that to check a total, so nobody checked.
 *
 * Ticks are deliberately not stored anywhere. This is arithmetic, not a
 * decision: it commits nothing, means nothing tomorrow, and the moment it does
 * mean something there is already a word for that and a column behind it.
 * Putting it in the URL or the database would make an idle sum look like a
 * plan, which is exactly the line the list is built to keep — nothing here is a
 * commitment until it's promoted.
 */
type Trial = {
  picked: ReadonlySet<string>;
  toggle: (id: string) => void;
  clear: () => void;
};

const Context = createContext<Trial | null>(null);

/**
 * Wraps both panes, and renders no DOM of its own.
 *
 * It has to span them because the ticking happens in the list and the total is
 * read in the budget beside it. A context provider emits nothing, so the two
 * panes stay direct children of the pane track — which matters more than it
 * looks: on a phone that track is a swipe carousel and counts its children.
 */
export function BudgetTrialProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());

  const api = useMemo<Trial>(
    () => ({
      picked,
      toggle: (id) =>
        setPicked((prev) => {
          const next = new Set(prev);
          if (!next.delete(id)) next.add(id);
          return next;
        }),
      clear: () => setPicked(new Set()),
    }),
    [picked],
  );

  return <Context.Provider value={api}>{children}</Context.Provider>;
}

/** Null on any list that isn't a budget, which is how the rows stay quiet. */
export function useBudgetTrial(): Trial | null {
  return useContext(Context);
}

/**
 * The tick on a candidate row.
 *
 * Its own control rather than the row's checkbox, because list rows have never
 * had one: a checkbox on a list means "done", and this means "suppose". They
 * would be a bad pair even if the row had room for both.
 */
export function TrialTick({ id }: { id: string }) {
  const trial = useBudgetTrial();
  if (!trial) return null;

  const on = trial.picked.has(id);

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={on ? 'Remove from the trial total' : 'Add to the trial total'}
      title="Count this in the trial total"
      /* The row is draggable and wraps a link; neither should hear about a
         tick. */
      draggable={false}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        trial.toggle(id);
      }}
      className={[
        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] border text-[9px] leading-none',
        on
          ? 'border-selected bg-selected text-paper'
          : 'border-grey-300 text-transparent hover:border-grey-500',
      ].join(' ')}
    >
      ✓
    </button>
  );
}

/**
 * The running total, for the list pane's own subtitle.
 *
 * Beside the ticking rather than only in the budget pane, because selecting an
 * item replaces that pane with the item — and being unable to see the number
 * while looking at one of the things it is made of would send you back and
 * forth to read your own arithmetic.
 */
export function TrialTotal({ items }: { items: ListItemRow[] }) {
  const trial = useBudgetTrial();
  if (!trial || trial.picked.size === 0) return null;

  const total = items
    .filter((i) => trial.picked.has(i.id))
    .reduce((n, i) => n + (i.fields?.cost ?? 0), 0);

  return (
    <>
      {' · '}
      <span className="text-selected">
        {trial.picked.size} ticked, {formatMoney(total)}
      </span>
    </>
  );
}
