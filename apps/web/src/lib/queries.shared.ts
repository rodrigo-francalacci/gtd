import type { ActionStatus, AttachmentKind, ProjectStatus } from '@gtd/db';

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
  /** Who or what you're waiting on — null when unrecorded. */
  waitingOn: string | null;
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
  areaId: string | null;
  goalId: string | null;
  areaName: string | null;
  lastReviewedAt: Date | null;
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

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type PurchaseImpact = 'blocks' | 'improves' | 'nice_to_have';
export type PurchaseWhere = 'online' | 'in_town';

export type PurchaseFields = {
  cost?: number;
  impact?: PurchaseImpact;
  where?: PurchaseWhere;
};

export const IMPACT_LABELS: Record<PurchaseImpact, string> = {
  blocks: 'Blocks a project',
  improves: 'Improves things',
  nice_to_have: 'Nice to have',
};

export const IMPACT_SHORT: Record<PurchaseImpact, string> = {
  blocks: 'blocks',
  improves: 'improves',
  nice_to_have: 'nice to have',
};

export const WHERE_LABELS: Record<PurchaseWhere, string> = {
  online: 'Online',
  in_town: 'In town',
};

/**
 * Where a list item sits on the candidate → commitment path.
 *
 * The three are disjoint by construction, which is what stops the budget
 * double-counting: an item is in exactly one bucket at any moment.
 *
 *  - `candidate` — never promoted. Proposed spend.
 *  - `committed` — promoted and the resulting action is still open. The brief's
 *    case is an item that has been ordered and now lives in Waiting For.
 *  - `settled`   — the promoted action is done. Money already spent.
 */
export type ItemStage = 'candidate' | 'committed' | 'settled';

export type ListItemRow = {
  id: string;
  listId: string;
  title: string;
  fields: PurchaseFields | null;
  projectId: string | null;
  projectTitle: string | null;
  promotedActionId: string | null;
  promotedActionStatus: ActionStatus | null;
  position: number | null;
  stage: ItemStage;
  /**
   * Only the detail pane needs the body, so the list query leaves it out —
   * `getListItem` fills it and `getListItems` sets it null rather than
   * shipping a document per row to render a title.
   */
  notes: unknown;
};

export function stageOf(
  promotedActionId: string | null,
  promotedActionStatus: ActionStatus | null,
): ItemStage {
  if (!promotedActionId) return 'candidate';
  return promotedActionStatus === 'done' ? 'settled' : 'committed';
}

export type ListRow = {
  id: string;
  name: string;
  type: 'someday_maybe' | 'purchases' | 'reference' | 'checklist';
  itemCount: number;
  candidateCount: number;
};

export const LIST_TYPE_LABELS: Record<ListRow['type'], string> = {
  someday_maybe: 'Someday / Maybe',
  purchases: 'Purchases',
  reference: 'Reference',
  checklist: 'Checklist',
};

/**
 * Single place to change the currency. Cost is stored as a plain number, so
 * this only affects display.
 */
export const CURRENCY = 'GBP';

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: CURRENCY,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  standby: 'Standby',
  someday: 'Someday',
  completed: 'Completed',
  dropped: 'Dropped',
};

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export type AttachmentRow = {
  id: string;
  name: string;
  kind: AttachmentKind;
  mimeType: string | null;
  sizeBytes: number | null;
  driveFileId: string | null;
  createdAt: Date;
};
