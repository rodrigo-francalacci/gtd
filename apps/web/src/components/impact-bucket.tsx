'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { updateListItemFields } from '@/lib/actions';
import type { PurchaseImpact } from '@/lib/queries.shared';
import { DRAG_LIST_ITEM } from './sortable-list-items';
import { reallyLeft } from './sortable';

/**
 * One impact, as a place you can drop something.
 *
 * A purchases list answers "what shall I buy" badly when it is one column: the
 * thing holding a project up and the thing you fancy sit side by side, ordered
 * by whenever you happened to write them down. Cut into what each purchase
 * *does*, the same list answers the question directly — and the totals under
 * each heading say what answering it would cost.
 *
 * Modelled on `ActionBucket` and the project buckets rather than on a sort:
 * these are places, not an order. **Rendered even when empty**, for the reason
 * the project statuses are — an empty group you cannot see is an empty group
 * you cannot drop into, and the first thing you do with a new list is put
 * things in it. That now includes the undecided bucket, which became a real
 * place the moment you could drag something back into it.
 *
 * The drag is the existing list-item drag, so reordering within a bucket and
 * moving between buckets are one gesture. `SortableList` ignores drops of rows
 * it does not contain without preventing the default, which is what lets this
 * see them at all — the same arrangement the action and project buckets rely
 * on.
 */
export function ImpactBucket({
  impact,
  title,
  hint,
  count,
  total,
  children,
  variant = 'row',
}: {
  /** Null is the bucket for purchases nobody has decided about yet. */
  impact: PurchaseImpact | null;
  title: string;
  hint: string;
  count: number;
  /** What this bucket comes to, already formatted, or null when nothing has a price. */
  total: string | null;
  children: ReactNode;
  /**
   * `row` stacks down the list pane; `column` is one lane of the board.
   *
   * The same drop target either way — which is the whole reason this is a
   * variant rather than a second component. A board that reimplemented the drop
   * would be two places to fix the `dragleave` trap the comment below describes,
   * and one of them would be missed.
   */
  variant?: 'row' | 'column';
}) {
  const [over, setOver] = useState(false);
  const [pending, startTransition] = useTransition();

  /*
   * The undecided bucket takes drops too, and refusing them was wrong.
   *
   * It was read-only on the argument that it is a backlog rather than a
   * category — somewhere things start, not somewhere you put them. But changing
   * your mind is the ordinary case here: you called something "nice to have" in
   * October and by January you are not sure any more, and the honest answer is
   * *undecided*, not a third guess. Refusing the drop meant the only way back
   * was the pane's own control, which is the long way round in the one view
   * built for exactly this gesture.
   *
   * `updateListItemFields` already cleared the field when handed `undefined`,
   * so nothing about the write had to change — only the target had to stop
   * saying no.
   */
  const accepts = (event: React.DragEvent) =>
    event.dataTransfer.types.includes(DRAG_LIST_ITEM);

  return (
    <section
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      /*
       * Cleared in the capture phase, because a reorder handled by the list
       * inside this bucket stops the event bubbling — so a handler on the way
       * up would never see the drop, and the highlight would stay on for ever.
       * The same trap the action bucket documents.
       */
      onDropCapture={() => setOver(false)}
      onDragLeave={(event) => {
        if (reallyLeft(event)) setOver(false);
      }}
      onDrop={(event) => {
        if (!accepts(event)) return;

        const id = event.dataTransfer.getData(DRAG_LIST_ITEM);
        if (!id) return;

        event.preventDefault();
        setOver(false);

        startTransition(async () => {
          await updateListItemFields(id, { impact: impact ?? undefined });
        });
      }}
      className={[
        'rounded-sm border',
        variant === 'column'
          // A lane is a column of its own height with its own scrollbar: four
          // lanes sharing the page's scroll would mean scrolling past the ones
          // you are not looking at to reach the bottom of the one you are.
          ? 'flex min-h-0 min-w-0 flex-col'
          : 'mt-2',
        over ? 'border-selected ring-1 ring-inset ring-selected' : 'border-grey-200',
        pending ? 'opacity-60' : '',
      ].join(' ')}
    >
      <header className="flex shrink-0 items-baseline justify-between gap-2 border-b border-grey-200 bg-grey-50 px-3 py-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-grey-600">
          {title}
          <span className="ml-1.5 tabular-nums text-grey-400">{count}</span>
        </h3>

        {/*
          The total is the point of grouping this way: "nice to have" is a
          different sentence when it comes to nine hundred pounds. Shown only
          when something in the bucket has a price — a total of zero across
          six unpriced items would be a lie with a number on it.
        */}
        <span className="text-[11px] tabular-nums text-grey-500">
          {total ?? hint}
        </span>
      </header>

      {variant === 'column' ? (
        // `overflow-y-auto` needs `min-h-0` above it in a flex column, or the
        // lane grows to its content and the whole board scrolls instead.
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-clip">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}
