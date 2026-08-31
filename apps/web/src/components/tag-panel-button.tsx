'use client';

import { useSidebarSlot } from './sidebar-slot';
import { IconContexts } from './icons';

/**
 * Open the box's tags in the first column.
 *
 * It used to be a chip at the end of the quick tag bar, reading "+37 more" —
 * which put the way *in* to the vocabulary at the end of a row that was already
 * the vocabulary, and put it below the fold on a narrow pane. A box's tags are
 * one of the two things you do to a box constantly; the other is choosing how
 * to look at it, and that is the control this now sits beside.
 *
 * The slot it claims is the sidebar, which is already a drawer on a phone — so
 * this is a column on a desktop and a sheet on a phone without either being
 * written twice.
 */
export function TagPanelButton({ total }: { total: number }) {
  const slot = useSidebarSlot();
  const open = slot.owner === 'tag-browser';

  return (
    <button
      type="button"
      onClick={() => slot.claim(open ? null : 'tag-browser')}
      aria-pressed={open}
      /* The count belongs here rather than on the face of it: "43 tags" is a
         fact worth having on hover and a number that would crowd a header. */
      title={`Tags — every one of the ${total} in this box, by category`}
      aria-label="Tags"
      className={[
        'rounded-sm p-1',
        open ? 'bg-grey-200 text-grey-800' : 'text-grey-400 hover:text-grey-600',
      ].join(' ')}
    >
      <IconContexts />
    </button>
  );
}
