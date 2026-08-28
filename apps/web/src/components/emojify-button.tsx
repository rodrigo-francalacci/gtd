'use client';

import { useState, useTransition } from 'react';
import { clearEmoji, emojifyRows, type EmojiTarget } from '@/lib/actions';

/**
 * Put an emoji on every row in this list, or take them off.
 *
 * A button rather than something that happens on its own, because it spends
 * money: a list that quietly called a model each time it rendered would be the
 * opposite of what a queue you open twenty times a day should be. Pressing it is
 * the consent, and the ids it sends are the rows you were actually looking at —
 * so a filtered list marks what the filter left, not the whole table.
 *
 * It offers "clear" only once there is something to clear, which is also how the
 * button says which state the list is in without a label explaining it.
 */
export function EmojifyButton({
  target,
  ids,
  marked,
}: {
  target: EmojiTarget;
  /** The rows on screen, in the order they are shown. */
  ids: string[];
  /** How many of them already carry an emoji. */
  marked: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (ids.length === 0) return null;

  const run = () => {
    setError(null);
    startTransition(async () => {
      const result = await emojifyRows(target, ids);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title={
          marked > 0
            ? 'Choose emoji again for every row in this list'
            : 'Put an emoji in front of each row, so the list can be scanned'
        }
        className="rounded-sm px-1.5 py-0.5 text-[11px] text-grey-500 hover:bg-grey-150 hover:text-grey-800 disabled:opacity-40"
      >
        {pending ? 'Choosing…' : marked > 0 ? 'Redo emoji' : 'Emojify'}
      </button>

      {marked > 0 && !pending ? (
        <button
          type="button"
          onClick={() => startTransition(() => clearEmoji(target, ids))}
          title="Take the emoji off again"
          className="text-[11px] text-grey-400 underline underline-offset-2 hover:text-grey-700"
        >
          Clear
        </button>
      ) : null}

      {/* The one failure worth naming: no key, so nothing could have chosen. */}
      {error ? <span className="text-[11px] text-stale">{error}</span> : null}
    </span>
  );
}
