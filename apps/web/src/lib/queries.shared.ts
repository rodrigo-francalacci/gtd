import type { ActionStatus, ProjectStatus } from '@gtd/db';

/**
 * Types and pure helpers shared by server queries and client components.
 * Kept out of `queries.ts` because that module is `server-only` — importing it
 * from a Client Component would be a build error.
 */

export type ActionRow = {
  id: string;
  title: string;
  status: ActionStatus;
  waitingSince: string | null;
  projectId: string | null;
  projectTitle: string | null;
  position: number | null;
  contexts: { id: string; name: string; dimension: string }[];
};

/** Days after which a waiting-for item is considered stale. */
export const WAITING_STALE_DAYS = 14;

export function daysSince(date: string | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 864e5);
}

export function isStale(waitingSince: string | null): boolean {
  const days = daysSince(waitingSince);
  return days !== null && days >= WAITING_STALE_DAYS;
}

export type ProjectRow = {
  id: string;
  title: string;
  status: ProjectStatus;
  standbyReason: string | null;
  areaName: string | null;
  nextActionCount: number;
  waitingCount: number;
};

/**
 * An active project with no next action is stalled. Derived, never stored, so
 * it cannot drift out of sync with the actions themselves.
 */
export function isStalled(p: Pick<ProjectRow, 'status' | 'nextActionCount'>): boolean {
  return p.status === 'active' && p.nextActionCount === 0;
}

export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  'active',
  'standby',
  'someday',
  'completed',
  'dropped',
];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  standby: 'Standby',
  someday: 'Someday',
  completed: 'Completed',
  dropped: 'Dropped',
};
