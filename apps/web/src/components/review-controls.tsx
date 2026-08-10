'use client';

import { useTransition } from 'react';
import {
  abandonReview,
  completeReview,
  createAction,
  markActionReviewed,
  markProjectReviewed,
  nudgeWaiting,
  setReviewStep,
  startReview,
} from '@/lib/actions';
import type { ReviewStep } from '@/lib/review';

/** A tick that records "I have looked at this" against the current session. */
export function ReviewedTick({
  id,
  kind,
  reviewed,
}: {
  id: string;
  kind: 'project' | 'action';
  reviewed: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={reviewed}
      aria-label={reviewed ? 'Mark not reviewed' : 'Mark reviewed'}
      onClick={() =>
        startTransition(async () => {
          if (kind === 'project') await markProjectReviewed(id, !reviewed);
          else await markActionReviewed(id, !reviewed);
        })
      }
      className={[
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border text-[10px]',
        reviewed
          ? 'border-grey-700 bg-grey-700 text-paper'
          : 'border-grey-400 bg-paper hover:border-grey-600',
        pending ? 'opacity-50' : '',
      ].join(' ')}
    >
      {reviewed ? '✓' : ''}
    </button>
  );
}

export function ChaseButton({ actionId }: { actionId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => void nudgeWaiting(actionId))}
      className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
    >
      Chased today
    </button>
  );
}

/** Inline "give this project a next action" — the fix for a stalled project. */
export function AddNextAction({ projectId }: { projectId: string }) {
  return (
    <form
      action={async (formData) => {
        await createAction(formData);
      }}
      className="mt-1.5 flex gap-2"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input
        name="title"
        placeholder="What is the very next physical step?"
        autoComplete="off"
        className="flex-1 rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[12px] focus:border-grey-500 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper"
      >
        Add
      </button>
    </form>
  );
}

export function StepNav({
  reviewId,
  step,
  nextStep,
  previousStep,
  canAdvance,
  blockedReason,
}: {
  reviewId: string;
  step: ReviewStep;
  nextStep: ReviewStep | null;
  previousStep: ReviewStep | null;
  canAdvance: boolean;
  blockedReason: string | null;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-grey-150 pt-4">
      {previousStep ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => void setReviewStep(reviewId, previousStep))
          }
          className="text-[12px] text-grey-500 underline underline-offset-2"
        >
          Back
        </button>
      ) : null}

      {nextStep ? (
        <button
          type="button"
          disabled={!canAdvance || pending}
          onClick={() =>
            startTransition(async () => void setReviewStep(reviewId, nextStep))
          }
          className="rounded-sm bg-grey-800 px-3 py-1.5 text-[12px] text-paper disabled:opacity-40"
        >
          Next step
        </button>
      ) : (
        <button
          type="button"
          disabled={!canAdvance || pending}
          onClick={() => startTransition(async () => void completeReview(reviewId))}
          className="rounded-sm bg-grey-800 px-3 py-1.5 text-[12px] text-paper disabled:opacity-40"
        >
          Finish review
        </button>
      )}

      {/* The gate is the point of this mode, so say plainly why it's shut. */}
      {!canAdvance && blockedReason ? (
        <span className="text-[12px] text-stale">{blockedReason}</span>
      ) : null}

      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => void abandonReview(reviewId))}
        className="ml-auto text-[11px] text-grey-400 underline underline-offset-2 hover:text-stale"
      >
        Abandon review
      </button>

      <span className="sr-only">Current step: {step}</span>
    </div>
  );
}

export function StartReviewButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => void startReview())}
      className="rounded-sm bg-grey-800 px-3 py-1.5 text-[12px] text-paper disabled:opacity-40"
    >
      Start the weekly review
    </button>
  );
}
