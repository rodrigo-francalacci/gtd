'use client';

import { useState, useTransition } from 'react';
import { addToActionQueue, removeFromActionQueue } from '@/lib/actions';

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
});

/**
 * What this action becomes when you tick it off.
 *
 * Some steps recur *in place*: chasing the council, this week's invoice, the
 * next verse. Finishing one does not finish the thing — it moves it on — and
 * everything you have gathered against it should move on too. So the queue
 * replaces the row's title rather than closing it and opening another, which
 * is the only way the files, the notes, the contexts and its place in the list
 * survive the transition.
 *
 * **Deliberately not `turnIntoNextAction`.** That answers the opposite need and
 * makes a *new row* on purpose, so the finished step stays in the record with
 * its own creation date. The trade here is the other way round: the row is the
 * thing worth keeping, and what is given up — a separate archive entry per turn
 * — is bought back by the history below, which records what the action actually
 * said each time it moved on.
 *
 * The emoji is worked out when it advances, not now: a queue is a list of
 * titles, and asking a model about a line you are still editing would be paying
 * for a guess about something not yet true.
 */
export function ActionQueue({
  actionId,
  upcoming,
  done,
}: {
  actionId: string;
  upcoming: { id: string; title: string }[];
  done: { id: string; title: string; doneAt: string }[];
}) {
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();

  const add = () => {
    const title = draft.trim();
    if (!title) return;

    // Cleared first, so the field is ready for the next one before the round
    // trip finishes — these are typed in runs of three or four.
    setDraft('');
    startTransition(async () => {
      await addToActionQueue(actionId, title);
    });
  };

  return (
    <section className="mt-7 border-t border-grey-150 pt-5">
      <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
        Then it becomes
      </h2>

      <p className="mb-2 text-[11px] leading-relaxed text-grey-500">
        {upcoming.length === 0 && done.length === 0
          ? 'Queue what this turns into next, and ticking it off will rename it instead of closing it — keeping its files and notes.'
          : `Ticking this off takes the next line${
              upcoming.length > 1 ? `, ${upcoming.length} queued` : ''
            }.`}
      </p>

      {done.length > 0 ? (
        <ol className="mb-2">
          {done.map((entry) => (
            <li
              key={entry.id}
              className="flex items-baseline gap-2 py-0.5 text-[12px] text-grey-400"
            >
              {/* Struck through, because it is what this row used to say. */}
              <span className="min-w-0 flex-1 truncate line-through">{entry.title}</span>
              <span className="shrink-0 tabular-nums text-[10px]">
                {when.format(new Date(entry.doneAt))}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <ol className={pending ? 'opacity-60' : undefined}>
        {upcoming.map((entry, at) => (
          <li key={entry.id} className="flex items-baseline gap-2 py-0.5 text-[12px]">
            <span className="w-4 shrink-0 tabular-nums text-[10px] text-grey-400">
              {at + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-grey-800">{entry.title}</span>
            <button
              type="button"
              onClick={() =>
                startTransition(async () => {
                  await removeFromActionQueue(entry.id);
                })
              }
              aria-label={`Take "${entry.title}" out of the queue`}
              className="shrink-0 px-1 text-[12px] leading-none text-grey-400 hover:text-stale"
            >
              ×
            </button>
          </li>
        ))}
      </ol>

      <form
        className="mt-1.5 flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="And then…"
          /* 16px, or iOS Safari zooms the page in when it takes focus. */
          className="min-w-0 flex-1 rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[16px] text-grey-800 placeholder:text-grey-500 focus:border-grey-500 focus:outline-none md:text-[12px]"
        />
        <button
          type="submit"
          disabled={pending || draft.trim().length === 0}
          className="shrink-0 rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-40"
        >
          Queue it
        </button>
      </form>
    </section>
  );
}
