import 'server-only';

import {
  actionContexts,
  actions,
  areasOfFocus,
  contexts,
  db,
  goals,
  listItems,
  lists,
  projects,
} from '@gtd/db';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  ActionRow,
  ListItemRow,
  ListRow,
  ProjectRow,
  PurchaseFields,
} from './queries.shared';
import { isStalled, stageOf } from './queries.shared';

export type {
  ActionRow,
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

const actionSelect = {
  id: actions.id,
  title: actions.title,
  status: actions.status,
  waitingSince: actions.waitingSince,
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
    .where(eq(actions.status, 'waiting'))
    .orderBy(sql`${actions.position} asc nulls last`, asc(actions.waitingSince));

  return attachContexts(rows);
}

/** Projects with their open-action counts. */
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
      areaName: areasOfFocus.name,
      nextActionCount: sql<number>`coalesce(${nextCounts.n}, 0)::int`,
      waitingCount: sql<number>`coalesce(${waitingCounts.n}, 0)::int`,
    })
    .from(projects)
    .leftJoin(areasOfFocus, eq(areasOfFocus.id, projects.areaId))
    .leftJoin(nextCounts, eq(nextCounts.projectId, projects.id))
    .leftJoin(waitingCounts, eq(waitingCounts.projectId, projects.id))
    .orderBy(
      asc(projects.status),
      sql`${projects.position} asc nulls last`,
      asc(projects.title),
    );

  return rows;
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
      notes: actions.notes,
      projectId: actions.projectId,
      projectTitle: projects.title,
      createdAt: actions.createdAt,
    })
    .from(actions)
    .leftJoin(projects, eq(projects.id, actions.projectId))
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

export async function getAreasAndGoals() {
  const [areaRows, goalRows] = await Promise.all([
    db.select().from(areasOfFocus).orderBy(asc(areasOfFocus.name)),
    db.select().from(goals).orderBy(asc(goals.title)),
  ]);
  return { areas: areaRows, goals: goalRows };
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

  const [unfiledRow] = await db
    .select({ n: count() })
    .from(actions)
    .where(and(isNull(actions.projectId), inArray(actions.status, ['next', 'waiting'])));

  const projectRows = await getProjects();

  return {
    next: nextRow?.n ?? 0,
    waiting: waitingRow?.n ?? 0,
    projects: projectRows.filter((p) => p.status === 'active').length,
    stalled: projectRows.filter(isStalled).length,
    unfiled: unfiledRow?.n ?? 0,
  };
}
