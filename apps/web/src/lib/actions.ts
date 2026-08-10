'use server';

import {
  actionContexts,
  actions,
  contexts,
  db,
  listItems,
  lists,
  projects,
  type ActionStatus,
  type ContextDimension,
  type ListType,
  type ProjectStatus,
} from '@gtd/db';
import type { PurchaseFields } from './queries.shared';
import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { VIEW_MODE_COOKIE, type ViewMode } from './view-mode';
import { googleSync } from './google/sync';
import { extractText } from './tiptap';

/**
 * Every mutation revalidates the whole shell: the sidebar counts, the stalled
 * flags and the Now list all derive from the same rows, so a narrower
 * invalidation would leave one of the three panes lying.
 */
function revalidateShell() {
  revalidatePath('/', 'layout');
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function createProject(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return;

  const areaId = (formData.get('areaId') as string) || null;

  const [project] = await db
    .insert(projects)
    .values({ title, areaId: areaId || null, status: 'active' })
    .returning();

  // One-way push to Google. Stubbed tonight — returns null, which leaves the
  // ID columns null rather than filling them with anything fake.
  const [driveFolderId, gmailLabelId] = await Promise.all([
    googleSync.createProjectFolder(project.id, title),
    googleSync.createGmailLabel(project.id, title),
  ]);

  if (driveFolderId || gmailLabelId) {
    await db
      .update(projects)
      .set({ driveFolderId, gmailLabelId })
      .where(eq(projects.id, project.id));
  }

  revalidateShell();
  redirect(`/projects/${project.id}`);
}

export async function updateProjectTitle(projectId: string, title: string) {
  const trimmed = title.trim();
  if (!trimmed) return;

  await db
    .update(projects)
    .set({ title: trimmed, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  revalidateShell();
}

/**
 * Status changes carry two rules from the brief: standby requires a return
 * condition, and the Drive/Gmail containers follow the status.
 */
export async function setProjectStatus(
  projectId: string,
  status: ProjectStatus,
  standbyReason?: string,
) {
  const reason = standbyReason?.trim() ?? '';

  if (status === 'standby' && !reason) {
    throw new Error('A standby project needs a return condition.');
  }

  const isArchived = status === 'completed' || status === 'dropped';

  const [existing] = await db
    .select({ completedAt: projects.completedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const [project] = await db
    .update(projects)
    .set({
      status,
      // Clearing the reason on the way out keeps a stale condition from
      // reappearing if the project goes back on standby later.
      standbyReason: status === 'standby' ? reason : null,
      // Stamp the finish date once, and clear it if the project is reopened.
      // Re-archiving an already-archived project keeps the original date
      // rather than resetting it on an unrelated status flip.
      completedAt: isArchived ? (existing?.completedAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();

  await googleSync.moveForStatus(project, status);

  revalidateShell();
}

export async function updateProjectNotes(projectId: string, notes: unknown) {
  await db
    .update(projects)
    .set({
      notes: notes as object,
      searchText: extractText(notes),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  // Notes autosave on a debounce; revalidating the shell on every keystroke
  // pause would be wasteful, and nothing outside the editor shows note text.
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteProject(projectId: string) {
  await db.delete(projects).where(eq(projects.id, projectId));
  revalidateShell();
  redirect('/projects');
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function createAction(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return;

  const projectId = (formData.get('projectId') as string) || null;

  await db.insert(actions).values({ title, projectId: projectId || null });

  revalidateShell();
}

export async function updateActionTitle(actionId: string, title: string) {
  const trimmed = title.trim();
  if (!trimmed) return;

  await db
    .update(actions)
    .set({ title: trimmed, updatedAt: new Date() })
    .where(eq(actions.id, actionId));

  revalidateShell();
}

/**
 * `waiting_since` is stamped on entry to waiting and cleared on the way out,
 * so the staleness surface can never show a date from a previous stint.
 */
export async function setActionStatus(actionId: string, status: ActionStatus) {
  await db
    .update(actions)
    .set({
      status,
      waitingSince: status === 'waiting' ? today() : null,
      completedAt: status === 'done' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(actions.id, actionId));

  revalidateShell();
}

/** Re-stamps a waiting item as chased today, clearing the stale flag. */
export async function nudgeWaiting(actionId: string) {
  await db
    .update(actions)
    .set({ waitingSince: today(), updatedAt: new Date() })
    .where(and(eq(actions.id, actionId), eq(actions.status, 'waiting')));

  revalidateShell();
}

export async function updateActionNotes(actionId: string, notes: unknown) {
  await db
    .update(actions)
    .set({
      notes: notes as object,
      searchText: extractText(notes),
      updatedAt: new Date(),
    })
    .where(eq(actions.id, actionId));
}

export async function deleteAction(actionId: string) {
  await db.delete(actions).where(eq(actions.id, actionId));
  revalidateShell();
}

export async function moveActionToProject(actionId: string, projectId: string | null) {
  await db
    .update(actions)
    .set({ projectId, updatedAt: new Date() })
    .where(eq(actions.id, actionId));

  revalidateShell();
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function setViewMode(mode: ViewMode) {
  const store = await cookies();
  store.set(VIEW_MODE_COOKIE, mode, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  revalidateShell();
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function createList(name: string, type: ListType) {
  const trimmed = name.trim();
  if (!trimmed) return;

  const [list] = await db.insert(lists).values({ name: trimmed, type }).returning();
  revalidateShell();
  redirect(`/lists/${list.id}`);
}

export async function createListItem(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  const listId = String(formData.get('listId') ?? '');
  if (!title || !listId) return;

  await db.insert(listItems).values({ listId, title });
  revalidateShell();
}

export async function updateListItemTitle(itemId: string, title: string) {
  const trimmed = title.trim();
  if (!trimmed) return;

  await db.update(listItems).set({ title: trimmed }).where(eq(listItems.id, itemId));
  revalidateShell();
}

/** Merges into `fields` rather than replacing, so one control can't wipe another. */
export async function updateListItemFields(itemId: string, patch: PurchaseFields) {
  const [existing] = await db
    .select({ fields: listItems.fields })
    .from(listItems)
    .where(eq(listItems.id, itemId))
    .limit(1);

  const merged = { ...((existing?.fields as PurchaseFields) ?? {}), ...patch };

  // An explicit undefined means "clear this field".
  for (const key of Object.keys(patch) as (keyof PurchaseFields)[]) {
    if (patch[key] === undefined) delete merged[key];
  }

  await db.update(listItems).set({ fields: merged }).where(eq(listItems.id, itemId));
  revalidateShell();
}

export async function setListItemProject(itemId: string, projectId: string | null) {
  await db.update(listItems).set({ projectId }).where(eq(listItems.id, itemId));
  revalidateShell();
}

/**
 * Promote a candidate into a real commitment.
 *
 * This is the one moment a list item becomes work: it spawns an action and
 * records `promoted_action_id`. Nothing on a list counts as a commitment —
 * or, for purchases, as committed spend — until this happens.
 */
export async function promoteListItem(itemId: string) {
  const [item] = await db
    .select({
      id: listItems.id,
      title: listItems.title,
      listId: listItems.listId,
      projectId: listItems.projectId,
      promotedActionId: listItems.promotedActionId,
    })
    .from(listItems)
    .where(eq(listItems.id, itemId))
    .limit(1);

  if (!item || item.promotedActionId) return; // already promoted — no double-spawn

  const [list] = await db
    .select({ type: lists.type })
    .from(lists)
    .where(eq(lists.id, item.listId))
    .limit(1);

  const title = list?.type === 'purchases' ? `Buy ${item.title}` : item.title;

  const [action] = await db
    .insert(actions)
    .values({ title, projectId: item.projectId })
    .returning();

  await db
    .update(listItems)
    .set({ promotedActionId: action.id })
    .where(eq(listItems.id, itemId));

  revalidateShell();
}

/** Detach from the spawned action without deleting the action itself. */
export async function unpromoteListItem(itemId: string) {
  await db
    .update(listItems)
    .set({ promotedActionId: null })
    .where(eq(listItems.id, itemId));

  revalidateShell();
}

export async function deleteListItem(itemId: string) {
  await db.delete(listItems).where(eq(listItems.id, itemId));
  revalidateShell();
}

export async function moveListItemBetween(
  itemId: string,
  prevId: string | null,
  nextId: string | null,
) {
  const { prev, next } = await neighbourPositions(listItems, prevId, nextId);

  await db
    .update(listItems)
    .set({ position: positionBetween(prev, next) })
    .where(eq(listItems.id, itemId));

  revalidateShell();
}

// ---------------------------------------------------------------------------
// Manual ordering
// ---------------------------------------------------------------------------

const POSITION_GAP = 1000;

/**
 * Given the positions of the neighbours an item was dropped between, return
 * the position it should take.
 *
 * Deliberately midpoint-based rather than renumbering the list: the caller
 * may be looking at a filtered view (the Now list showing 3 of 40 actions),
 * and the midpoint of two *visible* neighbours is still correct globally.
 */
function positionBetween(prev: number | null, next: number | null): number {
  if (prev !== null && next !== null) return (prev + next) / 2;
  if (prev !== null) return prev + POSITION_GAP;
  if (next !== null) return next - POSITION_GAP;
  return POSITION_GAP;
}

async function neighbourPositions(
  table: typeof actions | typeof projects | typeof listItems,
  prevId: string | null,
  nextId: string | null,
) {
  const ids = [prevId, nextId].filter((id): id is string => id !== null);
  if (ids.length === 0) return { prev: null, next: null };

  const rows = await db
    .select({ id: table.id, position: table.position })
    .from(table)
    .where(inArray(table.id, ids));

  const at = (id: string | null) =>
    id === null ? null : (rows.find((r) => r.id === id)?.position ?? null);

  return { prev: at(prevId), next: at(nextId) };
}

/**
 * Reorder an action. `prevId` / `nextId` are the rows it was dropped between
 * as the user saw them — either may be null at the ends of the list.
 */
export async function moveActionBetween(
  actionId: string,
  prevId: string | null,
  nextId: string | null,
) {
  const { prev, next } = await neighbourPositions(actions, prevId, nextId);

  await db
    .update(actions)
    .set({ position: positionBetween(prev, next), updatedAt: new Date() })
    .where(eq(actions.id, actionId));

  revalidateShell();
}

export async function moveProjectBetween(
  projectId: string,
  prevId: string | null,
  nextId: string | null,
) {
  const { prev, next } = await neighbourPositions(projects, prevId, nextId);

  await db
    .update(projects)
    .set({ position: positionBetween(prev, next), updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  revalidateShell();
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

export async function toggleActionContext(actionId: string, contextId: string) {
  const existing = await db
    .select()
    .from(actionContexts)
    .where(
      and(eq(actionContexts.actionId, actionId), eq(actionContexts.contextId, contextId)),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .delete(actionContexts)
      .where(
        and(
          eq(actionContexts.actionId, actionId),
          eq(actionContexts.contextId, contextId),
        ),
      );
  } else {
    await db.insert(actionContexts).values({ actionId, contextId });
  }

  revalidateShell();
}

export async function createContext(name: string, dimension: ContextDimension) {
  const trimmed = name.trim();
  if (!trimmed) return;

  await db.insert(contexts).values({ name: trimmed, dimension });
  revalidateShell();
}
