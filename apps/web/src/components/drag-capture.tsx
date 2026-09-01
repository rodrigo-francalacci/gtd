'use client';

import { useTransition, type ReactNode } from 'react';
import {
  copyDocument,
  dropCapture,
  moveDocument,
  type CaptureDrop,
} from '@/lib/actions';
import { DRAG_BOX_ITEM } from './sortable';

/**
 * Its own MIME type, like every other drag in the app.
 *
 * The payload is only readable on `drop`, but `dataTransfer.types` can be read
 * during `dragover` — which is what lets a sidebar entry decide whether to
 * light up before you let go, and lets an action drag pass over it untouched.
 */
export const DRAG_CAPTURE = 'application/x-gtd-capture';

/**
 * An inbox row you can drag somewhere.
 *
 * Processing an inbox is mostly a sequence of small obvious decisions, and the
 * clarify panel makes each one cost a selection, a form and a confirm. Most
 * captures need none of that: you know where it goes the moment you read the
 * line. Dragging it there says so in one gesture, and the outcome is identical
 * to opening the form and pressing confirm without changing anything.
 *
 * A wrapper rather than props on the row, because the inbox draws three
 * densities and two of them are plain links in a Server Component, which
 * cannot carry an event handler. One wrapper keeps the three in step.
 *
 * Desktop only, and by nature rather than by a media query: HTML5 drag and
 * drop does not exist on touch at all. The phone processes an inbox through
 * the panel, which is what it has always done.
 */
export function DragCapture({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_CAPTURE, id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      {children}
    </div>
  );
}

/**
 * A sidebar entry that a capture can be dropped on.
 *
 * The highlight is cleared in the *capture* phase for the reason the buckets
 * are: a drop handled inside stops the bubble, so a bubble-phase handler would
 * never see it and the highlight would stick.
 */
export function CaptureTarget({
  drop,
  children,
}: {
  drop: CaptureDrop;
  children: ReactNode;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div
      onDragOver={(e) => {
        /*
         * A capture, or a box entry being moved to another box. Everything else
         * — an action being filed, a file from the desktop — must go on bubbling
         * to whatever it was aimed at.
         */
        const entry = e.dataTransfer.types.includes(DRAG_BOX_ITEM);
        if (!e.dataTransfer.types.includes(DRAG_CAPTURE) && !entry) return;
        // A box entry can only go to a box.
        if (entry && drop.kind !== 'box') return;

        e.preventDefault();
        /*
         * Ctrl means copy, the convention every file manager uses — which is
         * why it needs no button and no explaining. Setting `dropEffect` is
         * also what changes the cursor, so the choice is visible before you let
         * go rather than discovered afterwards.
         */
        e.dataTransfer.dropEffect = entry && (e.ctrlKey || e.metaKey) ? 'copy' : 'move';
        e.currentTarget.dataset.over = 'yes';
      }}
      onDragLeave={(e) => {
        delete e.currentTarget.dataset.over;
      }}
      onDrop={(e) => {
        const entryId = e.dataTransfer.getData(DRAG_BOX_ITEM);

        if (entryId && drop.kind === 'box') {
          e.preventDefault();
          e.stopPropagation();
          delete e.currentTarget.dataset.over;

          // Read before the transition: the event is pooled and its modifier
          // keys are not readable once this handler has returned.
          const copying = e.ctrlKey || e.metaKey;

          startTransition(async () => {
            if (copying) await copyDocument(entryId, drop.boxId);
            else await moveDocument(entryId, drop.boxId);
          });
          return;
        }

        if (!e.dataTransfer.types.includes(DRAG_CAPTURE)) return;
        e.preventDefault();
        e.stopPropagation();
        delete e.currentTarget.dataset.over;

        const id = e.dataTransfer.getData(DRAG_CAPTURE);
        if (!id) return;

        startTransition(async () => {
          await dropCapture(id, drop);
        });
      }}
      className={[
        'data-[over=yes]:bg-selected-bg data-[over=yes]:ring-1',
        'data-[over=yes]:ring-inset data-[over=yes]:ring-selected',
        pending ? 'opacity-60' : '',
      ].join(' ')}
    >
      {children}
    </div>
  );
}
