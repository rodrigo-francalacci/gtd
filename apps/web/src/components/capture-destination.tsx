'use client';

import type { BoxOption } from '@/lib/queries.shared';

/**
 * Where this capture is going: the inbox, or a box.
 *
 * A visible row of chips rather than a menu, because the destination changes
 * what the thing *is* and you should never have to open anything to see it.
 * The inbox is a queue to be emptied — everything in it is waiting for you to
 * decide; a box is a shelf to be kept, and filing there is not a commitment.
 * Sending a thought to the wrong one is not a formatting mistake.
 *
 * **Never sticky.** It resets to Inbox every time, deliberately. A remembered
 * destination is how a stray thought ends up in the receipts box a fortnight
 * before you notice — and a share screen is glanced at once, not read. The
 * Chrome sidebar is allowed to remember because its two tabs are on screen the
 * whole time you are typing; this is not.
 */
export function CaptureDestination({
  boxes,
  value,
  onChange,
  disabled = false,
}: {
  boxes: BoxOption[];
  /** Null is the inbox. A box id is a box. */
  value: string | null;
  onChange: (boxId: string | null) => void;
  disabled?: boolean;
}) {
  // One destination is not a choice worth showing.
  if (boxes.length === 0) return null;

  const options: { id: string | null; label: string }[] = [
    { id: null, label: 'Inbox' },
    ...boxes.map((box) => ({ id: box.id as string | null, label: box.name })),
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Where this goes"
      // Scrolls sideways rather than wrapping: with several boxes a wrapping
      // row changes height as you scroll it, which moves the field underneath.
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
    >
      {options.map((option) => {
        const active = option.id === value;

        return (
          <button
            key={option.id ?? 'inbox'}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={[
              // 44px, the floor for something aimed at with a thumb rather than a
              // cursor. These chips are a primary interaction here, not a
              // refinement of something already on screen.
              'min-h-11 shrink-0 rounded-full px-4 text-[14px] disabled:opacity-40',
              active
                ? 'bg-selected-bg font-medium text-selected'
                : 'bg-grey-150 text-grey-600',
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
