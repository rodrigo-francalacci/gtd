'use client';

import type { BoxOption } from '@/lib/queries.shared';

/**
 * Where a capture is going.
 *
 * Three kinds rather than two, because a thing you want to buy is already
 * clarified — you know what it is and that it is a purchase — so routing it
 * through a queue whose job is to answer "what is this?" adds a step, and puts
 * something in the queue that was never a question.
 */
export type Destination =
  | { kind: 'inbox' }
  | { kind: 'box'; id: string }
  | { kind: 'buy'; listId: string };

/** One string per destination, so a chip row can compare by identity. */
export function destKey(d: Destination): string {
  if (d.kind === 'inbox') return 'inbox';
  return d.kind === 'box' ? `box:${d.id}` : `buy:${d.listId}`;
}

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
  purchases,
  value,
  onChange,
  disabled = false,
}: {
  boxes: BoxOption[];
  /** Purchases lists, offered as destinations of their own. */
  purchases: BoxOption[];
  value: Destination;
  onChange: (next: Destination) => void;
  disabled?: boolean;
}) {
  const options: { dest: Destination; label: string }[] = [
    { dest: { kind: 'inbox' }, label: 'Inbox' },
    // Before the boxes: buying something is a far commoner thing to be doing
    // on a phone than filing a document, and the row scrolls.
    ...purchases.map((l) => ({
      dest: { kind: 'buy' as const, listId: l.id },
      label: l.name,
    })),
    ...boxes.map((box) => ({ dest: { kind: 'box' as const, id: box.id }, label: box.name })),
  ];

  // One destination is not a choice worth showing.
  if (options.length < 2) return null;

  const current = destKey(value);

  return (
    <div
      role="radiogroup"
      aria-label="Where this goes"
      // Scrolls sideways rather than wrapping: with several boxes a wrapping
      // row changes height as you scroll it, which moves the field underneath.
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
    >
      {options.map((option) => {
        const key = destKey(option.dest);
        const active = key === current;

        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.dest)}
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
