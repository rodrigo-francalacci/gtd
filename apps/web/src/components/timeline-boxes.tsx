'use client';

import { useState, useTransition } from 'react';
import { hideProjectFromTimeline, showProjectOnTimeline } from '@/lib/actions';
import type { BoxOption } from '@/lib/queries.shared';

/**
 * Which box timelines this project appears on.
 *
 * A box is read as a timeline — grouping by arrival is what makes it one — and
 * what a project *did* belongs among the receipts and letters of the months it
 * was happening in. "Started the kitchen" three lines above the first quote for
 * it says something neither line says on its own.
 *
 * Adding it puts a mark at the project's beginning, and its end too if it has
 * already had one: the point is to be able to read a year you have already had,
 * not only the one you are in. After that the marks keep themselves — archiving
 * writes the conclusion, reopening takes it away again.
 *
 * Removing takes both marks off and touches nothing else. The project does not
 * know or care which timelines it is on, which is why this is a list of boxes
 * rather than a field on the project.
 */
export function TimelineBoxes({
  projectId,
  boxes,
  on,
}: {
  projectId: string;
  boxes: BoxOption[];
  /** Box ids this project already has marks in. */
  on: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (boxes.length === 0) return null;

  const toggle = (boxId: string, showing: boolean) => {
    setError(null);
    startTransition(async () => {
      if (showing) {
        await hideProjectFromTimeline(projectId, boxId);
        return;
      }

      const result = await showProjectOnTimeline(projectId, boxId);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <section className="mt-6 border-t border-grey-150 pt-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
        On a timeline
      </h2>

      <p className="mt-1 text-[11px] leading-relaxed text-grey-500">
        Mark this project’s start and finish in a box’s feed, among whatever else
        arrived at the time.
      </p>

      <div className={['mt-2 flex flex-wrap gap-1', pending ? 'opacity-50' : ''].join(' ')}>
        {boxes.map((box) => {
          const showing = on.includes(box.id);

          return (
            <button
              key={box.id}
              type="button"
              disabled={pending}
              aria-pressed={showing}
              onClick={() => toggle(box.id, showing)}
              title={showing ? `Take it off ${box.name}` : `Show it on ${box.name}`}
              className={[
                'rounded-sm px-2 py-0.5 text-[11px] disabled:opacity-40',
                showing
                  ? 'bg-selected-bg font-medium text-selected'
                  : 'bg-grey-200 text-grey-600 hover:bg-grey-300',
              ].join(' ')}
            >
              {box.name}
            </button>
          );
        })}
      </div>

      {error ? <p className="mt-1 text-[11px] text-stale">{error}</p> : null}
    </section>
  );
}
