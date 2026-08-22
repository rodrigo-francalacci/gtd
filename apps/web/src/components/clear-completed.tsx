'use client';

import { useState, useTransition } from 'react';
import { deleteCompletedActions } from '@/lib/actions';

/**
 * Throw away a project's finished steps.
 *
 * Not every project is worth a record. A recurring bit of admin accrues the
 * same four ticked rows every time round and none of them will be read again,
 * and a project you have to scroll past forty of them to reach is a project
 * you stop opening. So this is per-project and it is a button: nothing sweeps,
 * nothing expires, and a project whose history is the point keeps all of it by
 * nobody pressing anything.
 *
 * Confirmed in place rather than through `confirm()`. A native dialog blocks
 * the page, looks like the browser rather than the app, and — the part that
 * matters — gives no room to say what is actually about to happen, which for
 * something that reaches into Drive is the only thing worth saying.
 */
export function ClearCompleted({
  projectId,
  count,
}: {
  projectId: string;
  count: number;
}) {
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);

  /*
   * No "done" message, and not an omission.
   *
   * Clearing the last finished step removes the fold this control lives in, so
   * anything it tried to say about the outcome would be unmounted before it
   * could be read. The disappearance is the report, and the confirmation below
   * has already said what would happen to the files — which is the part worth
   * knowing, and better said before than after.
   */
  if (!asking) {
    return (
      <div className="border-t border-grey-200 px-3 py-2">
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="text-[11px] text-grey-400 underline underline-offset-2 hover:text-stale"
        >
          Delete these {count} finished {count === 1 ? 'step' : 'steps'}
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-grey-200 bg-grey-50 px-3 py-2.5">
      <p className="text-[11px] leading-relaxed text-grey-600">
        Delete {count} finished {count === 1 ? 'step' : 'steps'} from this project?
        The {count === 1 ? 'step' : 'steps'} cannot be brought back. Any files
        attached to {count === 1 ? 'it' : 'them'} go to Drive&rsquo;s bin, where
        they can be. Documents from a box are only unlinked.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await deleteCompletedActions(projectId);
            })
          }
          className="rounded-sm border border-stale px-2 py-1 text-[11px] text-stale hover:bg-stale-bg disabled:opacity-40"
        >
          {pending ? 'Deleting…' : 'Delete them'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setAsking(false)}
          className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
        >
          Keep them
        </button>
      </div>
    </div>
  );
}
