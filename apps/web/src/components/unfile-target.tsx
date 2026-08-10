'use client';

import { useState, useTransition } from 'react';
import { moveActionToProject } from '@/lib/actions';
import { DRAG_ACTION, dragPayload, hasDragType } from './sortable';

/** Drop zone that detaches an action from its project. */
export function UnfileTarget() {
  const [over, setOver] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div
      onDragOver={(e) => {
        if (!hasDragType(e, DRAG_ACTION)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!hasDragType(e, DRAG_ACTION)) return;
        e.preventDefault();
        setOver(false);
        const actionId = dragPayload(e, DRAG_ACTION);
        if (!actionId) return;
        startTransition(async () => {
          await moveActionToProject(actionId, null);
        });
      }}
      className={[
        'border-b border-dashed border-grey-300 px-4 py-2 text-[11px]',
        over ? 'bg-selected-bg text-selected' : 'text-grey-400',
        pending ? 'opacity-50' : '',
      ].join(' ')}
    >
      Drop here to remove an action from its project
    </div>
  );
}
