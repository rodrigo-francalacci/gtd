'use client';

import { useState, useTransition } from 'react';
import { applyDocumentTag } from '@/lib/actions';
import { DRAG_BOX_ITEM, DRAG_TAG, dragPayload, hasDragType } from './sortable';

/**
 * An entry that a tag can be dropped onto.
 *
 * The tag panel was built to *narrow* a box — which is what you do with tags
 * once they are on things, and says nothing about how they get there. Putting
 * one on by hand meant opening the entry, opening the editor and finding the
 * tag in a list, three steps away from a panel already showing every tag in the
 * box next to every entry in it. Dragging closes that gap: the two things are
 * on screen together, so the gesture between them is the whole interaction.
 *
 * The highlight is cleared in the **capture** phase, for the reason the action
 * buckets clear theirs: something inside may handle the drop and stop it
 * bubbling, and a bubble-phase clear would then never run and leave the row lit.
 *
 * Applies, never toggles. See `applyDocumentTag` — a drop whose meaning flipped
 * depending on what the row already carried would be the one gesture here you
 * could not predict the result of.
 */
export function TagDrop({
  itemId,
  label,
  accepts,
  children,
}: {
  itemId: string;
  /** What it is called, so a drag carries something readable as `text/plain`. */
  label: string;
  /**
   * Whether this row can be tagged at all.
   *
   * False for a milestone. A milestone is a shortcut to a project — selecting
   * one opens the *project* pane, not a document pane — so it has no tag
   * editor, and a tag dropped on it could never be taken off again while still
   * counting in every facet. A row you cannot untag is worse than a row you
   * cannot tag.
   */
  accepts: boolean;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <div
      /*
       * The row is also the thing you *drag* — onto a box in the sidebar, to
       * move it there, or with Ctrl held to copy it. Draggable here rather than
       * on the row components because this already wraps every entry in both
       * densities, so one wrapper carries both halves of the gesture.
       */
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_BOX_ITEM, itemId);
        e.dataTransfer.setData('text/plain', label);
        // Both, so the sidebar can honour whichever the modifier asks for.
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
      onDragOver={(e) => {
        // A milestone can be dragged but not tagged — see `accepts`.
        if (!accepts || !hasDragType(e, DRAG_TAG)) return;
        // Without this the drop never fires: preventing the default on
        // dragover is what marks an element as a valid target at all.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeaveCapture={() => setOver(false)}
      onDropCapture={() => setOver(false)}
      onDrop={(e) => {
        if (!accepts || !hasDragType(e, DRAG_TAG)) return;
        e.preventDefault();
        e.stopPropagation();

        const tagId = dragPayload(e, DRAG_TAG);
        if (!tagId) return;

        startTransition(async () => {
          await applyDocumentTag(itemId, tagId);
        });
      }}
      className={
        over ? 'rounded-sm outline outline-1 outline-selected bg-selected-bg' : undefined
      }
    >
      {children}
    </div>
  );
}
