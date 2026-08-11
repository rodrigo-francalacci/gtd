'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { turnIntoNextAction } from '@/lib/actions';

/**
 * "I did this, and the next step is…" — the move that keeps a project from
 * stalling the moment you finish something.
 *
 * Completing the action and naming its successor in one step, rather than
 * ticking the box and hoping you remember to add the follow-up. The old
 * action is kept as done: the record of what you did is worth more than a
 * tidy list, and the successor starts with a genuinely fresh date instead of
 * inheriting the age of the step before it.
 */
export function TurnIntoNextAction({ actionId }: { actionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm border border-grey-300 px-2 py-1 text-[12px] text-grey-700 hover:border-grey-500"
      >
        Done → next action
      </button>
    );
  }

  const submit = () => {
    if (!title.trim()) return;
    startTransition(async () => {
      const successor = await turnIntoNextAction(actionId, title);
      setOpen(false);
      setTitle('');
      if (successor) router.push(`/now?action=${successor}`);
    });
  };

  return (
    <div className="w-full rounded-sm border border-grey-300 bg-grey-50 px-3 py-2.5">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
        Finish this and start the next step
      </label>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="What is the very next physical step?"
        className="mt-1.5 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!title.trim() || pending}
          className="rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-40"
        >
          Done, next is this
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-grey-500 underline underline-offset-2"
        >
          Cancel
        </button>
        <span className="text-[11px] text-grey-400">
          Keeps the project, the contexts, and the place in the list.
        </span>
      </div>
    </div>
  );
}
