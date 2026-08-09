'use server';

import {
  actionContexts,
  actions,
  contexts,
  db,
  projects,
  type ActionStatus,
  type ContextDimension,
  type ProjectStatus,
} from '@gtd/db';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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

  const [project] = await db
    .update(projects)
    .set({
      status,
      // Clearing the reason on the way out keeps a stale condition from
      // reappearing if the project goes back on standby later.
      standbyReason: status === 'standby' ? reason : null,
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
