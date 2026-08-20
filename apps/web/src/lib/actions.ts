'use server';

import {
  SINGLETON,
  actionContexts,
  actions,
  areasOfFocus,
  attachments,
  boxCategories,
  boxItemLinks,
  boxItemTags,
  boxItems,
  boxTags,
  boxes,
  contexts,
  db,
  goals,
  inboxItems,
  listItems,
  lists,
  preferences,
  projects,
  reviews,
  type ActionStatus,
  type AttachmentParentType,
  type ContextDimension,
  type InboxRawType,
  type ListType,
  type ProjectStatus,
} from '@gtd/db';
import type { PurchaseFields } from './queries.shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  MAX_PANE_WIDTH,
  MIN_PANE_WIDTH,
  type BoxView,
  type ViewMode,
} from './pane';
import { suggester } from './ai/suggest';
import { requireSession } from './auth/session';
import type { ReviewStep } from './review';
import {
  createGoogleDocument,
  removeAttachment,
} from './google/attachments';
import { deleteBoxItem } from './google/boxes';
import { enqueueSync } from './google/queue';
import { enqueueBoxJob, requeueBoxItem } from './box/queue';
import { docFromText, extractText } from './tiptap';

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
  await requireSession();
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return;

  const areaId = (formData.get('areaId') as string) || null;

  const [project] = await db
    .insert(projects)
    .values({ title, areaId: areaId || null, status: 'active' })
    .returning();

  // Queued, not called: Drive and Gmail are slow and a serverless request
  // must not wait on them. The worker fills in the IDs shortly after.
  await enqueueSync('create_project_links', project.id);

  revalidateShell();
  redirect(`/projects/${project.id}`);
}

export async function updateProjectTitle(projectId: string, title: string) {
  await requireSession();
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
  await requireSession();
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

  await enqueueSync('move_project_links', project.id);

  revalidateShell();
}

export async function updateProjectNotes(projectId: string, notes: unknown) {
  await requireSession();
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
  await requireSession();
  await db.delete(projects).where(eq(projects.id, projectId));
  revalidateShell();
  redirect('/projects');
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function createAction(formData: FormData) {
  await requireSession();
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return;

  const projectId = (formData.get('projectId') as string) || null;

  await db.insert(actions).values({ title, projectId: projectId || null });

  revalidateShell();
}

export async function updateActionTitle(actionId: string, title: string) {
  await requireSession();
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
  await requireSession();
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

/**
 * Complete an action and name the one that follows it, in a single step.
 *
 * The successor is a new row rather than a rename, so the thing you finished
 * stays in the record and the follow-up gets a genuinely fresh creation date —
 * a renamed row would carry the age of the step before it and read as stale
 * immediately. Project and contexts carry across, because the follow-up is
 * almost always doable in the same circumstances.
 */
export async function turnIntoNextAction(actionId: string, nextTitle: string) {
  await requireSession();

  const title = nextTitle.trim();
  if (!title) return;

  const [current] = await db
    .select({
      id: actions.id,
      projectId: actions.projectId,
      position: actions.position,
    })
    .from(actions)
    .where(eq(actions.id, actionId))
    .limit(1);

  if (!current) return;

  const [successor] = await db
    .insert(actions)
    .values({
      title,
      projectId: current.projectId,
      status: 'next',
      // Sits where the finished one sat, so the list doesn't reshuffle.
      position: current.position,
    })
    .returning({ id: actions.id });

  const carried = await db
    .select({ contextId: actionContexts.contextId })
    .from(actionContexts)
    .where(eq(actionContexts.actionId, actionId));

  if (carried.length > 0) {
    await db
      .insert(actionContexts)
      .values(carried.map((c) => ({ actionId: successor.id, contextId: c.contextId })));
  }

  await db
    .update(actions)
    .set({ status: 'done', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(actions.id, actionId));

  revalidateShell();
  return successor.id;
}

/**
 * Resolve a typed name to a person context, reusing an existing one whenever
 * it plausibly means the same party.
 *
 * The match is case- and whitespace-insensitive, so "neil" finds "Neil" and a
 * stray trailing space doesn't mint a second row. This is the whole point of
 * the feature: without it you end up chasing three different Neils.
 */
async function resolveParty(name: string): Promise<string | null> {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;

  const [existing] = await db
    .select({ id: contexts.id })
    .from(contexts)
    .where(
      and(
        eq(contexts.dimension, 'person'),
        sql`lower(${contexts.name}) = lower(${trimmed})`,
      ),
    )
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(contexts)
    .values({ name: trimmed, dimension: 'person' })
    .returning({ id: contexts.id });

  return created.id;
}

/**
 * Set who an action is waiting on. Accepts a typed name; an empty string
 * clears it.
 */
export async function setWaitingOn(actionId: string, name: string) {
  await requireSession();

  const waitingOnId = await resolveParty(name);

  await db
    .update(actions)
    .set({ waitingOnId, updatedAt: new Date() })
    .where(eq(actions.id, actionId));

  revalidateShell();
}

/** Re-stamps a waiting item as chased today, clearing the stale flag. */
export async function nudgeWaiting(actionId: string) {
  await requireSession();
  await db
    .update(actions)
    .set({ waitingSince: today(), updatedAt: new Date() })
    .where(and(eq(actions.id, actionId), eq(actions.status, 'waiting')));

  revalidateShell();
}

export async function updateActionNotes(actionId: string, notes: unknown) {
  await requireSession();
  await db
    .update(actions)
    .set({
      notes: notes as object,
      searchText: extractText(notes),
      updatedAt: new Date(),
    })
    .where(eq(actions.id, actionId));
}

/**
 * A list item's notes. Same shape as the project and action versions — it
 * gained a notes column when captures started carrying one, and a note you can
 * write at capture time but never edit afterwards would be a strange half.
 */
export async function updateListItemNotes(listItemId: string, notes: unknown) {
  await requireSession();
  await db
    .update(listItems)
    .set({ notes: notes as object, searchText: extractText(notes) })
    .where(eq(listItems.id, listItemId));
}

export async function deleteAction(actionId: string) {
  await requireSession();
  await db.delete(actions).where(eq(actions.id, actionId));
  revalidateShell();
}

export async function moveActionToProject(actionId: string, projectId: string | null) {
  await requireSession();
  await db
    .update(actions)
    .set({ projectId, updatedAt: new Date() })
    .where(eq(actions.id, actionId));

  revalidateShell();
}

// ---------------------------------------------------------------------------
// Weekly review
// ---------------------------------------------------------------------------

export async function startReview() {
  await requireSession();
  const [existing] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(isNull(reviews.completedAt))
    .limit(1);

  // Resume rather than starting a second one — two open reviews would make
  // "reviewed in this session" ambiguous.
  if (!existing) {
    await db.insert(reviews).values({ step: 'inbox' });
  }

  revalidateShell();
  redirect('/review');
}

export async function setReviewStep(reviewId: string, step: ReviewStep) {
  await requireSession();
  await db.update(reviews).set({ step }).where(eq(reviews.id, reviewId));
  revalidateShell();
}

export async function completeReview(reviewId: string) {
  await requireSession();
  await db
    .update(reviews)
    .set({ completedAt: new Date(), step: 'done' })
    .where(eq(reviews.id, reviewId));

  revalidateShell();
}

/** Abandon without recording it as done — nothing else is undone. */
export async function abandonReview(reviewId: string) {
  await requireSession();
  await db.delete(reviews).where(eq(reviews.id, reviewId));
  revalidateShell();
  redirect('/review');
}

export async function markProjectReviewed(projectId: string, reviewed: boolean) {
  await requireSession();
  await db
    .update(projects)
    .set({ lastReviewedAt: reviewed ? new Date() : null })
    .where(eq(projects.id, projectId));

  revalidateShell();
}

export async function markActionReviewed(actionId: string, reviewed: boolean) {
  await requireSession();
  await db
    .update(actions)
    .set({ lastReviewedAt: reviewed ? new Date() : null })
    .where(eq(actions.id, actionId));

  revalidateShell();
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

/**
 * Capture. Zero required fields, no classification — deciding what something
 * is happens later, at clarify time. Enrichment runs after the row exists so a
 * slow suggester can never delay a capture.
 *
 * Returns the new id because the files, if there are any, go up separately to
 * `POST /api/attachments` against this row: a Server Action caps its request
 * body at 1 MB and is the wrong shape for bytes. So the row is written first
 * and the artefact arrives a moment later — which is also the right order for
 * capture, since the thought is safe before the upload can fail.
 *
 * `rawType` is a hint from the client, which is the only side that knows what
 * it is about to send.
 */
export async function captureInboxItem(
  formData: FormData,
): Promise<{ id: string } | null> {
  await requireSession();
  const rawText = String(formData.get('rawText') ?? '').trim();
  const hinted = String(formData.get('rawType') ?? 'text');
  const rawType: InboxRawType =
    hinted === 'photo' || hinted === 'audio' ? hinted : 'text';

  // A photo or a recording is a capture on its own — the note beside it is
  // optional. Only a text capture needs words.
  if (!rawText && rawType === 'text') return null;

  const [item] = await db
    .insert(inboxItems)
    .values({ rawType, rawText: rawText || null })
    .returning();

  revalidateShell();

  // Nothing to suggest from yet when the capture is a photo with no note. The
  // file hasn't been read at that point either — enrichment happens in the
  // worker, minutes or hours later, long after this request is gone.
  if (!rawText) return { id: item.id };

  // Best-effort suggestion. A failure here must not lose the capture, which
  // is already safely stored above.
  try {
    const [projectRows, contextRows] = await Promise.all([
      db
        .select({ id: projects.id, title: projects.title })
        .from(projects)
        .where(inArray(projects.status, ['active', 'standby', 'someday'])),
      db.select({ id: contexts.id, name: contexts.name }).from(contexts),
    ]);

    const suggestion = await suggester.suggest({
      rawText,
      projects: projectRows,
      contexts: contextRows,
    });

    if (suggestion) {
      await db
        .update(inboxItems)
        .set({ aiSuggestion: suggestion })
        .where(eq(inboxItems.id, item.id));
      revalidateShell();
    }
  } catch (error) {
    console.error('[inbox] suggestion failed, capture kept', error);
  }

  return { id: item.id };
}

/**
 * `note` is the rest of the capture — everything after the first line.
 *
 * It used to go nowhere. Clarify took line one as the title and left the rest
 * on the capture, so the sentence explaining *why* you wrote something down
 * was dropped at exactly the moment it became a real commitment. It is written
 * into the outcome's `notes` instead, as plain paragraphs the note editor can
 * open and add to.
 */
type WithNote = { note: string };

export type ClarifyDecision =
  | ({
      kind: 'next_action' | 'waiting' | 'done';
      title: string;
      projectId: string | null;
      contextIds: string[];
    } & WithNote)
  | ({ kind: 'project'; title: string; areaId: string | null } & WithNote)
  | ({ kind: 'list_item'; title: string; listId: string } & WithNote)
  | { kind: 'trashed' };

/**
 * The note as a stored document, plus the flattened copy search reads.
 *
 * `search_text` is not optional: `search_vector` is generated from it, so
 * writing `notes` without it silently removes the row's body from search.
 */
function noteColumns(note: string) {
  const text = note.trim();
  if (!text) return { notes: null, searchText: null };

  const doc = docFromText(text);
  return { notes: doc, searchText: extractText(doc) };
}

/**
 * Clarify a capture into something real.
 *
 * The raw row is never edited or deleted — it's marked clarified and stamped
 * with what it became. That's the brief's immutability rule: the original
 * capture stays the record of what you actually thought, and everything else
 * is a layer on top.
 */
export async function clarifyInboxItem(itemId: string, decision: ClarifyDecision) {
  await requireSession();
  const [item] = await db
    .select({ id: inboxItems.id, status: inboxItems.status })
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  if (!item || item.status === 'clarified') return; // no double-processing

  let outcomeId: string | null = null;

  if (decision.kind === 'project') {
    const title = decision.title.trim();
    if (!title) return;

    const [project] = await db
      .insert(projects)
      .values({
        title,
        areaId: decision.areaId,
        status: 'active',
        ...noteColumns(decision.note),
      })
      .returning();
    outcomeId = project.id;

    await enqueueSync('create_project_links', project.id);
  } else if (decision.kind === 'list_item') {
    const title = decision.title.trim();
    if (!title) return;

    const [listItem] = await db
      .insert(listItems)
      .values({ listId: decision.listId, title, ...noteColumns(decision.note) })
      .returning();
    outcomeId = listItem.id;
  } else if (decision.kind !== 'trashed') {
    const title = decision.title.trim();
    if (!title) return;

    // The clarify vocabulary and the action-status vocabulary differ on one
    // word: "next action" is the GTD term, `next` is the column value.
    const status: ActionStatus =
      decision.kind === 'next_action' ? 'next' : decision.kind;

    const [action] = await db
      .insert(actions)
      .values({
        title,
        projectId: decision.projectId,
        status,
        waitingSince: status === 'waiting' ? today() : null,
        completedAt: status === 'done' ? new Date() : null,
        ...noteColumns(decision.note),
      })
      .returning();
    outcomeId = action.id;

    if (decision.contextIds.length > 0) {
      await db.insert(actionContexts).values(
        decision.contextIds.map((contextId) => ({
          actionId: action.id,
          contextId,
        })),
      );
    }
  }

  // The photo *is* the thing you captured, so it follows the decision to
  // whatever the capture became — a photographed book spine belongs on the
  // list item it turned into, not stranded on a clarified inbox row nobody
  // opens again. The raw capture stays immutable either way: it keeps its
  // text and now points at the outcome that holds the file.
  //
  // Trashed is the exception. Deliberately dropping something shouldn't strand
  // its file on nothing, so the attachment stays on the capture — which keeps
  // the evidence intact, and keeps the Drive file recoverable.
  if (outcomeId && decision.kind !== 'trashed') {
    await db
      .update(attachments)
      .set({ parentType: PARENT_FOR_OUTCOME[decision.kind], parentId: outcomeId })
      .where(
        and(
          eq(attachments.parentType, 'inbox_item'),
          eq(attachments.parentId, itemId),
        ),
      );
  }

  await db
    .update(inboxItems)
    .set({
      status: 'clarified',
      outcome: decision.kind,
      outcomeId,
      clarifiedAt: new Date(),
    })
    .where(eq(inboxItems.id, itemId));

  revalidateShell();
}

/**
 * Which attachment parent a clarify decision produces.
 *
 * `trashed` never gets here — it has no outcome row to hang a file off — and
 * the three action-shaped decisions all produce an action.
 */
const PARENT_FOR_OUTCOME: Record<
  Exclude<ClarifyDecision['kind'], 'trashed'>,
  AttachmentParentType
> = {
  next_action: 'action',
  waiting: 'action',
  done: 'action',
  project: 'project',
  list_item: 'list_item',
};

// ---------------------------------------------------------------------------
// Areas of focus and goals
// ---------------------------------------------------------------------------

export async function createArea(name: string) {
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return;

  const [area] = await db.insert(areasOfFocus).values({ name: trimmed }).returning();
  revalidateShell();
  redirect(`/areas?area=${area.id}`);
}

export async function updateArea(areaId: string, name: string) {
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return;

  await db
    .update(areasOfFocus)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(areasOfFocus.id, areaId));

  revalidateShell();
}

/**
 * Projects and goals reference an area with `on delete set null`, so deleting
 * an area orphans them rather than destroying them. That's deliberate: an area
 * is a lens on work, not its owner.
 */
export async function deleteArea(areaId: string) {
  await requireSession();
  await db.delete(areasOfFocus).where(eq(areasOfFocus.id, areaId));
  revalidateShell();
  redirect('/areas');
}

export async function createGoal(areaId: string | null, title: string) {
  await requireSession();
  const trimmed = title.trim();
  if (!trimmed) return;

  const [goal] = await db
    .insert(goals)
    .values({ title: trimmed, areaId })
    .returning();

  revalidateShell();
  redirect(`/areas?goal=${goal.id}`);
}

export async function updateGoal(
  goalId: string,
  patch: { title?: string; targetDate?: string | null; areaId?: string | null },
) {
  await requireSession();
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (patch.title !== undefined) {
    const trimmed = patch.title.trim();
    if (!trimmed) return;
    set.title = trimmed;
  }
  if (patch.targetDate !== undefined) set.targetDate = patch.targetDate || null;
  if (patch.areaId !== undefined) set.areaId = patch.areaId;

  await db.update(goals).set(set).where(eq(goals.id, goalId));
  revalidateShell();
}

export async function deleteGoal(goalId: string) {
  await requireSession();
  await db.delete(goals).where(eq(goals.id, goalId));
  revalidateShell();
  redirect('/areas');
}

/**
 * Reassign a project's horizon parents.
 *
 * A goal belongs to an area, so moving a project to a different area drops a
 * goal that no longer sits under it — otherwise the project would claim a goal
 * from an area it isn't in.
 */
export async function setProjectParent(
  projectId: string,
  areaId: string | null,
  goalId: string | null,
) {
  await requireSession();
  let resolvedGoalId = goalId;

  if (goalId) {
    const [goal] = await db
      .select({ areaId: goals.areaId })
      .from(goals)
      .where(eq(goals.id, goalId))
      .limit(1);

    if (!goal || (goal.areaId && goal.areaId !== areaId)) resolvedGoalId = null;
  }

  await db
    .update(projects)
    .set({ areaId, goalId: resolvedGoalId, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  revalidateShell();
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/** Upsert onto the single preferences row. */
async function savePreference(patch: {
  viewMode?: ViewMode;
  boxView?: BoxView;
  listPaneWidth?: number;
  theme?: 'light' | 'dark' | null;
}) {
  await db
    .insert(preferences)
    .values({ id: SINGLETON, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: preferences.id,
      set: { ...patch, updatedAt: new Date() },
    });
}

/** List or gallery, for every box. One choice, like the density. */
export async function setBoxView(view: BoxView) {
  await requireSession();
  await savePreference({ boxView: view });
  revalidateShell();
}

export async function setViewMode(mode: ViewMode) {
  await requireSession();
  await savePreference({ viewMode: mode });
  revalidateShell();
}

/**
 * Called once on pointer-up, not during the drag — the pane follows the cursor
 * locally, and only the final width is written.
 */
export async function setListPaneWidth(width: number) {
  await requireSession();
  const clamped = Math.round(
    Math.min(MAX_PANE_WIDTH, Math.max(MIN_PANE_WIDTH, width)),
  );
  await savePreference({ listPaneWidth: clamped });
  revalidateShell();
}

/**
 * Light or dark, stored like every other UI preference: in the database, so
 * the server can render the right one on the first paint and so the choice
 * follows the account rather than the browser.
 */
export async function setTheme(theme: 'light' | 'dark') {
  await requireSession();
  await savePreference({ theme });
  revalidateShell();
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function createList(name: string, type: ListType) {
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return;

  const [list] = await db.insert(lists).values({ name: trimmed, type }).returning();
  revalidateShell();
  redirect(`/lists/${list.id}`);
}

export async function createListItem(formData: FormData) {
  await requireSession();
  const title = String(formData.get('title') ?? '').trim();
  const listId = String(formData.get('listId') ?? '');
  if (!title || !listId) return;

  await db.insert(listItems).values({ listId, title });
  revalidateShell();
}

export async function updateListItemTitle(itemId: string, title: string) {
  await requireSession();
  const trimmed = title.trim();
  if (!trimmed) return;

  await db.update(listItems).set({ title: trimmed }).where(eq(listItems.id, itemId));
  revalidateShell();
}

/** Merges into `fields` rather than replacing, so one control can't wipe another. */
export async function updateListItemFields(itemId: string, patch: PurchaseFields) {
  await requireSession();
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
  await requireSession();
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
  await requireSession();
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
  await requireSession();
  await db
    .update(listItems)
    .set({ promotedActionId: null })
    .where(eq(listItems.id, itemId));

  revalidateShell();
}

export async function deleteListItem(itemId: string) {
  await requireSession();
  await db.delete(listItems).where(eq(listItems.id, itemId));
  revalidateShell();
}

export async function moveListItemBetween(
  itemId: string,
  prevId: string | null,
  nextId: string | null,
) {
  await requireSession();
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
  await requireSession();
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
  await requireSession();
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
  await requireSession();
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
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return;

  // Same name twice in one dimension would be indistinguishable in the filter
  // bar, so quietly reuse rather than creating a confusing duplicate.
  const [existing] = await db
    .select({ id: contexts.id })
    .from(contexts)
    .where(and(eq(contexts.dimension, dimension), eq(contexts.name, trimmed)))
    .limit(1);

  if (!existing) await db.insert(contexts).values({ name: trimmed, dimension });

  revalidateShell();
}

export async function renameContext(contextId: string, name: string) {
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return;

  await db.update(contexts).set({ name: trimmed }).where(eq(contexts.id, contextId));
  revalidateShell();
}

/**
 * Deleting a context removes it from every action that carried it —
 * `action_contexts` cascades. The actions themselves are untouched; they just
 * lose that tag, which is why the UI shows the usage count first.
 */
export async function deleteContext(contextId: string) {
  await requireSession();
  await db.delete(contexts).where(eq(contexts.id, contextId));
  revalidateShell();
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Detach a file. The upload itself goes through `/api/attachments` — a Server
 * Action's body limit makes it the wrong door for bytes — but removal is an
 * ordinary mutation and belongs here with the rest.
 */
/**
 * Make a Google Doc or Sheet against something. Returns the row so the caller
 * can open it in the preview pane straight away — creating a document and then
 * making you go and find it would be a strange way round.
 */
export async function createDocument(
  parentType: AttachmentParentType,
  parentId: string,
  mimeType: string,
  name: string,
) {
  await requireSession();
  const row = await createGoogleDocument(parentType, parentId, mimeType, name);
  revalidateShell();
  return row;
}

export async function detachAttachment(attachmentId: string) {
  await requireSession();
  await removeAttachment(attachmentId);
  revalidateShell();
}

// ---------------------------------------------------------------------------
// The Big Box
// ---------------------------------------------------------------------------

/**
 * Set the Big Box up: one default box called Feed.
 *
 * Deliberately a button rather than something that happens on first render.
 * It creates a folder in someone's Drive, and the app's standing rule is that
 * it doesn't do that quietly — the same reason `backfillProjectLinks` is a
 * button on the connections page.
 */
export async function createDefaultBox() {
  await requireSession();

  const [existing] = await db
    .select({ id: boxes.id })
    .from(boxes)
    .where(eq(boxes.isDefault, true))
    .limit(1);

  if (existing) return existing.id;

  const [row] = await db
    .insert(boxes)
    .values({
      name: 'Feed',
      isDefault: true,
      instruction:
        'Documents of every kind from one person’s life — letters, bills, ' +
        'notices, contracts, manuals. Read the document and tag it with ' +
        'whichever of the categories below genuinely apply.',
    })
    .returning({ id: boxes.id });

  revalidateShell();
  return row.id;
}

export async function createBox(name: string, instruction: string) {
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return null;

  const [row] = await db
    .insert(boxes)
    .values({ name: trimmed, instruction: instruction.trim() })
    .returning({ id: boxes.id });

  revalidateShell();
  return row.id;
}

/**
 * Renaming writes one row and stops.
 *
 * The Drive folder is renamed to match by `ensureBoxFolder`, the next time a
 * document is filed here — a rename must not sit waiting on Google, and there
 * is no sensible queue for it: `sync_jobs` is keyed on a project.
 */
export async function updateBox(
  boxId: string,
  name: string,
  instruction: string,
  rules: string,
) {
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return;

  await db
    .update(boxes)
    .set({
      name: trimmed,
      instruction: instruction.trim(),
      rules: rules.trim(),
      updatedAt: new Date(),
    })
    .where(eq(boxes.id, boxId));

  revalidateShell();
}

/**
 * Delete a box and refile everything in it into the default one.
 *
 * The documents are the point; the box is only how they were grouped. Losing a
 * year of receipts because a category turned out to be a bad idea would be the
 * app deciding something it has no business deciding — so the box goes, its
 * categories and tags go with it (which drops those tags off the documents,
 * hence the usage count in the UI), and every document lands in the Feed.
 *
 * The default box itself can't be deleted: it is where everything else falls
 * back to, and a Big Box with no big box is not a state worth having.
 */
export async function deleteBox(boxId: string) {
  await requireSession();

  const [box] = await db
    .select({ isDefault: boxes.isDefault })
    .from(boxes)
    .where(eq(boxes.id, boxId))
    .limit(1);

  if (!box || box.isDefault) return;

  const [fallback] = await db
    .select({ id: boxes.id })
    .from(boxes)
    .where(eq(boxes.isDefault, true))
    .limit(1);

  if (!fallback) return;

  // Two statements rather than a transaction — the neon-http driver has none.
  // The order is the safeguard: the documents move first, so a failure before
  // the second leaves an empty box you can delete again, and the `restrict`
  // foreign key makes the reverse order impossible rather than merely unwise.
  await db
    .update(boxItems)
    .set({ boxId: fallback.id, updatedAt: new Date() })
    .where(eq(boxItems.boxId, boxId));

  // Categories and tags cascade, and `box_item_tags` with them. The documents
  // keep everything that was theirs — name, summary, date, file.
  await db.delete(boxes).where(eq(boxes.id, boxId));

  revalidateShell();
}

export async function createBoxCategory(
  boxId: string,
  name: string,
  allowNewTags: boolean,
) {
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return;

  await db.insert(boxCategories).values({ boxId, name: trimmed, allowNewTags });
  revalidateShell();
}

export async function updateBoxCategory(
  categoryId: string,
  name: string,
  allowNewTags: boolean,
) {
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return;

  await db
    .update(boxCategories)
    .set({ name: trimmed, allowNewTags })
    .where(eq(boxCategories.id, categoryId));

  revalidateShell();
}

export async function deleteBoxCategory(categoryId: string) {
  await requireSession();
  await db.delete(boxCategories).where(eq(boxCategories.id, categoryId));
  revalidateShell();
}

/**
 * Add an allowed tag.
 *
 * Quietly reuses an existing one that differs only in case: the unique index
 * would refuse it anyway, and "Tesco already exists" is not a useful thing to
 * say to someone who just typed "tesco" meaning the same shop.
 */
export async function createBoxTag(categoryId: string, name: string) {
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return;

  await db
    .insert(boxTags)
    .values({ categoryId, name: trimmed })
    .onConflictDoNothing();

  revalidateShell();
}

export async function renameBoxTag(tagId: string, name: string) {
  await requireSession();
  const trimmed = name.trim();
  if (!trimmed) return;

  await db.update(boxTags).set({ name: trimmed }).where(eq(boxTags.id, tagId));
  revalidateShell();
}

/**
 * Deleting a tag removes it from every document that carried it —
 * `box_item_tags` cascades — which is why the editor shows the usage count
 * before offering it.
 */
export async function deleteBoxTag(tagId: string) {
  await requireSession();
  await db.delete(boxTags).where(eq(boxTags.id, tagId));
  revalidateShell();
}

/** Add or remove a tag by hand. The model proposes; you decide. */
export async function toggleDocumentTag(itemId: string, tagId: string) {
  await requireSession();

  const existing = await db
    .select({ itemId: boxItemTags.itemId })
    .from(boxItemTags)
    .where(and(eq(boxItemTags.itemId, itemId), eq(boxItemTags.tagId, tagId)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .delete(boxItemTags)
      .where(and(eq(boxItemTags.itemId, itemId), eq(boxItemTags.tagId, tagId)));
  } else {
    await db.insert(boxItemTags).values({ itemId, tagId }).onConflictDoNothing();
  }

  revalidateShell();
}

/**
 * Correct what the model wrote.
 *
 * The transcription underneath is left alone: it is what the document says,
 * not what we think of it. Only the title and summary are editable, and
 * `search_text` is rewritten alongside because the vector is generated from it.
 */
export async function updateDocument(
  itemId: string,
  title: string,
  description: string,
) {
  await requireSession();

  const [row] = await db
    .select({ text: boxItems.text })
    .from(boxItems)
    .where(eq(boxItems.id, itemId))
    .limit(1);

  await db
    .update(boxItems)
    .set({
      title: title.trim() || null,
      description: description.trim() || null,
      searchText: [description.trim(), row?.text ?? '']
        .filter(Boolean)
        .join('\n')
        .slice(0, 100_000),
      updatedAt: new Date(),
    })
    .where(eq(boxItems.id, itemId));

  revalidateShell();
}

/**
 * Correct when something arrived.
 *
 * The feed is ordered and grouped by this, so it is the one field that decides
 * where an entry *is* — and it can be wrong in ordinary ways: a backlog
 * imported under today, a scan made on the Friday and filed on the Monday, a
 * note written up after the fact. Somewhere out of order is somewhere you will
 * not find it again, which is the whole promise of a box.
 *
 * The document's own printed date is left alone: that is what the paper says,
 * and it is not ours to edit.
 */
export async function setDocumentArrivedAt(itemId: string, iso: string) {
  await requireSession();

  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return;

  // The same rails the ingest endpoint uses. A year typed as 202 rather than
  // 2025 would otherwise bury the entry at the bottom of the box forever.
  const tooOld = when.getTime() < Date.UTC(1900, 0, 1);
  const inFuture = when.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000;
  if (tooOld || inFuture) return;

  await db
    .update(boxItems)
    .set({ capturedAt: when, updatedAt: new Date() })
    .where(eq(boxItems.id, itemId));

  revalidateShell();
}

/** Move a document to another box. Its tags don't come with it — they belong
 *  to the box it left, so it is queued to be read again under the new one. */
export async function moveDocument(itemId: string, boxId: string) {
  await requireSession();

  // Tags go first: they belong to the box being left, and a document arriving
  // in the new box still wearing the old one's tags would be showing labels
  // that box has never heard of. A failure between the two leaves it where it
  // was, untagged, which the re-read below puts right.
  await db.delete(boxItemTags).where(eq(boxItemTags.itemId, itemId));

  await db
    .update(boxItems)
    .set({ boxId, updatedAt: new Date() })
    .where(eq(boxItems.id, itemId));

  await requeueBoxItem(itemId);
  revalidateShell();
}

/**
 * Write something in a box.
 *
 * The boxes started as somewhere documents land, and that turned out to be
 * half of it: a thought about a document belongs beside the document, in the
 * order it occurred, not in a separate system you have to remember to look in.
 * So a box takes messages too, and reads like a chat — which is the one
 * interface nobody has ever needed teaching.
 *
 * Written straight to `ready`: a note is not a summary of anything, it is the
 * thing itself, and there is nothing for a model to do to it. `search_text` is
 * written here for the same reason it is everywhere else — the vector is
 * generated from that column, and a note without it is a note you can't find.
 */
export async function postBoxNote(boxId: string, body: string) {
  await requireSession();

  const text = body.trim();
  if (!text) return null;

  const [row] = await db
    .insert(boxItems)
    .values({
      boxId,
      kind: 'note',
      description: text,
      searchText: text,
      status: 'ready',
    })
    .returning({ id: boxItems.id });

  revalidateShell();
  return row.id;
}

/**
 * Keep a link — a page you liked, or one someone sent you.
 *
 * Written immediately with nothing but the address, and read afterwards by the
 * worker: following a link means waiting on a server that is nobody's
 * responsibility, and the entry should be in the box the moment you press
 * Post. Whether it is a page or a place is not decided here either. That needs
 * the shortener followed, which is the same wait.
 */
export async function postBoxLink(boxId: string, url: string, body: string) {
  await requireSession();

  const address = url.trim();
  if (!address) return null;

  const text = body.trim();

  const [row] = await db
    .insert(boxItems)
    .values({
      boxId,
      kind: 'link',
      url: address,
      // Until it has been read, the address is the only thing there is to
      // show — better than an untitled row you cannot identify.
      description: text || null,
      searchText: [text, address].filter(Boolean).join(' '),
      status: 'pending',
    })
    .returning({ id: boxItems.id });

  await enqueueBoxJob(row.id);

  revalidateShell();
  return row.id;
}

/**
 * Record where you are, with an optional line about it.
 *
 * Coordinates only. Turning them into "the chemist on Fleet Street" would mean
 * a geocoding service, a key and a per-request cost, for something a map link
 * answers by itself — and the coordinate is the fact, while the street name is
 * an interpretation that can go stale.
 */
export async function postBoxLocation(
  boxId: string,
  lat: number,
  lng: number,
  body: string,
) {
  await requireSession();

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const text = body.trim();

  const [row] = await db
    .insert(boxItems)
    .values({
      boxId,
      kind: 'location',
      lat,
      lng,
      description: text || null,
      searchText: text || null,
      status: 'ready',
    })
    .returning({ id: boxItems.id });

  revalidateShell();
  return row.id;
}

/**
 * Throw a document away. The Drive file goes to the bin, not the void.
 *
 * Its links go with it, so a project that cited it stops citing something
 * that no longer exists.
 */
export async function deleteDocument(itemId: string) {
  await requireSession();
  await deleteBoxItem(itemId);
  revalidateShell();
}

/**
 * Cite a document from a project, action or list item.
 *
 * A link, not a copy and not an attachment: the file stays in its box, and
 * unlinking later touches nothing in Drive. That is the whole of keeping the
 * two systems independent — a parking notice can be a project's evidence
 * without ceasing to be a document that arrived in August.
 */
export async function linkDocument(
  itemId: string,
  parentType: AttachmentParentType,
  parentId: string,
) {
  await requireSession();

  await db
    .insert(boxItemLinks)
    .values({ itemId, parentType, parentId })
    .onConflictDoNothing();

  revalidateShell();
}

export async function unlinkDocument(
  itemId: string,
  parentType: AttachmentParentType,
  parentId: string,
) {
  await requireSession();

  await db
    .delete(boxItemLinks)
    .where(
      and(
        eq(boxItemLinks.itemId, itemId),
        eq(boxItemLinks.parentType, parentType),
        eq(boxItemLinks.parentId, parentId),
      ),
    );

  revalidateShell();
}

/**
 * Start work from a document.
 *
 * The document is usually what tells you there is something to do — a penalty
 * notice, a renewal, a letter that needs answering — so the thing it becomes
 * is linked back to it rather than merely inspired by it. The title comes from
 * the document unless you give a better one, and the file stays where it is.
 */
export async function startFromDocument(
  itemId: string,
  kind: 'action' | 'project',
  title: string,
): Promise<{ id: string } | null> {
  await requireSession();

  const [item] = await db
    .select({ title: boxItems.title, name: boxItems.name })
    .from(boxItems)
    .where(eq(boxItems.id, itemId))
    .limit(1);

  if (!item) return null;

  const heading =
    title.trim() ||
    item.title?.trim() ||
    item.name.replace(/^\d{4}-\d{2}-\d{2}[ _-]*/, '').trim() ||
    'Untitled';

  if (kind === 'project') {
    const [project] = await db
      .insert(projects)
      .values({ title: heading, status: 'active' })
      .returning({ id: projects.id });

    await enqueueSync('create_project_links', project.id);
    await db
      .insert(boxItemLinks)
      .values({ itemId, parentType: 'project', parentId: project.id })
      .onConflictDoNothing();

    revalidateShell();
    return project;
  }

  const [action] = await db
    .insert(actions)
    .values({ title: heading, status: 'next' })
    .returning({ id: actions.id });

  await db
    .insert(boxItemLinks)
    .values({ itemId, parentType: 'action', parentId: action.id })
    .onConflictDoNothing();

  revalidateShell();
  return action;
}
