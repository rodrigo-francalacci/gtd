import 'server-only';

import { actions, contexts, db, inboxItems, projects, reviews } from '@gtd/db';
import { alias } from 'drizzle-orm/pg-core';
import { asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { getProjects } from './queries';
import { isStalled } from './queries.shared';

const waitingParty = alias(contexts, 'waiting_party');

export type ReviewStep = 'inbox' | 'projects' | 'stalled' | 'waiting' | 'standby' | 'done';

/** The order the brief specifies. */
export const REVIEW_STEPS: Exclude<ReviewStep, 'done'>[] = [
  'inbox',
  'projects',
  'stalled',
  'waiting',
  'standby',
];

export const STEP_LABELS: Record<ReviewStep, string> = {
  inbox: 'Empty the inbox',
  projects: 'Review projects',
  stalled: 'Unstick what stalled',
  waiting: 'Chase what you are waiting on',
  standby: 'Standby and someday',
  done: 'Done',
};

export const STEP_BLURBS: Record<ReviewStep, string> = {
  inbox: 'Every capture gets a decision. Nothing moves on until this is empty.',
  projects:
    'Look at each active project and confirm it still deserves to be active, and that its next action is really the next step.',
  stalled:
    'An active project with no next action is stalled. Give it one, or change its status — this step will not clear until none are left.',
  waiting: 'Anything gone quiet? Chase it, or accept it and tick it off.',
  standby:
    'Standby and someday projects. Is the return condition still right? Should anything come back to active?',
  done: 'Review complete.',
};

export type ReviewRow = {
  id: string;
  startedAt: Date;
  step: ReviewStep;
};

/** The review in progress, if there is one. */
export async function getActiveReview(): Promise<ReviewRow | null> {
  const [row] = await db
    .select({ id: reviews.id, startedAt: reviews.startedAt, step: reviews.step })
    .from(reviews)
    .where(isNull(reviews.completedAt))
    .orderBy(desc(reviews.startedAt))
    .limit(1);

  return (row as ReviewRow) ?? null;
}

export async function getLastCompletedReview() {
  const [row] = await db
    .select({ completedAt: reviews.completedAt })
    .from(reviews)
    .where(sql`${reviews.completedAt} is not null`)
    .orderBy(desc(reviews.completedAt))
    .limit(1);

  return row?.completedAt ?? null;
}

export type StepProgress = {
  step: Exclude<ReviewStep, 'done'>;
  /** Items still needing attention in this step. */
  outstanding: number;
  total: number;
  complete: boolean;
};

/**
 * Progress for every step, computed from the data rather than from anything
 * the user asserted. That's what makes "won't let you skip a section" real:
 * the inbox is empty or it isn't, a project is stalled or it isn't.
 */
export async function getReviewProgress(startedAt: Date): Promise<StepProgress[]> {
  // Project counts come from `getProjects` rather than a second query of my
  // own: one source of truth means the review can't disagree with the sidebar
  // about what's stalled.
  const [inboxPending, allProjects, waitingActions] = await Promise.all([
    db.select({ n: count() }).from(inboxItems).where(eq(inboxItems.status, 'pending')),
    getProjects(),
    db
      .select({ id: actions.id, lastReviewedAt: actions.lastReviewedAt })
      .from(actions)
      .where(eq(actions.status, 'waiting')),
  ]);

  const seen = (d: Date | null) => d !== null && d.getTime() >= startedAt.getTime();

  const activeProjects = allProjects.filter((p) => p.status === 'active');
  const standbyProjects = allProjects.filter(
    (p) => p.status === 'standby' || p.status === 'someday',
  );

  const inboxCount = inboxPending[0]?.n ?? 0;
  const unreviewedProjects = activeProjects.filter((p) => !seen(p.lastReviewedAt));
  const stalled = activeProjects.filter(isStalled);
  const unreviewedWaiting = waitingActions.filter((a) => !seen(a.lastReviewedAt));
  const unreviewedStandby = standbyProjects.filter((p) => !seen(p.lastReviewedAt));

  return [
    {
      step: 'inbox',
      outstanding: inboxCount,
      total: inboxCount,
      complete: inboxCount === 0,
    },
    {
      step: 'projects',
      outstanding: unreviewedProjects.length,
      total: activeProjects.length,
      complete: unreviewedProjects.length === 0,
    },
    {
      step: 'stalled',
      outstanding: stalled.length,
      total: stalled.length,
      complete: stalled.length === 0,
    },
    {
      step: 'waiting',
      outstanding: unreviewedWaiting.length,
      total: waitingActions.length,
      complete: unreviewedWaiting.length === 0,
    },
    {
      step: 'standby',
      outstanding: unreviewedStandby.length,
      total: standbyProjects.length,
      complete: unreviewedStandby.length === 0,
    },
  ];
}

/** The earliest step that still has outstanding work. */
export function firstIncompleteStep(progress: StepProgress[]): ReviewStep {
  return progress.find((p) => !p.complete)?.step ?? 'done';
}

/**
 * Where the user is allowed to be. You can revisit a finished step, but you
 * can't jump past one that isn't done.
 */
export function clampStep(requested: ReviewStep, progress: StepProgress[]): ReviewStep {
  const blocker = firstIncompleteStep(progress);
  if (blocker === 'done') return requested;

  const order = [...REVIEW_STEPS, 'done'] as ReviewStep[];
  return order.indexOf(requested) > order.indexOf(blocker) ? blocker : requested;
}

// --- Per-step data --------------------------------------------------------

export async function getProjectsForReview(startedAt: Date) {
  const rows = await getProjects();

  return rows.map((r) => ({
    ...r,
    reviewed:
      r.lastReviewedAt !== null && r.lastReviewedAt.getTime() >= startedAt.getTime(),
  }));
}

export async function getWaitingForReview(startedAt: Date) {
  const rows = await db
    .select({
      id: actions.id,
      title: actions.title,
      waitingSince: actions.waitingSince,
      waitingOn: waitingParty.name,
      lastReviewedAt: actions.lastReviewedAt,
      projectTitle: projects.title,
    })
    .from(actions)
    .leftJoin(projects, eq(projects.id, actions.projectId))
    .leftJoin(waitingParty, eq(waitingParty.id, actions.waitingOnId))
    .where(eq(actions.status, 'waiting'))
    .orderBy(asc(actions.waitingSince));

  return rows.map((r) => ({
    ...r,
    reviewed: r.lastReviewedAt !== null && r.lastReviewedAt.getTime() >= startedAt.getTime(),
  }));
}

export async function getStalledForReview() {
  const rows = await getProjects();
  return rows.filter(isStalled);
}
