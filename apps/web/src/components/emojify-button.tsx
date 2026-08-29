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

  const run = (redo: boolean) => {
    setError(null);
    startTransition(async () => {
      const result = await emojifyRows(target, ids, redo);
      if (!result.ok) setError(result.error);
    });
  };

  const missing = ids.length - marked;

  return (
    <span className="flex items-center gap-2">
      {/*
        One button, and it fills the gaps.

        It used to say "Redo emoji" once anything was marked, which was the
        wrong offer: rows arrive marked now, so the common press is "catch up
        the few that are not" — and re-deciding two hundred rows costs a model
        call and can overwrite one you had corrected by hand. Redoing is still
        there, held behind a modifier, because it is a deliberate thing.
      */}
      <button
        type="button"
        onClick={(event) => run(event.altKey || event.shiftKey)}
        disabled={pending || (missing === 0 && marked === 0)}
        title={
          missing > 0
            ? `Choose an emoji for the ${missing} without one. Hold Alt to redo them all.`
            : 'Everything here has one. Hold Alt to choose again.'
        }
        className="rounded-sm px-1.5 py-0.5 text-[11px] text-grey-500 hover:bg-grey-150 hover:text-grey-800 disabled:opacity-40"
      >
        {pending ? 'Choosing…' : missing > 0 ? `Emojify ${missing}` : 'Emojify'}
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
