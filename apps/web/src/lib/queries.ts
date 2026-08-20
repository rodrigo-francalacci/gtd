import 'server-only';

import {
  actionContexts,
  actions,
  areasOfFocus,
  attachments,
  boxCategories,
  boxItemLinks,
  boxItemTags,
  boxItems,
  boxJobs,
  boxTags,
  boxes,
  contexts,
  db,
  goals,
  inboxItems,
  listItems,
  lists,
  projects,
  type AiSuggestion,
  type AttachmentParentType,
} from '@gtd/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  ActionRow,
  AttachmentRow,
  BoxCategoryRow,
  BoxItemDetail,
  BoxItemRow,
  BoxLinkRow,
  BoxRow,
  LinkedDocumentRow,
  ListItemRow,
  ListRow,
  ProjectRow,
  PurchaseFields,
} from './queries.shared';
import { isStalled, stageOf } from './queries.shared';

export type {
  ActionRow,
  AttachmentRow,
  AppliedTag,
  BoxCategoryRow,
  BoxItemDetail,
  BoxItemRow,
  BoxLinkRow,
  BoxRow,
  BoxTagRow,
  LinkedDocumentRow,
  ListItemRow,
  ListRow,
  ProjectRow,
  PurchaseFields,
} from './queries.shared';
export {
  CURRENCY,
  IMPACT_LABELS,
  IMPACT_SHORT,
  LIST_TYPE_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
  WAITING_STALE_DAYS,
  WHERE_LABELS,
  daysSince,
  formatMoney,
  isStale,
  isStalled,
  stageOf,
} from './queries.shared';

/** Contexts with how many actions carry each — shown before deleting one. */
export async function getContextsWithUsage() {
  const rows = await db
    .select({
      id: contexts.id,
      name: contexts.name,
      dimension: contexts.dimension,
      // Includes waiting-on use, not just tags — otherwise deleting a person
      // would silently strip them from waiting items too.
      usage: sql<number>`(
        (select count(*) from ${actionContexts} ac where ac.context_id = ${contexts.id})
        + (select count(*) from ${actions} a where a.waiting_on_id = ${contexts.id})
      )::int`,
    })
    .from(contexts)
    .orderBy(asc(contexts.dimension), asc(contexts.name));

  return rows;
}

/** Contexts grouped by dimension, for the filter bar. */
export async function getContextsByDimension() {
  const rows = await db
    .select()
    .from(contexts)
    .orderBy(asc(contexts.dimension), asc(contexts.name));

  return {
    place: rows.filter((c) => c.dimension === 'place'),
    time: rows.filter((c) => c.dimension === 'time'),
    energy: rows.filter((c) => c.dimension === 'energy'),
    person: rows.filter((c) => c.dimension === 'person'),
  };
}

/**
 * Attach contexts to a set of actions in one round trip rather than N.
 */
async function attachContexts(
  rows: Omit<ActionRow, 'contexts'>[],
): Promise<ActionRow[]> {
  if (rows.length === 0) return [];

  const links = await db
    .select({
      actionId: actionContexts.actionId,
      id: contexts.id,
      name: contexts.name,
      dimension: contexts.dimension,
    })
    .from(actionContexts)
    .innerJoin(contexts, eq(contexts.id, actionContexts.contextId))
    .where(
      inArray(
        actionContexts.actionId,
        rows.map((r) => r.id),
      ),
    );

  const byAction = new Map<string, ActionRow['contexts']>();
  for (const l of links) {
    const list = byAction.get(l.actionId) ?? [];
    list.push({ id: l.id, name: l.name, dimension: l.dimension });
    byAction.set(l.actionId, list);
  }

  return rows.map((r) => ({ ...r, contexts: byAction.get(r.id) ?? [] }));
}

/** Aliased so the party join doesn't collide with the contexts join. */
const waitingParty = alias(contexts, 'waiting_party');

const actionSelect = {
  id: actions.id,
  title: actions.title,
  status: actions.status,
  waitingSince: actions.waitingSince,
  waitingOn: waitingParty.name,
  projectId: actions.projectId,
  projectTitle: projects.title,
  position: actions.position,
};

/**
 * Manual order first, creation order as the tiebreak. Rows that have never
 * been dragged have a position from the backfill, so nulls should be rare —
 * but they sort last rather than jumping to the top if they occur.
 */
const byPosition = [
  sql`${actions.position} asc nulls last`,
  asc(actions.createdAt),
];

/**
 * The "what can I do now" query. Context filters are AND-ed across dimensions
 * (place AND time AND energy) but OR-ed within one, which is how the filter bar
 * reads: "at Home, with 30 min, on low energy".
 *
 * Actions with no contexts at all are included only when no filter is active —
 * an unfiled action shouldn't silently vanish from every filtered view.
 */
export async function getNowActions(contextIds: string[]): Promise<ActionRow[]> {
  const base = and(eq(actions.status, 'next'), isNull(actions.completedAt));

  if (contextIds.length === 0) {
    const rows = await db
      .select(actionSelect)
      .from(actions)
      .leftJoin(projects, eq(projects.id, actions.projectId))
      .leftJoin(waitingParty, eq(waitingParty.id, actions.waitingOnId))
      .where(base)
      .orderBy(...byPosition);
    return attachContexts(rows);
  }

  // Group the selected contexts by dimension so we can require a match in each.
  const selected = await db
    .select({ id: contexts.id, dimension: contexts.dimension })
    .from(contexts)
    .where(inArray(contexts.id, contextIds));

  const byDimension = new Map<string, string[]>();
  for (const c of selected) {
    byDimension.set(c.dimension, [...(byDimension.get(c.dimension) ?? []), c.id]);
  }

  const dimensionClauses = [...byDimension.values()].map(
    (ids) => sql`exists (
      select 1 from ${actionContexts} ac
      where ac.action_id = ${actions.id}
        and ac.context_id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
    )`,
  );

  const rows = await db
    .select(actionSelect)
    .from(actions)
    .leftJoin(projects, eq(projects.id, actions.projectId))
    .leftJoin(waitingParty, eq(waitingParty.id, actions.waitingOnId))
    .where(and(base, ...dimensionClauses))
    .orderBy(...byPosition);

  return attachContexts(rows);
}

/**
 * Waiting-for list. Manual order wins, with the oldest first underneath it —
 * staleness is still surfaced by the row badge and the pane header, so
 * dragging this list doesn't hide anything.
 */
export async function getWaitingActions(): Promise<ActionRow[]> {
  const rows = await db
    .select(actionSelect)
    .from(actions)
    .leftJoin(projects, eq(projects.id, actions.projectId))
    .leftJoin(waitingParty, eq(waitingParty.id, actions.waitingOnId))
    .where(eq(actions.status, 'waiting'))
    .orderBy(sql`${actions.position} asc nulls last`, asc(actions.waitingSince));

  return attachContexts(rows);
}

/**
 * Statuses that mean a project is finished and belongs in the archive.
 * Not `as const` — Drizzle's `inArray` takes a mutable array.
 */
const ARCHIVED_STATUSES: ('completed' | 'dropped')[] = ['completed', 'dropped'];

/**
 * Live projects only. Finished ones live in the archive, so they no longer
 * clutter the working pane or appear as drop targets when filing an action.
 */
export async function getProjects(): Promise<ProjectRow[]> {
  // The alias names must differ: both are joined into the same statement, and
  // Drizzle references them unqualified.
  const nextCounts = db
    .select({
      projectId: actions.projectId,
      n: count().as('next_n'),
    })
    .from(actions)
    .where(eq(actions.status, 'next'))
    .groupBy(actions.projectId)
    .as('next_counts');

  const waitingCounts = db
    .select({
      projectId: actions.projectId,
      n: count().as('waiting_n'),
    })
    .from(actions)
    .where(eq(actions.status, 'waiting'))
    .groupBy(actions.projectId)
    .as('waiting_counts');

  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      status: projects.status,
      standbyReason: projects.standbyReason,
      areaId: projects.areaId,
      goalId: projects.goalId,
      areaName: areasOfFocus.name,
      lastReviewedAt: projects.lastReviewedAt,
      nextActionCount: sql<number>`coalesce(${nextCounts.n}, 0)::int`,
      waitingCount: sql<number>`coalesce(${waitingCounts.n}, 0)::int`,
    })
    .from(projects)
    .leftJoin(areasOfFocus, eq(areasOfFocus.id, projects.areaId))
    .leftJoin(nextCounts, eq(nextCounts.projectId, projects.id))
    .leftJoin(waitingCounts, eq(waitingCounts.projectId, projects.id))
    .where(notInArray(projects.status, ARCHIVED_STATUSES))
    .orderBy(
      asc(projects.status),
      sql`${projects.position} asc nulls last`,
      asc(projects.title),
    );

  return rows;
}

export type ArchivedProjectRow = {
  id: string;
  title: string;
  status: 'completed' | 'dropped';
  completedAt: Date | null;
  areaName: string | null;
  goalTitle: string | null;
  doneActionCount: number;
  hasNotes: boolean;
};

/**
 * The archive: finished projects, newest first.
 *
 * A project is worth keeping for what it recorded, so this carries the counts
 * that tell you whether there's anything in there — notes, and how much got
 * done — rather than the next-action counts that matter for live work.
 */
export async function getArchivedProjects(): Promise<ArchivedProjectRow[]> {
  const doneCounts = db
    .select({ projectId: actions.projectId, n: count().as('done_n') })
    .from(actions)
    .where(eq(actions.status, 'done'))
    .groupBy(actions.projectId)
    .as('done_counts');

  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      status: projects.status,
      completedAt: projects.completedAt,
      areaName: areasOfFocus.name,
      goalTitle: goals.title,
      doneActionCount: sql<number>`coalesce(${doneCounts.n}, 0)::int`,
      hasNotes: sql<boolean>`(${projects.searchText} is not null and ${projects.searchText} <> '')`,
    })
    .from(projects)
    .leftJoin(areasOfFocus, eq(areasOfFocus.id, projects.areaId))
    .leftJoin(goals, eq(goals.id, projects.goalId))
    .leftJoin(doneCounts, eq(doneCounts.projectId, projects.id))
    .where(inArray(projects.status, ARCHIVED_STATUSES))
    .orderBy(sql`${projects.completedAt} desc nulls last`, asc(projects.title));

  return rows as ArchivedProjectRow[];
}

export async function getProject(id: string) {
  const [row] = await db
    .select({
      id: projects.id,
      title: projects.title,
      status: projects.status,
      standbyReason: projects.standbyReason,
      notes: projects.notes,
      areaId: projects.areaId,
      goalId: projects.goalId,
      areaName: areasOfFocus.name,
      driveFolderId: projects.driveFolderId,
      gmailLabelId: projects.gmailLabelId,
      completedAt: projects.completedAt,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .leftJoin(areasOfFocus, eq(areasOfFocus.id, projects.areaId))
    .where(eq(projects.id, id))
    .limit(1);

  return row ?? null;
}

export async function getProjectActions(projectId: string): Promise<ActionRow[]> {
  const rows = await db
    .select(actionSelect)
    .from(actions)
    .leftJoin(projects, eq(projects.id, actions.projectId))
    .leftJoin(waitingParty, eq(waitingParty.id, actions.waitingOnId))
    .where(eq(actions.projectId, projectId))
    .orderBy(asc(actions.status), ...byPosition);

  return attachContexts(rows);
}

export async function getAction(id: string) {
  const [row] = await db
    .select({
      id: actions.id,
      title: actions.title,
      status: actions.status,
      waitingSince: actions.waitingSince,
      waitingOn: waitingParty.name,
      notes: actions.notes,
      projectId: actions.projectId,
      projectTitle: projects.title,
      createdAt: actions.createdAt,
    })
    .from(actions)
    .leftJoin(projects, eq(projects.id, actions.projectId))
    .leftJoin(waitingParty, eq(waitingParty.id, actions.waitingOnId))
    .where(eq(actions.id, id))
    .limit(1);

  if (!row) return null;

  const ctx = await db
    .select({ id: contexts.id, name: contexts.name, dimension: contexts.dimension })
    .from(actionContexts)
    .innerJoin(contexts, eq(contexts.id, actionContexts.contextId))
    .where(eq(actionContexts.actionId, id));

  return { ...row, contexts: ctx };
}

/** Areas with their active-project counts — an empty area is the signal. */
export async function getAreasWithCounts() {
  const activeCounts = db
    .select({ areaId: projects.areaId, n: count().as('active_n') })
    .from(projects)
    .where(eq(projects.status, 'active'))
    .groupBy(projects.areaId)
    .as('active_counts');

  return db
    .select({
      id: areasOfFocus.id,
      name: areasOfFocus.name,
      activeProjects: sql<number>`coalesce(${activeCounts.n}, 0)::int`,
    })
    .from(areasOfFocus)
    .leftJoin(activeCounts, eq(activeCounts.areaId, areasOfFocus.id))
    .orderBy(asc(areasOfFocus.name));
}

export type AreaTree = {
  id: string;
  name: string;
  activeProjects: number;
  goals: {
    id: string;
    title: string;
    targetDate: string | null;
    activeProjects: number;
  }[];
};

/**
 * Areas with their goals nested, each carrying an active-project count.
 *
 * The counts are the point of this view: an area or goal with nothing active
 * under it is the gap the horizon exists to surface, so it must be visible
 * without opening anything.
 */
export async function getAreaTree(): Promise<{
  areas: AreaTree[];
  looseGoals: AreaTree['goals'];
}> {
  const [areaRows, goalRows, projectRows] = await Promise.all([
    db.select().from(areasOfFocus).orderBy(asc(areasOfFocus.name)),
    db.select().from(goals).orderBy(asc(goals.title)),
    db
      .select({
        areaId: projects.areaId,
        goalId: projects.goalId,
        status: projects.status,
      })
      .from(projects),
  ]);

  const active = projectRows.filter((p) => p.status === 'active');
  const countByArea = (id: string) => active.filter((p) => p.areaId === id).length;
  const countByGoal = (id: string) => active.filter((p) => p.goalId === id).length;

  const toGoal = (g: (typeof goalRows)[number]) => ({
    id: g.id,
    title: g.title,
    targetDate: g.targetDate,
    activeProjects: countByGoal(g.id),
  });

  return {
    areas: areaRows.map((a) => ({
      id: a.id,
      name: a.name,
      activeProjects: countByArea(a.id),
      goals: goalRows.filter((g) => g.areaId === a.id).map(toGoal),
    })),
    // A goal with no area still has to appear somewhere.
    looseGoals: goalRows.filter((g) => g.areaId === null).map(toGoal),
  };
}

export async function getArea(id: string) {
  const [row] = await db
    .select()
    .from(areasOfFocus)
    .where(eq(areasOfFocus.id, id))
    .limit(1);
  return row ?? null;
}

export async function getGoal(id: string) {
  const [row] = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  return row ?? null;
}

/** Live projects under an area or a goal, for the horizon detail pane. */
export async function getProjectsFor(filter: {
  areaId?: string;
  goalId?: string;
}): Promise<ProjectRow[]> {
  const all = await getProjects();
  return all.filter((p) =>
    filter.goalId
      ? p.goalId === filter.goalId
      : filter.areaId
        ? p.areaId === filter.areaId
        : false,
  );
}

export async function getAreasAndGoals() {
  const [areaRows, goalRows] = await Promise.all([
    db.select().from(areasOfFocus).orderBy(asc(areasOfFocus.name)),
    db.select().from(goals).orderBy(asc(goals.title)),
  ]);
  return { areas: areaRows, goals: goalRows };
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export type InboxRow = {
  id: string;
  rawType: 'text' | 'photo' | 'audio';
  rawText: string | null;
  aiSuggestion: AiSuggestion | null;
  createdAt: Date;
  /**
   * How many files the capture carries. A photo captured with no note has no
   * text to render, so the row needs something else to show — and a count is
   * enough for a list, where the files themselves belong in the pane beside
   * it.
   */
  attachmentCount: number;
};

/**
 * Pending captures, oldest first.
 *
 * Deliberately not newest-first: the inbox is a queue you empty from the top,
 * and putting the freshest thing there would let old items rot at the bottom.
 */
/** Files hanging off a capture, counted per row in one pass. */
const inboxAttachmentCount = db
  .select({
    parentId: attachments.parentId,
    n: sql<number>`count(*)::int`.as('inbox_att_n'),
  })
  .from(attachments)
  .where(eq(attachments.parentType, 'inbox_item'))
  .groupBy(attachments.parentId)
  .as('inbox_att');

export async function getInboxItems(): Promise<InboxRow[]> {
  const rows = await db
    .select({
      id: inboxItems.id,
      rawType: inboxItems.rawType,
      rawText: inboxItems.rawText,
      aiSuggestion: inboxItems.aiSuggestion,
      createdAt: inboxItems.createdAt,
      attachmentCount: sql<number>`coalesce(${inboxAttachmentCount.n}, 0)`,
    })
    .from(inboxItems)
    .leftJoin(inboxAttachmentCount, eq(inboxAttachmentCount.parentId, inboxItems.id))
    .where(eq(inboxItems.status, 'pending'))
    .orderBy(asc(inboxItems.createdAt));

  return rows as InboxRow[];
}

/**
 * The last few captures, newest first.
 *
 * For the phone, where the desktop's oldest-first queue is the wrong way round
 * and the wrong length. What you want after typing on a phone is proof it
 * landed — seeing the thing you just wrote sitting at the top is that proof,
 * and it costs one query rather than a round trip you have to trust.
 */
export async function getRecentCaptures(limit = 5): Promise<InboxRow[]> {
  const rows = await db
    .select({
      id: inboxItems.id,
      rawType: inboxItems.rawType,
      rawText: inboxItems.rawText,
      aiSuggestion: inboxItems.aiSuggestion,
      createdAt: inboxItems.createdAt,
      attachmentCount: sql<number>`coalesce(${inboxAttachmentCount.n}, 0)`,
    })
    .from(inboxItems)
    .leftJoin(inboxAttachmentCount, eq(inboxAttachmentCount.parentId, inboxItems.id))
    .where(eq(inboxItems.status, 'pending'))
    .orderBy(desc(inboxItems.createdAt))
    .limit(limit);

  return rows as InboxRow[];
}

export async function getInboxItem(id: string): Promise<InboxRow | null> {
  const [row] = await db
    .select({
      id: inboxItems.id,
      rawType: inboxItems.rawType,
      rawText: inboxItems.rawText,
      aiSuggestion: inboxItems.aiSuggestion,
      createdAt: inboxItems.createdAt,
      attachmentCount: sql<number>`coalesce(${inboxAttachmentCount.n}, 0)`,
    })
    .from(inboxItems)
    .leftJoin(inboxAttachmentCount, eq(inboxAttachmentCount.parentId, inboxItems.id))
    .where(eq(inboxItems.id, id))
    .limit(1);

  return (row as InboxRow) ?? null;
}

/** Lists that a non-actionable item can be parked on. */
export async function getListOptions() {
  return db
    .select({ id: lists.id, name: lists.name, type: lists.type })
    .from(lists)
    .orderBy(asc(lists.name));
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** All lists with their item counts, for the sidebar. */
export async function getLists(): Promise<ListRow[]> {
  const rows = await db
    .select({
      id: lists.id,
      name: lists.name,
      type: lists.type,
      itemId: listItems.id,
      promotedActionId: listItems.promotedActionId,
    })
    .from(lists)
    .leftJoin(listItems, eq(listItems.listId, lists.id))
    .orderBy(asc(lists.name));

  const byList = new Map<string, ListRow>();
  for (const r of rows) {
    const entry = byList.get(r.id) ?? {
      id: r.id,
      name: r.name,
      type: r.type,
      itemCount: 0,
      candidateCount: 0,
    };
    if (r.itemId) {
      entry.itemCount += 1;
      if (!r.promotedActionId) entry.candidateCount += 1;
    }
    byList.set(r.id, entry);
  }

  return [...byList.values()];
}

export async function getList(id: string) {
  const [row] = await db.select().from(lists).where(eq(lists.id, id)).limit(1);
  return row ?? null;
}

/**
 * Items on a list, with the status of the action they were promoted into —
 * that status is what decides whether an item counts as proposed or committed
 * spend, so it has to come back with the row rather than be fetched per item.
 */
export async function getListItems(listId: string): Promise<ListItemRow[]> {
  const rows = await db
    .select({
      id: listItems.id,
      listId: listItems.listId,
      title: listItems.title,
      fields: listItems.fields,
      projectId: listItems.projectId,
      projectTitle: projects.title,
      promotedActionId: listItems.promotedActionId,
      promotedActionStatus: actions.status,
      position: listItems.position,
    })
    .from(listItems)
    .leftJoin(projects, eq(projects.id, listItems.projectId))
    .leftJoin(actions, eq(actions.id, listItems.promotedActionId))
    .where(eq(listItems.listId, listId))
    .orderBy(sql`${listItems.position} asc nulls last`, asc(listItems.createdAt));

  return rows.map((r) => ({
    ...r,
    fields: (r.fields as PurchaseFields | null) ?? null,
    stage: stageOf(r.promotedActionId, r.promotedActionStatus),
    // A list renders titles. Selecting a row fetches its body separately, so
    // a long note on one item costs nothing to draw the other twenty.
    notes: null,
  }));
}

export async function getListItem(id: string): Promise<ListItemRow | null> {
  const [row] = await db
    .select({
      id: listItems.id,
      listId: listItems.listId,
      title: listItems.title,
      fields: listItems.fields,
      projectId: listItems.projectId,
      projectTitle: projects.title,
      promotedActionId: listItems.promotedActionId,
      promotedActionStatus: actions.status,
      position: listItems.position,
      notes: listItems.notes,
    })
    .from(listItems)
    .leftJoin(projects, eq(projects.id, listItems.projectId))
    .leftJoin(actions, eq(actions.id, listItems.promotedActionId))
    .where(eq(listItems.id, id))
    .limit(1);

  if (!row) return null;

  return {
    ...row,
    fields: (row.fields as PurchaseFields | null) ?? null,
    stage: stageOf(row.promotedActionId, row.promotedActionStatus),
  };
}

/** Project titles for the picker on a purchase item. */
export async function getProjectOptions() {
  return db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(inArray(projects.status, ['active', 'standby']))
    .orderBy(asc(projects.title));
}

/** Counts for the sidebar badges. */
export async function getSidebarCounts() {
  const [nextRow] = await db
    .select({ n: count() })
    .from(actions)
    .where(eq(actions.status, 'next'));

  const [waitingRow] = await db
    .select({ n: count() })
    .from(actions)
    .where(eq(actions.status, 'waiting'));

  const [inboxRow] = await db
    .select({ n: count() })
    .from(inboxItems)
    .where(eq(inboxItems.status, 'pending'));

  const [unfiledRow] = await db
    .select({ n: count() })
    .from(actions)
    .where(and(isNull(actions.projectId), inArray(actions.status, ['next', 'waiting'])));

  const [archivedRow] = await db
    .select({ n: count() })
    .from(projects)
    .where(inArray(projects.status, ARCHIVED_STATUSES));

  const projectRows = await getProjects();

  return {
    inbox: inboxRow?.n ?? 0,
    archived: archivedRow?.n ?? 0,
    next: nextRow?.n ?? 0,
    waiting: waitingRow?.n ?? 0,
    projects: projectRows.filter((p) => p.status === 'active').length,
    stalled: projectRows.filter(isStalled).length,
    unfiled: unfiledRow?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Files hanging off one project, action or list item. Name and type come from
 * our own row rather than Drive: a detail pane must never wait on Google.
 */
export async function getAttachments(
  parentType: AttachmentParentType,
  parentId: string,
): Promise<AttachmentRow[]> {
  return db
    .select({
      id: attachments.id,
      name: attachments.name,
      kind: attachments.kind,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      driveFileId: attachments.driveFileId,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.parentType, parentType),
        eq(attachments.parentId, parentId),
      ),
    )
    .orderBy(asc(attachments.createdAt));
}

// ---------------------------------------------------------------------------
// The Big Box
// ---------------------------------------------------------------------------

/**
 * Every box, with how full it is.
 *
 * `pendingCount` is how many documents are still waiting to be read — the one
 * number worth a badge, because until a document is read it has no title and
 * can be found only by when it arrived.
 */
export async function getBoxes(): Promise<BoxRow[]> {
  const counts = db
    .select({
      boxId: boxItems.boxId,
      total: sql<number>`count(*)::int`.as('box_total'),
      pending:
        sql<number>`count(*) filter (where ${boxItems.status} = 'pending')::int`.as(
          'box_pending',
        ),
    })
    .from(boxItems)
    .groupBy(boxItems.boxId)
    .as('box_counts');

  const rows = await db
    .select({
      id: boxes.id,
      name: boxes.name,
      instruction: boxes.instruction,
      rules: boxes.rules,
      isDefault: boxes.isDefault,
      driveFolderId: boxes.driveFolderId,
      position: boxes.position,
      itemCount: sql<number>`coalesce(${counts.total}, 0)`,
      pendingCount: sql<number>`coalesce(${counts.pending}, 0)`,
    })
    .from(boxes)
    .leftJoin(counts, eq(counts.boxId, boxes.id))
    // The default box leads: it is the one you file into without thinking.
    .orderBy(desc(boxes.isDefault), asc(boxes.position), asc(boxes.name));

  return rows as BoxRow[];
}

export async function getBox(id: string): Promise<BoxRow | null> {
  const all = await getBoxes();
  return all.find((b) => b.id === id) ?? null;
}

export async function getDefaultBox(): Promise<BoxRow | null> {
  const all = await getBoxes();
  return all.find((b) => b.isDefault) ?? null;
}

/**
 * A box's tag vocabulary, grouped by category.
 *
 * One query rather than one per category: the classifier, the filter bar and
 * the tag editor all want the whole shape, and the usage count is what the
 * editor needs before it will offer to delete anything.
 */
export async function getBoxCategories(boxId: string): Promise<BoxCategoryRow[]> {
  const rows = await db
    .select({
      categoryId: boxCategories.id,
      categoryName: boxCategories.name,
      allowNewTags: boxCategories.allowNewTags,
      tagId: boxTags.id,
      tagName: boxTags.name,
      usageCount: sql<number>`(
        select count(*)::int from ${boxItemTags} it where it.tag_id = ${boxTags.id}
      )`,
    })
    .from(boxCategories)
    .leftJoin(boxTags, eq(boxTags.categoryId, boxCategories.id))
    .where(eq(boxCategories.boxId, boxId))
    .orderBy(
      asc(boxCategories.position),
      asc(boxCategories.name),
      asc(boxTags.position),
      asc(boxTags.name),
    );

  const byCategory = new Map<string, BoxCategoryRow>();

  for (const row of rows) {
    const category = byCategory.get(row.categoryId) ?? {
      id: row.categoryId,
      name: row.categoryName,
      allowNewTags: row.allowNewTags,
      tags: [],
    };

    // The left join yields one null-tag row for a category with no tags yet.
    if (row.tagId) {
      category.tags.push({
        id: row.tagId,
        name: row.tagName!,
        usageCount: row.usageCount,
      });
    }

    byCategory.set(row.categoryId, category);
  }

  return [...byCategory.values()];
}

/** Midnight after the given day, in the server's timezone. */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(24, 0, 0, 0);
  return end;
}

/** Every tag id in a box, for validating a filter that came from the URL. */
export async function getBoxTagIds(boxId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: boxTags.id })
    .from(boxTags)
    .innerJoin(boxCategories, eq(boxCategories.id, boxTags.categoryId))
    .where(eq(boxCategories.boxId, boxId));

  return new Set(rows.map((r) => r.id));
}

/** The tags on a document, as one JSON aggregate — used by both item reads. */
const itemTags = sql<
  { id: string; name: string; category: string }[]
>`coalesce((
  select json_agg(json_build_object('id', t.id, 'name', t.name, 'category', c.name)
                  order by c.position nulls last, c.name, t.name)
  from box_item_tags it
  join box_tags t on t.id = it.tag_id
  join box_categories c on c.id = t.category_id
  where it.item_id = box_items.id
), '[]'::json)`;

/**
 * The documents in a box, newest first.
 *
 * Newest first with no choice about it — a box is read the way the pile on the
 * table was read, from the top. `tagIds` narrows to documents carrying *all*
 * of them, so Tesco plus Fuel means both: a filter that widens as you add to
 * it is a filter you stop trusting.
 */
/**
 * The span a box actually covers, ignoring every filter.
 *
 * The range control's ends have to stay put while you drag them. Taking them
 * from the filtered rows would shrink the track under your hand — narrow the
 * range once and the ends close in, so you could never widen it again.
 */
export async function getBoxRange(
  boxId: string,
): Promise<{ from: Date; to: Date } | null> {
  const [row] = await db
    .select({
      from: sql<Date | null>`min(${boxItems.capturedAt})`,
      to: sql<Date | null>`max(${boxItems.capturedAt})`,
    })
    .from(boxItems)
    .where(eq(boxItems.boxId, boxId));

  if (!row?.from || !row?.to) return null;
  return { from: new Date(row.from), to: new Date(row.to) };
}

export async function getBoxItems(
  boxId: string,
  tagIds: string[] = [],
  /** Inclusive bounds on arrival, as whole days in the server's timezone. */
  range?: { from?: Date; to?: Date },
): Promise<BoxItemRow[]> {
  const rows = await db
    .select({
      id: boxItems.id,
      boxId: boxItems.boxId,
      kind: boxItems.kind,
      driveFileId: boxItems.driveFileId,
      name: boxItems.name,
      lat: boxItems.lat,
      lng: boxItems.lng,
      url: boxItems.url,
      imageUrl: boxItems.imageUrl,
      mimeType: boxItems.mimeType,
      sizeBytes: boxItems.sizeBytes,
      title: boxItems.title,
      description: boxItems.description,
      docDate: boxItems.docDate,
      status: boxItems.status,
      capturedAt: boxItems.capturedAt,
      tags: itemTags,
      linkCount: sql<number>`(
        select count(*)::int from ${boxItemLinks} l where l.item_id = ${boxItems.id}
      )`,
    })
    .from(boxItems)
    .where(
      and(
        eq(boxItems.boxId, boxId),
        tagIds.length === 0
          ? undefined
          : sql`(
              select count(distinct it.tag_id) from ${boxItemTags} it
              where it.item_id = ${boxItems.id}
                and it.tag_id in ${tagIds}
            ) = ${tagIds.length}`,
        range?.from ? sql`${boxItems.capturedAt} >= ${range.from}` : undefined,
        // The far end is a whole day: a range ending on the 14th has to
        // include everything filed *during* the 14th, not stop at midnight.
        range?.to ? sql`${boxItems.capturedAt} < ${endOfDay(range.to)}` : undefined,
      ),
    )
    .orderBy(desc(boxItems.capturedAt));

  return rows as BoxItemRow[];
}

export async function getBoxItem(id: string): Promise<BoxItemDetail | null> {
  const [row] = await db
    .select({
      id: boxItems.id,
      boxId: boxItems.boxId,
      boxName: boxes.name,
      kind: boxItems.kind,
      driveFileId: boxItems.driveFileId,
      name: boxItems.name,
      lat: boxItems.lat,
      lng: boxItems.lng,
      url: boxItems.url,
      imageUrl: boxItems.imageUrl,
      mimeType: boxItems.mimeType,
      sizeBytes: boxItems.sizeBytes,
      title: boxItems.title,
      description: boxItems.description,
      docDate: boxItems.docDate,
      text: boxItems.text,
      status: boxItems.status,
      capturedAt: boxItems.capturedAt,
      tags: itemTags,
      /** The last thing that went wrong, so a failed read can say why. */
      lastError: sql<string | null>`(
        select j.last_error from ${boxJobs} j
        where j.item_id = ${boxItems.id}
        order by j.created_at desc limit 1
      )`,
    })
    .from(boxItems)
    .innerJoin(boxes, eq(boxes.id, boxItems.boxId))
    .where(eq(boxItems.id, id))
    .limit(1);

  if (!row) return null;

  return { ...row, links: await getBoxItemLinks(id) } as BoxItemDetail;
}

/** What a document has been cited by — one row per project, action or item. */
export async function getBoxItemLinks(itemId: string): Promise<BoxLinkRow[]> {
  const rows = await db
    .select({
      parentType: boxItemLinks.parentType,
      parentId: boxItemLinks.parentId,
      // The title lives in whichever table the link points at. Three left
      // joins read better than a union here, and only one is ever non-null.
      projectTitle: projects.title,
      actionTitle: actions.title,
      listItemTitle: listItems.title,
    })
    .from(boxItemLinks)
    .leftJoin(projects, eq(projects.id, boxItemLinks.parentId))
    .leftJoin(actions, eq(actions.id, boxItemLinks.parentId))
    .leftJoin(listItems, eq(listItems.id, boxItemLinks.parentId))
    .where(eq(boxItemLinks.itemId, itemId))
    .orderBy(asc(boxItemLinks.createdAt));

  return rows.map((r) => ({
    parentType: r.parentType,
    parentId: r.parentId,
    title:
      r.parentType === 'project'
        ? r.projectTitle
        : r.parentType === 'action'
          ? r.actionTitle
          : r.listItemTitle,
  }));
}

/**
 * Documents cited by one project, action or list item.
 *
 * Shaped deliberately like `getAttachments`: a detail pane renders one list of
 * files, and it shouldn't have to care that some of them live in a box and are
 * only borrowed.
 */
export async function getLinkedDocuments(
  parentType: AttachmentParentType,
  parentId: string,
): Promise<LinkedDocumentRow[]> {
  const rows = await db
    .select({
      id: boxItems.id,
      boxId: boxItems.boxId,
      boxName: boxes.name,
      name: boxItems.name,
      title: boxItems.title,
      description: boxItems.description,
      mimeType: boxItems.mimeType,
      sizeBytes: boxItems.sizeBytes,
      driveFileId: boxItems.driveFileId,
      capturedAt: boxItems.capturedAt,
    })
    .from(boxItemLinks)
    .innerJoin(boxItems, eq(boxItems.id, boxItemLinks.itemId))
    .innerJoin(boxes, eq(boxes.id, boxItems.boxId))
    .where(
      and(
        eq(boxItemLinks.parentType, parentType),
        eq(boxItemLinks.parentId, parentId),
      ),
    )
    .orderBy(asc(boxItemLinks.createdAt));

  return rows as LinkedDocumentRow[];
}

/** Documents not yet cited by this thing, for the "link a document" picker. */
export async function getLinkableDocuments(
  parentType: AttachmentParentType,
  parentId: string,
  term: string,
  limit = 20,
): Promise<LinkedDocumentRow[]> {
  const query = term.trim();

  const rows = await db
    .select({
      id: boxItems.id,
      boxId: boxItems.boxId,
      boxName: boxes.name,
      name: boxItems.name,
      title: boxItems.title,
      description: boxItems.description,
      mimeType: boxItems.mimeType,
      sizeBytes: boxItems.sizeBytes,
      driveFileId: boxItems.driveFileId,
      capturedAt: boxItems.capturedAt,
    })
    .from(boxItems)
    .innerJoin(boxes, eq(boxes.id, boxItems.boxId))
    .where(
      and(
        sql`not exists (
          select 1 from ${boxItemLinks} l
          where l.item_id = ${boxItems.id}
            and l.parent_type = ${parentType}
            and l.parent_id = ${parentId}
        )`,
        // Empty term lists the most recent documents, which is the right
        // answer when you have just scanned the thing you are looking for.
        query === ''
          ? sql`true`
          : sql`${boxItems.searchVector} @@ websearch_to_tsquery('english', ${query})`,
      ),
    )
    .orderBy(desc(boxItems.capturedAt))
    .limit(limit);

  return rows as LinkedDocumentRow[];
}
