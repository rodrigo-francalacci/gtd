'use client';

import { useTransition, type ReactNode } from 'react';
import {
  copyDocument,
  dropCapture,
  moveActionToList,
  moveDocument,
  promoteListItem,
  type CaptureDrop,
} from '@/lib/actions';
import { DRAG_ACTION, DRAG_BOX_ITEM } from './sortable';
import { DRAG_LIST_ITEM } from './sortable-list-items';

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
 * A sidebar entry something can be dropped on.
 *
 * Four drags land here now, and they are four different sentences:
 *
 * - a **capture** on anything, which clarifies it;
 * - a **box entry** on a box, which moves it (ctrl copies);
 * - a **list item** on *What can I do now*, which promotes it — the candidate
 *   becomes a commitment, the verb the list has always had as a button;
 * - an **action** on a list, which is that read backwards.
 *
 * The last two are the pair that used to be refused, and the refusal was
 * principled rather than accidental: nothing on a list is a commitment until
 * promoted, so a list item and an action are not two views of one row. What was
 * wrong is that the *decision* only went one way, and the way back — this is a
 * want, not a next action — had to be done by deleting and retyping.
 *
 * A sidebar entry is the right target because the two rows live in different
 * route segments and never share a screen: dragging onto the column that is
 * always there is the only gesture that can reach from one to the other, and it
 * is the one moving an entry between boxes already uses.
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
         * Everything this entry will not take must go on *bubbling* — a file
         * dragged from the desktop, an action being reordered over the sidebar
         * on its way somewhere else. Refusing means simply not calling
         * `preventDefault`, which is the same rule `SortableList` follows for a
         * row it does not contain.
         */
        const types = e.dataTransfer.types;
        const entry = types.includes(DRAG_BOX_ITEM);
        const action = types.includes(DRAG_ACTION);
        const listItem = types.includes(DRAG_LIST_ITEM);

        if (!types.includes(DRAG_CAPTURE) && !entry && !action && !listItem) return;

        // A box entry can only go to a box; an action only onto a list; a list
        // item only onto Now, which is the one place a commitment can begin.
        if (entry && drop.kind !== 'box') return;
        if (action && drop.kind !== 'list') return;
        if (listItem && drop.kind !== 'now') return;

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
        /*
         * A commitment put back on a list, and a candidate promoted.
         *
         * Handled before the capture path because they are unambiguous: the
         * MIME type says which row it is, and the entry says where it landed.
         */
        const actionId = e.dataTransfer.getData(DRAG_ACTION);
        if (actionId && drop.kind === 'list') {
          e.preventDefault();
          e.stopPropagation();
          delete e.currentTarget.dataset.over;
          startTransition(async () => {
            await moveActionToList(actionId, drop.listId);
          });
          return;
        }

        const listItemId = e.dataTransfer.getData(DRAG_LIST_ITEM);
        if (listItemId && drop.kind === 'now') {
          e.preventDefault();
          e.stopPropagation();
          delete e.currentTarget.dataset.over;
          startTransition(async () => {
            await promoteListItem(listItemId);
          });
          return;
        }

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
