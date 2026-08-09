import type { ActionStatus } from '@gtd/db';

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
