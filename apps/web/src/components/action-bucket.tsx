'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { setActionStatus } from '@/lib/actions';
import { DRAG_ACTION, dragPayload, hasDragType, reallyLeft } from './sortable';

/**
 * A drop zone that moves an action into a given status.
 *
 * Sits around a `SortableList`, which handles reordering within itself and
 * deliberately ignores drops of actions it doesn't contain — those bubble up
 * to here, which is how an action crosses from Active to Future.
 */
export function ActionBucket({
  status,
  title,
  hint,
  count,
  children,
}: {
  status: 'next' | 'future';
  title: string;
  hint: string;
  count: number;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <section
      onDragOver={(e) => {
        if (!hasDragType(e, DRAG_ACTION)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (reallyLeft(e)) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasDragType(e, DRAG_ACTION)) return;
        e.preventDefault();
        setOver(false);

        const actionId = dragPayload(e, DRAG_ACTION);
        if (!actionId) return;

        startTransition(async () => void setActionStatus(actionId, status));
      }}
      className={[
        'rounded-sm border',
        over ? 'border-selected ring-1 ring-inset ring-selected' : 'border-grey-200',
        pending ? 'opacity-60' : '',
      ].join(' ')}
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-grey-200 bg-grey-50 px-3 py-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-grey-600">
          {title}
          <span className="ml-1.5 tabular-nums text-grey-400">{count}</span>
        </h3>
        <span className="text-[11px] text-grey-400">{hint}</span>
      </header>

      {children}
    </section>
  );
}
