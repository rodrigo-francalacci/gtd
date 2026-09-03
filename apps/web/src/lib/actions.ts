'use server';

import {
  SINGLETON,
  actionContexts,
  actions,
  areasOfFocus,
  attachments,
  boxCategories,
  boxDays,
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
  nowSections,
  preferences,
  projects,
  reviews,
  type ActionStatus,
  type AttachmentParentType,
  type ContextDimension,
  type InboxRawType,
  type ListType,
  type ProjectStatus,
  aiPrices,
  aiTopups,
} from '@gtd/db';
import type { PurchaseFields } from './queries.shared';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  MAX_PANE_WIDTH,
  MIN_PANE_WIDTH,
  type BoxView,
  type ViewMode,
} from './pane';
import { suggester } from './ai/suggest';
import { readPurchase, type PurchaseRead } from './ai/purchase';
import { oneEmoji, pickEmoji } from './ai/emoji';
import { suggestContexts } from './ai/contexts';
import { nameAttachment } from './ai/filename';
import { requireSession } from './auth/session';
import type { ReviewStep } from './review';
import {
  attachmentFolder,
  createGoogleDocument,
  removeAttachment,
  trashProjectFolder,
} from './google/attachments';
import { createGalleryFolder } from './google/galleries';
import {
  createEmailRequest,
  forgetEmailRequest,
  readEmailQuery,
  type RequestParent,
  clearEmailRequestParents,
} from './box/email-requests';
import {
  createBoxDocument,
  deleteBoxItem,
  ensureBoxFolder,
  copyBoxItemFile,
  ensureBoxLabel,
  renameBoxContainers,
  trashBoxFolder,
} from './google/boxes';
import { after } from 'next/server';
import { drainSyncQueue, enqueueFileMove, enqueueSync } from './google/queue';
import { enqueueBoxJob } from './box/queue';
import { canClassify } from './box/classify';
import { canGroup, type SortChoice } from './sort';
import { setUsage, type UsableType } from './usage';
import {
  getView,
  setBoxLayout,
  setBoxViewFor,
  setDensity,
  setLayout,
  setViewPref,
  type ListLayout,
} from './view-prefs';
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

  /*
   * No folder, no label, not yet.
   *
   * A project is a decision, not a filing cabinet. Most of them never acquire
   * a single file or a single message, and making a Drive folder and a Gmail
   * label for every one of them fills two of somebody's accounts with empty
   * containers named after things they thought about once — which is worse
   * than clutter, because it makes the folder that *does* hold something
   * harder to find among the ones that never will.
   *
   * They are made when there is something to put in them: see
   * `ensureProjectFolder` on the upload path, and the label enqueued the first
   * time a message is filed against a project.
   */

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

  /*
   * Carry the new name out to Drive and Gmail.
   *
   * A project's folder is named after it and its Gmail label *is* its name —
   * `GTD/Projects/<title>` — so renaming here and nowhere else left the folder
   * you would go looking in still called the old thing, for ever, and the label
   * wrong until the next status change happened to rewrite its path.
   *
   * The same job a status change enqueues: it puts the containers where and
   * what they should be, and a rename is one of the two ways they can become
   * wrong. Queued rather than called, because this fires on every edit of a
   * title field and must not wait on Google.
   */
  await enqueueSync('move_project_links', projectId);

  /*
   * Drained now, not on the next tick.
   *
   * Queueing is right — a title field must never wait on Google — but nothing
   * was draining it, and the cron runs *daily* on a Hobby plan. So renaming a
   * project left the folder you would go looking in under its old name until
   * the following morning: the app said one thing, Drive said another, and no
   * page admitted it. Exactly the trap the box's Drive renames fell into and
   * were fixed for; this is the same fix on the other table.
   *
   * `after` runs once the response is flushed, so the rename still costs the
   * person nothing, and a failure leaves the job pending for the tick.
   */
  drainMovesAfterResponse(1);

  revalidateShell();
}

/**
 * Status changes carry two rules from the brief: standby requires a return
 * condition, and the Drive/Gmail containers follow the status.
 */
/** The two statuses that mean a project is over. */
const ARCHIVED: ProjectStatus[] = ['completed', 'dropped'];

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

  // Archiving is the moment you would go and look at the folder, so it moves
  // now rather than overnight.
  drainMovesAfterResponse(1);

  /*
   * Any timeline this project is on has to hear about it.
   *
   * Archiving is the moment the "Concluded …" line becomes true, and reopening
   * is the moment it stops being — so the mark is written and removed here
   * rather than being something you remember to do. Cheap when the project is
   * on no timeline at all, which is almost all of them: one indexed read that
   * comes back empty.
   */
  await syncConclusionEvents(project.id, project.completedAt);

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

  /*
   * The same clean-up an action gets, for the same reason and on a larger
   * scale. `actions.project_id` cascades, so deleting a project took its
   * actions with it and left every file attached to any of them orphaned:
   * rows pointing at nothing, and their Drive files still sitting in a folder
   * the app can no longer reach. The polymorphic `parent_id` has no foreign
   * key to cascade through — it addresses four different tables — so this is
   * the only place it can happen.
   *
   * Actions first, while they can still be found by their project.
   */
  const own = await db
    .select({ id: actions.id })
    .from(actions)
    .where(eq(actions.projectId, projectId));

  await purgeActions(own.map((a) => a.id));
  await purgeFilesOf('project', [projectId]);
  await clearEmailRequestParents('project', [projectId]);

  const [gone] = await db
    .delete(projects)
    .where(eq(projects.id, projectId))
    .returning({ driveFolderId: projects.driveFolderId });

  /*
   * And the folder the files were in.
   *
   * The purges above take every document with them and left the container
   * standing, so deleting projects slowly filled Drive with empty folders named
   * after things that no longer exist. Last, so what goes to the bin is an
   * empty folder rather than one still holding live files, and read off the
   * delete itself so there is no second query and no chance of trashing a
   * folder belonging to a project that was not the one removed.
   *
   * A Google call inside a request, under the exception this function is
   * already using: it has just awaited a trash for every attached file, and one
   * more is not what makes it slow.
   */
  await trashProjectFolder(gone?.driveFolderId ?? null);
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

  /*
   * Which bucket it lands in, when the form says.
   *
   * Adding a step you have no intention of doing yet meant creating it in
   * Active — where it immediately showed up in "what can I do now" — and then
   * dragging it down to Future. Two moves, and in between a wrong answer to the
   * one question that list exists to answer.
   *
   * Taken from an allowlist rather than trusted: this is a form field, and the
   * only two buckets a *new* action can sensibly go into are the two on offer.
   * Anything else falls back to `next`, which is the default the column has
   * anyway.
   */
  const asked = String(formData.get('status') ?? '');
  const status = asked === 'future' ? 'future' as const : 'next' as const;

  await db.insert(actions).values({ title, projectId: projectId || null, status });

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

  /*
   * A project-less action's folder is named after the action, so a rename that
   * did not follow would leave Drive holding the old name for ever — the one
   * thing you would go looking for the folder by. The same rule
   * `updateProjectTitle` follows, and free for the actions that have no folder,
   * which is nearly all of them: the job reads one row and stops.
   */
  drainMovesAfterResponse((await enqueueActionFolder(actionId)) ? 1 : 0);

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

  // Finishing an action archives its folder the way finishing a project
  // archives one, and reopening brings it back — a folder under `Archive` for
  // something you are working on again is a record of what did not happen.
  drainMovesAfterResponse((await enqueueActionFolder(actionId)) ? 1 : 0);

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

/**
 * Delete actions, and take what hangs off them.
 *
 * `attachments` and `box_item_links` are polymorphic — `parent_id` is a plain
 * uuid with no foreign key, because it points at four different tables — so
 * nothing cascades and deleting the action alone left its files behind as rows
 * pointing at something that no longer exists: invisible in every pane, still
 * counted by the enrichment queue, and their Drive files still sitting in the
 * project folder with nothing in the app that could ever reach them again.
 *
 * Files are removed one at a time through `removeAttachment` rather than in
 * one statement, because each one has a Drive file to trash and that is the
 * part that must not be skipped. It *trashes*, never deletes — the standing
 * rule for every file this app puts in Drive, and the reason this is safe to
 * offer as a bulk button at all: the recovery is Drive's own bin.
 *
 * A link to a Big Box document is only unlinked. The document belongs to the
 * box, and tidying a project has no business reaching into the archive.
 */
/**
 * A document that has just lost its last citation must not vanish.
 *
 * `box_items.listed` is false for exactly one case: a message the bridge
 * fetched because a *request carried a parent*. You asked for it on a project,
 * so it lives on the project and is deliberately kept out of the box's feed —
 * having it appear in a journal you read as well would be the app filing
 * something you never filed.
 *
 * Take the project away and that reasoning collapses. The citation goes, which
 * is right — deleting a project must never reach into a box and destroy
 * documents — but an unlisted entry with nothing citing it is invisible from
 * every direction: not in the box, and evidence for nothing. Found in real
 * data, a filed email from August that had quietly become unreachable.
 *
 * So the box takes it back. That is where it always belonged; being hidden was
 * a courtesy to a project that no longer exists.
 */
async function relistUncitedDocuments(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;

  await db
    .update(boxItems)
    .set({ listed: true, updatedAt: new Date() })
    .where(
      and(
        inArray(boxItems.id, itemIds),
        eq(boxItems.listed, false),
        // Only when nothing else cites it. A document on two projects loses one
        // and stays where it is.
        sql`not exists (
          select 1 from ${boxItemLinks} l where l.item_id = ${boxItems.id}
        )`,
      ),
    );
}

async function purgeFilesOf(
  parentType: AttachmentParentType,
  parentIds: string[],
): Promise<number> {
  // Not just an optimisation: `inArray` with nothing in it builds `in ()`,
  // which Postgres rejects outright.
  if (parentIds.length === 0) return 0;

  const files = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(
        eq(attachments.parentType, parentType),
        inArray(attachments.parentId, parentIds),
      ),
    );

  // One at a time, because each carries a Drive file to trash and that is the
  // part that must not be skipped. `removeAttachment` trashes, never deletes.
  for (const file of files) await removeAttachment(file.id);

  // Only the citation goes. The document belongs to its box, and tidying up
  // here has no business reaching into the archive.
  const cited = await db
    .select({ itemId: boxItemLinks.itemId })
    .from(boxItemLinks)
    .where(
      and(
        eq(boxItemLinks.parentType, parentType),
        inArray(boxItemLinks.parentId, parentIds),
      ),
    );

  await db
    .delete(boxItemLinks)
    .where(
      and(
        eq(boxItemLinks.parentType, parentType),
        inArray(boxItemLinks.parentId, parentIds),
      ),
    );

  // Anything that was only here is given back to its box, or it would be in no
  // feed and cited by nothing.
  await relistUncitedDocuments(cited.map((row) => row.itemId));

  return files.length;
}

/**
 * Queue a project-less action's folder to be put where its row now says.
 *
 * Guarded on the action having no project *and* on it either owning a folder
 * already or being the kind of thing that could want one — because this is
 * called from renaming and from ticking off, which happen constantly, and the
 * overwhelming majority of actions have no folder and never will. Without the
 * guard every tick of a checkbox would put a row in the queue for a worker to
 * pick up and discard.
 */
async function enqueueActionFolder(actionId: string): Promise<boolean> {
  const [row] = await db
    .select({ projectId: actions.projectId, driveFolderId: actions.driveFolderId })
    .from(actions)
    .where(eq(actions.id, actionId))
    .limit(1);

  // No folder and nothing that would want one: a folder is made when a file
  // arrives, and neither renaming nor finishing is that moment.
  if (!row?.driveFolderId) return false;

  await enqueueFileMove({ actionId });
  return true;
}

async function purgeActions(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  const files = await purgeFilesOf('action', ids);
  await clearEmailRequestParents('action', ids);

  /*
   * The folder goes too, once its files have.
   *
   * The same rule deleting a project follows and for the same reason: the
   * purge above takes every file individually and would otherwise leave the
   * container standing, so deleting actions would slowly fill the account with
   * empty folders named after things that no longer exist. Read from the
   * `returning` of the delete, so there is no second query and no chance of
   * binning the folder of an action that was not the one removed.
   */
  const gone = await db
    .delete(actions)
    .where(inArray(actions.id, ids))
    .returning({ driveFolderId: actions.driveFolderId });

  // The same helper the project delete uses, which already swallows a failure
  // for the right reason: deleting was what was asked for, and it has happened.
  for (const row of gone) await trashProjectFolder(row.driveFolderId);

  return files;
}

export async function deleteAction(actionId: string) {
  await requireSession();
  await purgeActions([actionId]);
  revalidateShell();
}

/**
 * Clear the finished steps off a project.
 *
 * Not every project is worth a record. A recurring bit of admin accumulates
 * the same four steps every time and none of them will ever be read again,
 * and a project pane you have to scroll past forty ticked rows to reach is a
 * project you stop opening. Deliberately per-project and deliberately a
 * button: there is no sweep, nothing expires, and a project whose history is
 * the point keeps all of it by doing nothing.
 *
 * Returns how much went, so the caller can say so rather than leaving you to
 * work out what a silent refresh did.
 */
export async function deleteCompletedActions(projectId: string) {
  await requireSession();

  const done = await db
    .select({ id: actions.id })
    .from(actions)
    .where(and(eq(actions.projectId, projectId), eq(actions.status, 'done')));

  const ids = done.map((a) => a.id);
  const files = await purgeActions(ids);

  revalidateShell();

  return { actions: ids.length, files };
}

/*
 * ---------------------------------------------------------------------------
 * Sections in "What can I do now"
 * ---------------------------------------------------------------------------
 *
 * Headings you write yourself and drag actions underneath, so the list reads in
 * the order you intend to work through it. They are arrangement and nothing
 * else: no query outside this list looks at them, nothing is scheduled by them,
 * and an action carries on being exactly what it was.
 */

/** A new heading, at the bottom, ready to be dragged into place. */
export async function createNowSection(title: string) {
  await requireSession();
  const trimmed = title.trim();
  if (!trimmed) return;

  const [last] = await db
    .select({ position: nowSections.position })
    .from(nowSections)
    .orderBy(desc(nowSections.position))
    .limit(1);

  await db
    .insert(nowSections)
    .values({ title: trimmed, position: (last?.position ?? 0) + 1 });

  revalidateShell();
}

export async function renameNowSection(sectionId: string, title: string) {
  await requireSession();
  const trimmed = title.trim();
  if (!trimmed) return;

  await db
    .update(nowSections)
    .set({ title: trimmed, updatedAt: new Date() })
    .where(eq(nowSections.id, sectionId));

  revalidateShell();
}

/**
 * Remove a heading. The actions under it stay exactly where they were.
 *
 * `section_id` is `on delete set null`, so they fall back into the ungrouped run
 * at the bottom rather than going anywhere. Deleting a heading is a change of
 * mind about the arrangement, and an arrangement must never be able to take the
 * work with it.
 */
export async function deleteNowSection(sectionId: string) {
  await requireSession();
  await db.delete(nowSections).where(eq(nowSections.id, sectionId));
  revalidateShell();
}

/** Put an action under a heading, or back into the ungrouped run. */
export async function moveActionToSection(actionId: string, sectionId: string | null) {
  await requireSession();

  await db
    .update(actions)
    .set({ sectionId, updatedAt: new Date() })
    .where(eq(actions.id, actionId));

  revalidateShell();
}

/**
 * Reorder the headings themselves, by the midpoint rule the rest of the app
 * uses: dropping between two writes the average of their positions and touches
 * one row, so nothing is renumbered.
 */
export async function moveNowSectionBetween(
  sectionId: string,
  prevId: string | null,
  nextId: string | null,
) {
  await requireSession();

  const neighbours = await db
    .select({ id: nowSections.id, position: nowSections.position })
    .from(nowSections);

  const at = (id: string | null) =>
    id ? (neighbours.find((n) => n.id === id)?.position ?? null) : null;

  await db
    .update(nowSections)
    .set({ position: positionBetween(at(prevId), at(nextId)), updatedAt: new Date() })
    .where(eq(nowSections.id, sectionId));

  revalidateShell();
}

export async function moveActionToProject(actionId: string, projectId: string | null) {
  await requireSession();
  await db
    .update(actions)
    .set({ projectId, updatedAt: new Date() })
    .where(eq(actions.id, actionId));

  /*
   * An action's files live in its *project's* folder, so filing the action
   * somewhere else leaves every one of them in the folder of a project it no
   * longer belongs to — findable only by remembering where the step used to be,
   * which is the opposite of why files follow the project at all.
   *
   * Queued per file. `attachmentFolder` works the destination out from the
   * action's new project, including `GTD/Inbox` when it was filed *out* of a
   * project, so the reverse direction is handled by the same job.
   */
  const files = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(eq(attachments.parentType, 'action'), eq(attachments.parentId, actionId)),
    );

  for (const file of files) await enqueueFileMove({ attachmentId: file.id });

  /*
   * Queued *after* the files, and the order matters.
   *
   * Filing into a project makes the action's own folder a leftover, and it is
   * only binned once empty — so the file moves have to have run first. Filing
   * out of one is the mirror: the action now needs a folder of its own, and the
   * files queued a moment ago will be sent into it.
   */
  const folderQueued = await enqueueActionFolder(actionId);
  drainMovesAfterResponse(files.length + (folderQueued ? 1 : 0));

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

/**
 * Give a freshly attached file a name, without holding up the attaching.
 *
 * Not awaited and never allowed to throw, for the reason the emoji on a capture
 * is not: the file is already on the project, which is the thing that was asked
 * for, and a naming that fails must not turn a completed attach into an error.
 *
 * Called on the server rather than from the browser, unlike `emojifyLater` —
 * this one runs inside an action that is already doing several writes, so it is
 * simply one more thing in flight rather than a second request. The worst case
 * is a file that keeps the name the camera gave it.
 */
function nameAttachmentLater(attachmentId: string): void {
  void nameAttachment(attachmentId).catch(() => {
    // Deliberately silent. See above.
  });
}

/**
 * Which project's folder this decision's files now belong in, if any.
 *
 * Written out per decision rather than derived from the re-parented row, so
 * that adding an outcome forces an answer here instead of silently defaulting
 * to "leave it in the inbox" — which is the failure this whole path is fixing.
 * Null is a real answer for a list item and a standalone action: their files
 * genuinely live in `GTD/Inbox`, and that is where they already are.
 */
/**
 * Run the file moves just queued, once the response has gone out.
 *
 * The cron owns `sync_jobs` and on a Hobby account it runs **daily**, so
 * queuing alone would leave a file in the folder it was in until the following
 * morning — with the app showing it somewhere else the whole time. Nothing
 * broken and everything looking broken, which is the worst combination and the
 * same trap the box's Drive renames fell into.
 *
 * `after` is what makes fixing it free: the work runs after the response is
 * flushed, so the move that caused it is exactly as fast as it was and a slow
 * Drive costs nothing. A failure here is not an error — the rows stay pending
 * and the next tick takes them, which is the whole reason they are rows first.
 *
 * The budget is what this caller queued, so one person moving a document does
 * not sit through somebody else's backlog. It may still claim another job, and
 * that is fine: a queue is a queue.
 */
function drainMovesAfterResponse(queued: number): void {
  if (queued === 0) return;

  after(async () => {
    await drainSyncQueue(queued).catch(() => {});
  });
}

async function outcomeProject(
  decision: ClarifyDecision,
  outcomeId: string | null,
): Promise<string | null> {
  switch (decision.kind) {
    // The project itself is the destination.
    case 'project':
      return outcomeId;

    case 'next_action':
    case 'waiting':
    case 'done':
      return decision.projectId;

    case 'attached': {
      if (decision.parentType === 'project') return decision.parentId;

      const [action] = await db
        .select({ projectId: actions.projectId })
        .from(actions)
        .where(eq(actions.id, decision.parentId))
        .limit(1);

      return action?.projectId ?? null;
    }

    // A list item is a candidate rather than a commitment, and `filed` and
    // `trashed` have no attachment left to move at all.
    default:
      return null;
  }
}

/**
 * Guess a capture's Where, Time and Energy when you say it is actionable.
 *
 * Fired by the decision, not by the capture: pressing "Next action" is the
 * moment these three fields become worth filling in, and asking at capture time
 * would spend money on every thought including the ones that turn out to be
 * rubbish. It is also the moment the answer is cheapest to check — the pane is
 * already open in front of you.
 *
 * Reads the vocabulary here rather than taking it from the client, because what
 * comes back is validated against it and validation against something the
 * caller supplied is not validation.
 */
export async function suggestClarifyContexts(itemId: string): Promise<string[]> {
  await requireSession();

  const [item] = await db
    .select({ rawText: inboxItems.rawText })
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  if (!item?.rawText) return [];

  const rows = await db
    .select({ id: contexts.id, name: contexts.name, dimension: contexts.dimension })
    .from(contexts);

  const pick = (dimension: string) =>
    rows.filter((r) => r.dimension === dimension).map((r) => ({ id: r.id, name: r.name }));

  return suggestContexts(item.rawText, {
    time: pick('time'),
    energy: pick('energy'),
  });
}

export type ClarifyDecision =
  | ({
      kind: 'next_action' | 'waiting' | 'done';
      title: string;
      projectId: string | null;
      contextIds: string[];
    } & WithNote)
  | ({ kind: 'project'; title: string; areaId: string | null } & WithNote)
  | ({ kind: 'list_item'; title: string; listId: string } & WithNote)
  | ({ kind: 'filed'; title: string; boxId: string } & WithNote)
  /**
   * Onto something that already exists, creating nothing.
   *
   * Every other decision here answers "what should this become". This one
   * answers "this belongs on that", which is the commonest thing to want from a
   * photographed receipt or a scanned letter: it is evidence for a project you
   * already have, not a new commitment. Before this, the only way to get a
   * captured file onto an existing action was to make a second action to carry
   * it.
   *
   * No title and no note. The text you typed to get the file into the inbox was
   * a label for the capture — "receipt", "the quote" — and putting it on the
   * project as a note would be filing your shorthand as a thought. The file is
   * the thing that crosses.
   */
  | { kind: 'attached'; parentType: AttachTarget; parentId: string }
  | { kind: 'trashed' };

/**
 * What a captured file can be attached to.
 *
 * A project or one of its actions, which is where evidence actually belongs. A
 * box is a different decision and already has one — `filed` — and a list item
 * is a candidate rather than a place you keep things.
 */
export type AttachTarget = 'project' | 'action';

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
    .select({ id: inboxItems.id, status: inboxItems.status, emoji: inboxItems.emoji })
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  if (!item || item.status === 'clarified') return; // no double-processing

  /*
   * The emoji travels with the decision.
   *
   * A capture arrives with one now, and the thing it becomes is the same thing —
   * so leaving it behind would mean a row you had learned to recognise in the
   * inbox arriving in Now looking like everything else, and being given a second,
   * different glyph the next time anything was emojified. What makes a list
   * scannable is that a row keeps its shape; that has to survive the row moving
   * table.
   */
  const carried = item.emoji;

  let outcomeId: string | null = null;
  /** The box documents a `filed` decision created, each with a file to move. */
  let filedInBox: string[] = [];

  if (decision.kind === 'project') {
    const title = decision.title.trim();
    if (!title) return;

    const [project] = await db
      .insert(projects)
      .values({
        title,
        emoji: carried,
        areaId: decision.areaId,
        status: 'active',
        ...noteColumns(decision.note),
      })
      .returning();
    outcomeId = project.id;
  } else if (decision.kind === 'list_item') {
    const title = decision.title.trim();
    if (!title) return;

    const [listItem] = await db
      .insert(listItems)
      .values({ listId: decision.listId, title, emoji: carried, ...noteColumns(decision.note) })
      .returning();
    outcomeId = listItem.id;
  } else if (decision.kind === 'filed') {
    /*
     * Every document it made, not just the first. The first is the outcome the
     * capture points at; all of them have a file to be moved into the box's
     * folder, which is why the count is carried down to the drain below.
     */
    filedInBox = await fileCaptureInBox(itemId, decision, carried);
    if (filedInBox.length === 0) return;
    outcomeId = filedInBox[0];
  } else if (decision.kind === 'attached') {
    /*
     * The outcome *is* the thing it was attached to, so the capture stays
     * traceable to where its file went. Nothing is created here — the
     * re-parenting happens below, with the other file handling.
     */
    outcomeId = decision.parentId;
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
        emoji: carried,
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
  // `filed` is the other exception, for the opposite reason to `trashed`: its
  // files have already *become* box documents, so there is no attachment row
  // left to re-parent and nothing that would want to be one.
  let moved: { id: string }[] = [];

  if (
    outcomeId &&
    decision.kind !== 'trashed' &&
    decision.kind !== 'filed' &&
    decision.kind !== 'attached'
  ) {
    moved = await db
      .update(attachments)
      .set({ parentType: PARENT_FOR_OUTCOME[decision.kind], parentId: outcomeId })
      .where(
        and(
          eq(attachments.parentType, 'inbox_item'),
          eq(attachments.parentId, itemId),
        ),
      )
      .returning({ id: attachments.id });
  }

  /*
   * Attaching is the same re-parent aimed at a row that was already there, so
   * it is written out separately rather than folded into the map above — that
   * map turns a *decision* into the kind of thing the decision creates, and
   * this decision creates nothing.
   */
  if (decision.kind === 'attached') {
    moved = await db
      .update(attachments)
      .set({ parentType: decision.parentType, parentId: decision.parentId })
      .where(
        and(
          eq(attachments.parentType, 'inbox_item'),
          eq(attachments.parentId, itemId),
        ),
      )
      .returning({ id: attachments.id });
  }

  /*
   * **The row moving is only half of it — the file has to move in Drive too.**
   *
   * A capture's photograph went up before anything was decided about it, so it
   * is sitting in `GTD/Inbox`, which was the honest answer at the time. Leaving
   * it there once the capture has become the quote for the kitchen defeats the
   * rule the whole upload path is built on: files follow the project, because
   * the project's folder is what you open in a year. Everything that arrived as
   * a capture was precisely what that folder was missing.
   *
   * Queued rather than called here, because a clarify is an interactive
   * mutation and must not wait on Drive — and queued *per file*, which is why
   * `sync_jobs` grew an `attachment_id`. `after()` below drains it a moment
   * later so the folder is right while you are still looking at the app; the
   * row is what makes that safe to attempt, since a failure then leaves work
   * the cron will finish rather than a file quietly left behind.
   */
  const destination = await outcomeProject(decision, outcomeId);

  /*
   * A capture filed in a box queued its own moves — one per document, since
   * `fileCaptureInBox` is what knows which rows it made — so they are counted
   * here rather than queued again.
   */
  let queued = filedInBox.length;

  for (const file of moved) {
    /*
     * No project means the destination is `GTD/Inbox`, which is where the file
     * already is — so there is nothing to move, and queuing anyway would spend
     * a Drive round trip discovering that.
     */
    if (destination) {
      await enqueueFileMove({ attachmentId: file.id });
      queued += 1;
    }

    /*
     * Named afterwards, and never waited for. A file arriving from a capture is
     * called whatever the camera called it, and `IMG_4821.jpg` on a project is
     * a file nobody will ever pick out of a list again. See `nameLater`.
     */
    void nameAttachmentLater(file.id);
  }

  drainMovesAfterResponse(queued);

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
 * `trashed` never gets here — it has no outcome row to hang a file off —
 * `filed` turns its files into box documents rather than leaving them as
 * attachments, and `attached` names its own parent rather than producing one.
 * The three action-shaped decisions all produce an action.
 */
const PARENT_FOR_OUTCOME: Record<
  Exclude<ClarifyDecision['kind'], 'trashed' | 'filed' | 'attached'>,
  AttachmentParentType
> = {
  next_action: 'action',
  waiting: 'action',
  done: 'action',
  project: 'project',
  list_item: 'list_item',
};

/**
 * Turn a capture into something filed in a box.
 *
 * The conversion is the interesting part. A capture's file is an `attachments`
 * row; a box document keeps its own `drive_file_id`. Those are different
 * tables, so nothing can be re-parented — the row is rebuilt on the other side
 * and the original deleted.
 *
 * Deleted *directly*, never through `removeAttachment`, and this is the whole
 * hazard of the operation: that function trashes the Drive file, which is
 * exactly right when you are detaching something and exactly wrong here. The
 * file is not going anywhere; only the row that describes it changes table.
 *
 * One box entry per file, because an entry holds one file. With no file at all
 * the capture becomes a note, which is what a typed thought already is — and
 * why `box_items.drive_file_id` is nullable.
 *
 * The Drive file stays in `GTD/Inbox` rather than moving to the box's folder.
 * Moving it is a Google call and a mutation must not make one; this is the
 * same compromise clarify already makes for every other outcome, and the file
 * is reachable by id either way.
 */
async function fileCaptureInBox(
  itemId: string,
  decision: Extract<ClarifyDecision, { kind: 'filed' }>,
  carried: string | null,
): Promise<string[]> {
  const title = decision.title.trim();
  const note = decision.note?.trim() ?? '';

  const files = await db
    .select({
      id: attachments.id,
      name: attachments.name,
      driveFileId: attachments.driveFileId,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
    })
    .from(attachments)
    .where(
      and(eq(attachments.parentType, 'inbox_item'), eq(attachments.parentId, itemId)),
    );

  // The words you captured, kept as the entry's description so the filing is
  // not just a file with no account of why you kept it.
  const description = [title, note].filter(Boolean).join('\n\n') || null;

  if (files.length === 0) {
    if (!description) return [];

    const [row] = await db
      .insert(boxItems)
      .values({
        boxId: decision.boxId,
        kind: 'note',
        emoji: carried,
        // A note is already in its final form — nothing to read, so `ready`.
        status: 'ready',
        description,
        searchText: description,
      })
      .returning({ id: boxItems.id });

    // A note has no file, so there is nothing to move and nothing to drain.
    return [row.id];
  }

  const made: string[] = [];

  for (const file of files) {
    const mimeType = file.mimeType ?? 'application/octet-stream';
    const readable = canClassify(mimeType);
    // Read before the insert rather than from `made` inside it: the values
    // object would otherwise depend on a variable assigned from the insert's
    // own result, which TypeScript reads as circular.
    const isFirst = made.length === 0;

    const [row] = await db
      .insert(boxItems)
      .values({
        boxId: decision.boxId,
        kind: 'document',
        driveFileId: file.driveFileId,
        name: file.name,
        mimeType,
        sizeBytes: file.sizeBytes,
        // The description goes on the first only. Repeating it across five
        // photos of the same thing would put one sentence in the feed five
        // times.
        description: isFirst ? description : null,
        searchText: isFirst ? description : null,
        /*
         * And the emoji with it, on the same reasoning — but only until the
         * document is read. A reading decides an emoji from what the document
         * turns out to *be*, which is a better answer than one taken from the
         * line you typed before you filed it, so this is the placeholder that
         * keeps the row recognisable in the meantime and is replaced by
         * something better. An unreadable file is never read, so for those it
         * is the only emoji there will be, which is exactly when carrying it
         * matters most.
         */
        emoji: isFirst ? carried : null,
        status: readable ? 'pending' : 'ready',
      })
      .returning({ id: boxItems.id });

    await db.delete(attachments).where(eq(attachments.id, file.id));

    /*
     * The row is now in the box and the bytes are still in `GTD/Inbox`.
     *
     * Filing hands the `drive_file_id` straight across and deletes the
     * attachment, so nothing else is ever going to move this file — the row it
     * used to hang off is gone. `GTD/Box/<name>` is where a document filed here
     * belongs, and until this the box's folder held everything that arrived
     * through the scanner and nothing that arrived through the inbox.
     */
    await enqueueFileMove({ boxItemId: row.id });

    if (readable) await enqueueBoxJob(row.id);
    made.push(row.id);
  }

  return made;
}

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
  theme?: 'light' | 'dark' | 'paper' | 'sci' | 'amber' | 'riso' | null;
  hiddenCalendars?: string[];
}) {
  await db
    .insert(preferences)
    .values({ id: SINGLETON, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: preferences.id,
      set: { ...patch, updatedAt: new Date() },
    });
}

/**
 * List or gallery, for one box — or, with no key, the default a new one starts
 * from.
 *
 * It used to be a single choice for every box, which is the mistake density
 * made and had corrected: one answer for all of them is the wrong answer for
 * most of them. A box of scanned receipts is recognised by shape long before
 * its title is read and wants the pictures; a box of filed correspondence is a
 * column of subjects with nothing to look at, and turning the thumbnails on for
 * the receipts turned them on there too.
 */
export async function setBoxView(view: BoxView, key?: string) {
  await requireSession();

  if (key) await setBoxViewFor(key, view);
  else await savePreference({ boxView: view });

  revalidateShell();
}

/**
 * How a box is laid out, as the one choice it actually is.
 *
 * A box's header used to carry two controls: three densities, and a separate
 * list/pictures switch beside them. But *comfortable* — metadata wrapped onto a
 * second line — is answering the same question the pictures answer, and
 * answering it worse: a scan is recognised by its shape long before its title
 * is read. So the box offers three, `pictures | compact | titles`, and the
 * switch that used to sit beside them is gone. That freed slot is the tag
 * button, which is the thing you actually reach for in a box.
 *
 * Only in a box. Every other list keeps all three densities, because a list of
 * actions has no pictures to offer and comfortable is a real answer there.
 */
export async function setBoxLayoutChoice(
  key: string,
  choice: 'pictures' | 'compact' | 'titles',
) {
  await requireSession();

  /*
   * Pictures keeps whatever density is stored rather than picking one: the
   * gallery does not read it, and coming back from pictures should land you on
   * the density you left rather than one this chose for you.
   */
  const current = choice === 'pictures' ? await getView(key) : null;

  await setBoxLayout(
    key,
    choice === 'pictures' ? 'gallery' : 'list',
    choice === 'pictures'
      ? // Comfortable is not offered in a box any more, so a box still carrying
        // it comes back as compact rather than as a density with no button.
        (current?.density === 'simple' ? 'simple' : 'compact')
      : choice === 'compact'
        ? 'compact'
        : 'simple',
  );

  revalidateShell();
}

export async function setViewMode(mode: ViewMode, key?: string) {
  await requireSession();

  /*
   * With a key this is a fact about one list; without one it is the app-wide
   * default, which is still what a list that has never been switched follows.
   * Every list pane passes a key now, so the global value has become the seed
   * a new list starts from rather than something you set directly.
   */
  if (key) await setDensity(key, mode);
  else await savePreference({ viewMode: mode });

  revalidateShell();
}

/**
 * Which Google calendars to leave out of the calendar view.
 *
 * Stored as what to *hide*, so a calendar added in Google later shows up
 * rather than being silently absent — see the column comment for why that
 * asymmetry is the right way round.
 *
 * Writing an empty array is meaningful and must not be confused with writing
 * nothing: `[]` means "I have chosen, and I hide none of them", which stops
 * Google's own ticked state from being consulted again. Only a `null` column
 * defers to Google.
 */
export async function setHiddenCalendars(ids: string[]) {
  await requireSession();
  await savePreference({ hiddenCalendars: [...new Set(ids)] });
  revalidateShell();
}

/**
 * How one list is ordered.
 *
 * Per view rather than one setting for the app, because these lists are not
 * asking the same question. Projects read best by name, an inbox reads
 * oldest-first because that is the order you work through it, and a box reads
 * newest-first because that is the order things arrived — a single setting
 * would force one of those onto all three.
 */
export async function setViewSort(key: string, choice: SortChoice) {
  await requireSession();

  await setViewPref(key, {
    sort: choice.sort,
    descending: choice.descending,
    // A grouping asked for under A–Z must not survive a switch to a sort that
    // cannot produce headings, or the toggle stays lit over an ungrouped list.
    grouped: choice.grouped && canGroup(choice.sort),
  });

  revalidateShell();
}

/**
 * Correct a usage count by hand.
 *
 * The escape hatch that makes the automatic count safe to sort by. A file
 * opened forty times during one bad week would otherwise sit at the top of a
 * pane for a year, and "no, that was once" is the only way to say so.
 */
export async function correctUsage(type: UsableType, id: string, count: number) {
  await requireSession();
  await setUsage(type, id, count);
  revalidateShell();
}

/**
 * Called once on pointer-up, not during the drag — the pane follows the cursor
 * locally, and only the final width is written.
 */
/** Which table a note's height belongs to. */
export type NoteSurface = 'action' | 'project' | 'list_item' | 'box_item';

const NOTE_TABLE = {
  action: actions,
  project: projects,
  list_item: listItems,
  box_item: boxItems,
} as const;

/**
 * Remember how tall a note was left — that note, not notes in general.
 *
 * Per row, because the useful height is a fact about the note in front of you:
 * a one-line reminder and a page about a renovation want different things, and
 * one shared height means resizing on every visit, which is what this set out
 * to fix.
 *
 * The last height used is *also* kept on `preferences`, and that is not a
 * second source of truth — it is the default for a note nobody has dragged yet.
 * Without it every new note would open short again and the complaint would be
 * half fixed. The row always wins where it has a value.
 *
 * Clamped rather than trusted: this is a number a client sends, and a stored
 * height of two pixels is an editor you can neither use nor drag back.
 */
export async function setNoteHeight(
  surface: NoteSurface,
  id: string,
  height: number,
) {
  await requireSession();

  if (!Number.isFinite(height)) return;
  const px = Math.round(Math.min(2000, Math.max(80, height)));

  const table = NOTE_TABLE[surface];
  if (!table) return;

  await db.update(table).set({ noteHeight: px }).where(eq(table.id, id));

  // The fallback for notes that have never been dragged. A box entry's plain
  // field and the rich editor are different shapes, so they keep separate
  // defaults.
  const patch =
    surface === 'box_item' ? { boxNoteHeight: px } : { noteHeight: px };

  await db
    .insert(preferences)
    .values({ id: SINGLETON, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: preferences.id,
      set: { ...patch, updatedAt: new Date() },
    });

  // Deliberately no `revalidateShell()`: the height is already applied in the
  // browser, and re-rendering the shell at the end of a drag would throw away
  // the caret and the scroll position of the note being written.
}

/**
 * Set a note tighter, or let it breathe again.
 *
 * Per note, beside the height and for the same reason: how much air a note
 * wants is a fact about that note. A list of dates and part numbers reads
 * better closed up, and the paragraph underneath it does not.
 *
 * No `revalidateShell()`. The class is already applied in the browser, and
 * re-rendering the shell would throw away the caret and the scroll position of
 * the note being written — the same reason the height does not revalidate.
 */
export async function setNoteDense(
  surface: NoteSurface,
  id: string,
  dense: boolean,
) {
  await requireSession();

  const table = NOTE_TABLE[surface];
  if (!table) return;

  await db.update(table).set({ noteDense: dense }).where(eq(table.id, id));
}

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
/**
 * The themes there are, spelled out rather than taken as a string.
 *
 * A sixth was added and this list had to be found by the compiler rather than
 * by remembering it existed — which is the argument for writing the union here
 * instead of accepting `string` and trusting the caller.
 */
export async function setTheme(
  theme: 'light' | 'dark' | 'paper' | 'sci' | 'amber' | 'riso',
) {
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
  if (!title || !listId) return null;

  // The id goes back so the caller can have it given an emoji afterwards,
  // without this action waiting on a model to answer.
  const [row] = await db
    .insert(listItems)
    .values({ listId, title })
    .returning({ id: listItems.id });

  revalidateShell();
  return row.id;
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

  /*
   * A list item's files live in its *project's* Drive folder, exactly as an
   * action's do — `attachmentFolder` resolves a `list_item` through its project
   * — so changing that project leaves them in the folder of a project the item
   * no longer belongs to. The same fix `moveActionToProject` carries, for the
   * same reason: a file findable only by remembering where the row used to be
   * is the opposite of files following the project.
   */
  const files = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(eq(attachments.parentType, 'list_item'), eq(attachments.parentId, itemId)),
    );

  for (const file of files) await enqueueFileMove({ attachmentId: file.id });
  drainMovesAfterResponse(files.length);

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
      emoji: listItems.emoji,
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
    .values({ title, emoji: item.emoji, projectId: item.projectId })
    .returning();

  await db
    .update(listItems)
    .set({ promotedActionId: action.id })
    .where(eq(listItems.id, itemId));

  revalidateShell();
}

/**
 * Promote several at once — the ticked combination, committed.
 *
 * The trial answers "what would these come to"; this is the sentence after it.
 * Without it the answer had to be retyped as a series of individual promotions,
 * which is both tedious and a chance to promote four of the five you costed.
 *
 * Sequential rather than parallel: each one inserts an action and writes back
 * to the item, the `neon-http` driver has no transactions, and a burst of
 * concurrent writes buys nothing on five rows. `promoteListItem` already
 * refuses an item that has been promoted, so a double click costs nothing.
 */
export async function promoteListItems(itemIds: string[]) {
  await requireSession();

  for (const id of itemIds) await promoteListItem(id);

  return itemIds.length;
}

/** What there is to spend on this list. Empty clears the ceiling. */
export async function setListBudget(listId: string, budget: number | null) {
  await requireSession();

  await db
    .update(lists)
    .set({ budget: budget !== null && Number.isFinite(budget) ? budget : null })
    .where(eq(lists.id, listId));

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

  /*
   * The same clean-up an action gets, and for the same reason.
   *
   * `attachments.parent_id` is a plain uuid addressing four tables, so it has
   * no foreign key and *nothing cascades*. This deleted the row and left every
   * file hanging off it pointing at nothing, with its Drive file unreachable
   * from anywhere in the app — the exact failure the project delete already
   * had a comment about, on the one delete that had never been given the same
   * treatment. `purgeFilesOf` trashes each Drive file and drops the citations
   * with it.
   */
  await purgeFilesOf('list_item', [itemId]);
  await clearEmailRequestParents('list_item', [itemId]);

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

/**
 * Start a gallery: a Drive folder, and the row that stands for it.
 *
 * The pictures are uploaded afterwards, by the browser, against the id this
 * returns — the same order every capture in this app follows. The row lands
 * first so that if anything goes wrong halfway there is a gallery holding four
 * of the six rather than six files nobody can find.
 *
 * A Google call inside a request, under the exception an upload gets: the
 * pictures are staged and waiting for somewhere to go, and a queued folder
 * would mean answering "where do these live?" with "later".
 */
export async function createGallery(
  parentType: AttachmentParentType,
  parentId: string,
  name: string,
): Promise<{ id: string } | { error: string }> {
  await requireSession();

  const title = name.trim().slice(0, 120) || 'Gallery';

  try {
    /*
     * Where the folder goes is exactly where a file attached here would go —
     * the project's folder, or `GTD/Inbox` for anything unfiled. Asking
     * `attachmentFolder` rather than working it out again is what keeps a
     * gallery in the same place as the documents beside it, and it is also
     * what creates the project's folder on demand if this is the first thing
     * anyone has put in it.
     */
    const parentFolderId = await attachmentFolder(parentType, parentId);
    const folderId = await createGalleryFolder(title, parentFolderId);

    const [row] = await db
      .insert(attachments)
      .values({
        parentType,
        parentId,
        kind: 'gallery',
        driveFileId: folderId,
        name: title,
        driveName: title,
        // Drive's own type for a folder. Honest, and it is what makes every
        // "can I fetch bytes for this?" check answer no without being taught
        // about galleries.
        mimeType: 'application/vnd.google-apps.folder',
      })
      .returning({ id: attachments.id });

    revalidateShell();
    return { id: row.id };
  } catch {
    return { error: 'Drive would not make a folder for that gallery.' };
  }
}

/** The same, filed in a box rather than hung off a piece of work. */
export async function createBoxGallery(
  boxId: string,
  name: string,
  capturedAt?: Date,
): Promise<{ id: string } | { error: string }> {
  await requireSession();

  const title = name.trim().slice(0, 120) || 'Gallery';

  try {
    const parentFolderId = await ensureBoxFolder(boxId);
    if (!parentFolderId) return { error: 'That box has no folder in Drive yet.' };

    const folderId = await createGalleryFolder(title, parentFolderId);

    const [row] = await db
      .insert(boxItems)
      .values({
        boxId,
        kind: 'gallery',
        driveFileId: folderId,
        name: title,
        title,
        mimeType: 'application/vnd.google-apps.folder',
        /*
         * Ready, never pending. There is nothing for the classifier to read: a
         * folder has no bytes, and reading thirty photographs to write one
         * summary is a great deal of money for a caption you would rewrite. It
         * is titled by whoever made it, which is the better title anyway.
         */
        status: 'ready',
        searchText: title,
        ...(capturedAt ? { capturedAt } : {}),
      })
      .returning({ id: boxItems.id });

    revalidateShell();
    return { id: row.id };
  } catch {
    return { error: 'Drive would not make a folder for that gallery.' };
  }
}

/**
 * Take one picture out of a gallery.
 *
 * An ordinary attachment removal, which is the point of members being ordinary
 * attachments: the Drive file is trashed rather than deleted, exactly as it is
 * everywhere else, so a picture removed by accident is in a bin you can look in
 * rather than gone.
 */
export async function removeGalleryPicture(pictureId: string) {
  await requireSession();
  await removeAttachment(pictureId);
  revalidateShell();
}

/** Rename a gallery. The folder in Drive catches up on the next sweep. */
export async function renameGallery(galleryId: string, name: string) {
  await requireSession();

  const title = name.trim().slice(0, 120);
  if (!title) return;

  await db
    .update(attachments)
    .set({ name: title })
    .where(and(eq(attachments.id, galleryId), eq(attachments.kind, 'gallery')));

  await db
    .update(boxItems)
    .set({ title, searchText: title, updatedAt: new Date() })
    .where(and(eq(boxItems.id, galleryId), eq(boxItems.kind, 'gallery')));

  revalidateShell();
}

export async function detachAttachment(attachmentId: string) {
  await requireSession();
  await removeAttachment(attachmentId);
  revalidateShell();
}

/**
 * Rename an attachment, here and eventually in Drive.
 *
 * Only our row is written, because a mutation must not call Google. That is
 * not a compromise here so much as the mechanism: `drive_name` still holds
 * what Drive has, so the disagreement this creates *is* the instruction, and
 * the sweep on the cron tick — or "run sync now" — carries it over.
 *
 * The extension is kept whatever you type. Dropping it is the easiest thing in
 * the world to do by accident when you are editing a title, and it leaves a
 * file the operating system no longer knows how to open for the sake of a
 * character you probably didn't mean to delete.
 */
export async function renameAttachment(attachmentId: string, name: string) {
  await requireSession();

  const [row] = await db
    .select({ name: attachments.name })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  if (!row) return;

  const base = name.replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!base) return;

  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(row.name)?.[0] ?? '';
  const next =
    ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? `${base}${ext}` : base;

  if (next === row.name) return;

  await db
    .update(attachments)
    .set({ name: next })
    .where(eq(attachments.id, attachmentId));

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

  const [before] = await db
    .select({ name: boxes.name })
    .from(boxes)
    .where(eq(boxes.id, boxId))
    .limit(1);

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

  /*
   * A renamed box has to tell Google, and the Gmail half was not merely untidy.
   *
   * The email bridge reads which box a message is for out of the *label's* name
   * and the ingest route matches that against `boxes.name`; when nothing
   * matches it falls back to the default box. So a renamed box went on wearing
   * its old label and every message filed under it landed quietly in the Feed —
   * somewhere nobody chose, with nothing saying so. Drive was the milder
   * version of the same thing: `ensureBoxFolder` fixes the folder the next time
   * a document is filed, which may be never.
   *
   * Only when the name actually changed — this action also saves the
   * instruction and the rules, which are edited far more often and have nothing
   * to do with either container.
   */
  if (before && before.name !== trimmed) {
    after(async () => {
      await renameBoxContainers(boxId).catch(() => {});
    });
  }
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
    .select({ isDefault: boxes.isDefault, driveFolderId: boxes.driveFolderId })
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
  const refiled = await db
    .update(boxItems)
    .set({ boxId: fallback.id, updatedAt: new Date() })
    .where(eq(boxItems.boxId, boxId))
    .returning({ id: boxItems.id, driveFileId: boxItems.driveFileId });

  // Categories and tags cascade, and `box_item_tags` with them. The documents
  // keep everything that was theirs — name, summary, date, file.
  await db.delete(boxes).where(eq(boxes.id, boxId));

  revalidateShell();

  /*
   * The documents are in the default box now; their files are still in the
   * folder of a box that no longer exists.
   *
   * Queued only for the entries that have one — a note, a link or a place has
   * no file, and a box of thoughts would otherwise queue a Drive round trip per
   * row to discover that.
   */
  const withFiles = refiled.filter((row) => row.driveFileId);
  for (const row of withFiles) await enqueueFileMove({ boxItemId: row.id });

  /*
   * Then, and only then, the empty folder — which is why this one cannot use
   * `drainMovesAfterResponse`. The documents are *inside* that folder until the
   * moves run, so trashing it on the way past would put a year of receipts in
   * the bin along with it.
   *
   * The drain's own report is the permission: every move done, none failed and
   * none waiting to be retried. Anything else and the folder stays, because a
   * stray empty folder is a tidiness problem and the alternative is not.
   */
  after(async () => {
    try {
      const result = await drainSyncQueue(Math.max(withFiles.length, 1));

      const allMoved =
        result.done >= withFiles.length && result.failed === 0 && result.retrying === 0;

      if (allMoved) await trashBoxFolder(box.driveFolderId);
    } catch {
      // The box is deleted and the documents are safe. The folder is the cron's
      // problem now, and a leftover folder is not worth an error here.
    }
  });
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

/**
 * Make a tag and put it on this document, in one press.
 *
 * The vocabulary is managed on the Manage boxes page, and that is still where
 * you go to tidy one up — but the moment you most often discover a tag is
 * missing is the moment you are trying to apply it, and being sent to another
 * page to add it means losing the document you were looking at and coming back
 * to find your place. So the tag panel can make one.
 *
 * Creating and applying are one action rather than two, because a tag you have
 * just made and then have to go and find in a list of two hundred is most of
 * the friction still there. Applying rather than toggling, for the same reason:
 * you did not type a name in order to turn it off.
 *
 * Reuses an existing tag that differs only in case or surrounding space, which
 * is the rule every other tag comparison here follows — "tesco" typed in a
 * hurry is the Tesco already in the box, and a second row meaning the same
 * thing splits a filter in two for ever.
 */
export async function createTagOnDocument(
  itemId: string,
  categoryId: string,
  name: string,
) {
  await requireSession();

  const trimmed = name.trim();
  if (!trimmed) return;

  const [existing] = await db
    .select({ id: boxTags.id })
    .from(boxTags)
    .where(
      and(
        eq(boxTags.categoryId, categoryId),
        sql`lower(trim(${boxTags.name})) = lower(trim(${trimmed}))`,
      ),
    )
    .limit(1);

  /*
   * `returning` on a plain insert, with the lookup above rather than an
   * `onConflictDoNothing` — that returns nothing at all when it collides, and
   * this needs the id whichever way it went, or the tag is made and not
   * applied. There are no transactions on this driver, so a name that appears
   * between the two statements would throw on the unique index, which is the
   * right failure: nothing is applied and pressing again finds it.
   */
  const tagId =
    existing?.id ??
    (await db.insert(boxTags).values({ categoryId, name: trimmed }).returning({ id: boxTags.id }))[0]
      ?.id;

  if (!tagId) return;

  await db.insert(boxItemTags).values({ itemId, tagId }).onConflictDoNothing();

  revalidateShell();
}

/**
 * Put a tag under a category, with a name, and fold it into whatever is
 * already there under that name.
 *
 * A vocabulary is not written once. Categories get renamed, a tag turns out to
 * belong somewhere else, and the same shop gets typed twice in different
 * places — so renaming and re-filing have to be ordinary operations rather than
 * things you rebuild a box to achieve.
 *
 * **Every entry follows for free, and that is not luck.** `box_item_tags`
 * points at a tag by id, so a tag can be renamed or moved to another category
 * without a single document row changing: what a document is tagged *with* is
 * a reference, not a copy of a word. The same reason renaming a box leaves
 * every citation intact.
 *
 * **A collision merges rather than failing.** `box_tags` is unique on
 * (category, lower(name)), so renaming "tesco" to "Tesco" where Tesco already
 * exists, or moving a Vendor "Shell" into a Place that has one, would violate
 * that index and throw — which is the wrong answer to what was plainly meant.
 * Two tags with one name are one tag, so the documents are handed over and the
 * duplicate goes. `onConflictDoNothing` covers a document that carried both:
 * the pair is the primary key, so it is already tagged and there is nothing to
 * insert.
 *
 * Returns which tag survived, and whether anything was folded in, so the page
 * can say so — a count silently doubling is the kind of thing you want told
 * about rather than left to notice.
 */
async function settleTagInto(
  tagId: string,
  categoryId: string,
  name: string,
): Promise<{ id: string; merged: boolean } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const [existing] = await db
    .select({ id: boxTags.id })
    .from(boxTags)
    .where(
      and(
        eq(boxTags.categoryId, categoryId),
        ne(boxTags.id, tagId),
        sql`lower(trim(${boxTags.name})) = lower(trim(${trimmed}))`,
      ),
    )
    .limit(1);

  if (!existing) {
    await db
      .update(boxTags)
      .set({ categoryId, name: trimmed })
      .where(eq(boxTags.id, tagId));

    return { id: tagId, merged: false };
  }

  /*
   * Hand the documents over before the tag goes.
   *
   * There are no transactions on this driver, so the order is the safeguard:
   * done this way a failure part-way leaves both tags with the documents shared
   * between them, which is untidy and recoverable. The other order would delete
   * the tag first and lose every document that was only on it.
   */
  const carried = await db
    .select({ itemId: boxItemTags.itemId })
    .from(boxItemTags)
    .where(eq(boxItemTags.tagId, tagId));

  for (const row of carried) {
    await db
      .insert(boxItemTags)
      .values({ itemId: row.itemId, tagId: existing.id })
      .onConflictDoNothing();
  }

  await db.delete(boxTags).where(eq(boxTags.id, tagId));

  return { id: existing.id, merged: true };
}

export async function renameBoxTag(tagId: string, name: string) {
  await requireSession();

  const [tag] = await db
    .select({ categoryId: boxTags.categoryId })
    .from(boxTags)
    .where(eq(boxTags.id, tagId))
    .limit(1);

  if (!tag) return { ok: false as const, merged: false };

  const settled = await settleTagInto(tagId, tag.categoryId, name);
  revalidateShell();

  return { ok: settled !== null, merged: settled?.merged ?? false };
}

/**
 * File a tag under a different category.
 *
 * The destination must be in the same box, checked rather than assumed: a tag
 * dragged into another box's category would leave every document tagged with
 * something its own box has never heard of, and every facet count wrong with
 * nothing on screen explaining it.
 */
export async function moveBoxTag(tagId: string, categoryId: string) {
  await requireSession();

  const [tag] = await db
    .select({ name: boxTags.name, boxId: boxCategories.boxId })
    .from(boxTags)
    .innerJoin(boxCategories, eq(boxTags.categoryId, boxCategories.id))
    .where(eq(boxTags.id, tagId))
    .limit(1);

  const [target] = await db
    .select({ boxId: boxCategories.boxId })
    .from(boxCategories)
    .where(eq(boxCategories.id, categoryId))
    .limit(1);

  if (!tag || !target || tag.boxId !== target.boxId) {
    return { ok: false as const, merged: false };
  }

  const settled = await settleTagInto(tagId, categoryId, tag.name);
  revalidateShell();

  return { ok: settled !== null, merged: settled?.merged ?? false };
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

/**
 * Put a tag on a document, without the chance of taking one off.
 *
 * Deliberately not `toggleDocumentTag`. Dropping a tag onto a row is an
 * instruction — *this is a receipt* — and a drop that silently removed the tag
 * because it happened to be there already would be the one gesture in the app
 * whose meaning depends on state you cannot see while you are doing it. Landing
 * on a row that already has it is a no-op, which is what the person dragging
 * expected either way.
 */
export async function applyDocumentTag(itemId: string, tagId: string) {
  await requireSession();

  await db.insert(boxItemTags).values({ itemId, tagId }).onConflictDoNothing();

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
/**
 * A box entry's note, as a rich document.
 *
 * `description` stays the plain-text truth and is written from the same save:
 * the feed renders it, the classifier writes it, and `search_text` is built
 * from it — so a note formatted here is still one line in a list and still
 * findable by its words. Writing only the JSON would have made every richly
 * edited note invisible to search, which is the trap `notes` has on every
 * other table and the reason `extractText` exists.
 */
export async function updateBoxItemNotes(itemId: string, notes: unknown) {
  await requireSession();

  const plain = extractText(notes);

  const [row] = await db
    .select({ text: boxItems.text })
    .from(boxItems)
    .where(eq(boxItems.id, itemId))
    .limit(1);

  await db
    .update(boxItems)
    .set({
      notes,
      description: plain.trim() || null,
      // The vector is generated from this column, so anything that writes one
      // writes the other. The read-out text goes in too, as it always has.
      searchText: [plain.trim(), row?.text ?? '']
        .filter(Boolean)
        .join('\n')
        .slice(0, 100_000),
      updatedAt: new Date(),
    })
    .where(eq(boxItems.id, itemId));

  revalidateShell();
}

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

/**
 * How long this document is worth keeping. Null is forever, and is the default.
 *
 * Only the date is stored; the worker does the throwing away, on the same
 * `deleteBoxItem` path as the button — so the Drive file is trashed rather than
 * deleted and stays recoverable for thirty days. A date set wrongly is a
 * mistake with a month to notice it, not a loss.
 *
 * Refused if it is not a real date or is absurdly far out, the same rails the
 * arrival date uses: a year mistyped as 202 would otherwise mean "delete this
 * immediately", which is the worst possible reading of a typo.
 */
export async function setDocumentExpiry(itemId: string, date: string | null) {
  await requireSession();

  if (date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    const when = new Date(`${date}T00:00:00`);
    if (Number.isNaN(when.getTime())) return;
    if (when.getFullYear() < 1900 || when.getFullYear() > 2200) return;
  }

  await db
    .update(boxItems)
    .set({ expiresAt: date, updatedAt: new Date() })
    .where(eq(boxItems.id, itemId));

  revalidateShell();
}

/**
 * Correct when a file was added to this project, action or list item.
 *
 * The same reasoning as a document's arrival date, one list along: this is
 * what "Added — oldest first" orders by, so it decides where the row *is*. A
 * file uploaded today that actually belongs with last spring's paperwork sits
 * at the wrong end of the list otherwise, and the list is how you find it.
 *
 * Deliberately not touching anything in Drive. This is our record of when the
 * file joined this project, not a claim about the file itself.
 */
export async function setAttachmentAddedAt(attachmentId: string, iso: string) {
  await requireSession();

  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return;

  // The same rails as a document's arrival: a year typed as 202 rather than
  // 2025 would otherwise bury the row at the bottom of the list forever.
  const tooOld = when.getTime() < Date.UTC(1900, 0, 1);
  const inFuture = when.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000;
  if (tooOld || inFuture) return;

  await db
    .update(attachments)
    .set({ createdAt: when })
    .where(eq(attachments.id, attachmentId));

  revalidateShell();
}

/** Move a document to another box. Its tags don't come with it — they belong
 *  to the box it left, so it is queued to be read again under the new one. */
/**
 * The same entry again, in another box, independent of the first.
 *
 * Dragging moves; dragging with Ctrl held copies — the convention every file
 * manager uses, which is why it needs no button. The case is a document that
 * genuinely belongs in two places: a receipt that is both a purchase and a tax
 * record, a letter that is correspondence and evidence.
 *
 * **The bytes are copied, not shared.** Two rows pointing at one Drive file
 * would mean throwing either away trashed the other's document, and a copy
 * exists precisely so the two can be dealt with separately.
 *
 * Tags are carried the way a *move* carries them — matched on category and tag
 * against the destination's own vocabulary — because the question "which of
 * these labels means anything over there" has one answer whichever way the
 * document travels.
 */
export async function copyDocument(itemId: string, boxId: string) {
  await requireSession();

  const [item] = await db.select().from(boxItems).where(eq(boxItems.id, itemId)).limit(1);
  if (!item || item.boxId === boxId) return;

  /*
   * The file first. If Drive refuses, nothing is written — which is the right
   * order: a row claiming a document it has no copy of would be worse than no
   * row at all, and the reverse order cannot be undone without transactions.
   */
  const copied = await copyBoxItemFile(item, boxId);

  const [made] = await db
    .insert(boxItems)
    .values({
      boxId,
      kind: item.kind,
      status: item.status,
      driveFileId: copied.driveFileId,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      title: item.title,
      description: item.description,
      searchText: item.searchText,
      text: item.text,
      emoji: item.emoji,
      url: item.url,
      docDate: item.docDate,
      capturedAt: item.capturedAt,
      lat: item.lat,
      lng: item.lng,
      /*
       * `source_id` *is* carried: a copy of an email entry is the same Gmail
       * message, filed in a second box, and pretending otherwise would leave
       * Gmail unable to say so. That is safe because the "already filed?" check
       * is per box — a message filed in one box is still eligible for another,
       * which is exactly what labelling it into a second box means.
       *
       * Gmail does not yet carry the new box's label; the bridge adds it on its
       * next run, by comparing what a thread wears against what the app says it
       * should.
       */
      sourceId: item.sourceId,
    })
    .returning({ id: boxItems.id });

  /*
   * A gallery's pictures need rows of their own, parented on the new gallery.
   * Without them the copy is a folder with the files in it and nothing in the
   * app to show — the half-success `copyBoxItemFile` exists to avoid.
   *
   * Copied from the originals so every fact about each picture comes too: its
   * size and type, and the dimensions, date and place read out of the file when
   * it was first added. Deliberately *not* copied are `ocr_text` and
   * `transcription`, and no enrichment is queued: it is the same picture, and
   * paying a model to read it again would buy what is already written down
   * beside the original.
   */
  if (copied.pictures.length > 0) {
    const originals = await db
      .select()
      .from(attachments)
      .where(
        inArray(
          attachments.id,
          copied.pictures.map((picture) => picture.sourceId),
        ),
      );

    const byId = new Map(originals.map((row) => [row.id, row]));

    for (const picture of copied.pictures) {
      const from = byId.get(picture.sourceId);
      if (!from) continue;

      await db.insert(attachments).values({
        parentType: 'gallery',
        parentId: made.id,
        driveFileId: picture.driveFileId,
        // Drive holds what was just written, so the sweep has nothing to do.
        driveName: picture.name,
        name: picture.name,
        mimeType: from.mimeType,
        sizeBytes: from.sizeBytes,
        kind: from.kind,
        width: from.width,
        height: from.height,
        takenAt: from.takenAt,
        latitude: from.latitude,
        longitude: from.longitude,
      });
    }
  }

  const kept = await db
    .select({ id: boxTags.id })
    .from(boxTags)
    .innerJoin(boxCategories, eq(boxCategories.id, boxTags.categoryId))
    .where(
      sql`${boxCategories.boxId} = ${boxId} and exists (
        select 1
        from ${boxItemTags} it
        join ${boxTags} ot on ot.id = it.tag_id
        join ${boxCategories} oc on oc.id = ot.category_id
        where it.item_id = ${itemId}
          and lower(btrim(oc.name)) = lower(btrim(${boxCategories.name}))
          and lower(btrim(ot.name)) = lower(btrim(${boxTags.name}))
      )`,
    );

  if (kept.length > 0) {
    await db
      .insert(boxItemTags)
      .values(kept.map((tag) => ({ itemId: made.id, tagId: tag.id })))
      .onConflictDoNothing();
  }

  revalidateShell();
  return made.id;
}

export async function moveDocument(itemId: string, boxId: string) {
  await requireSession();

  /**
   * Tags that mean the same thing in both boxes travel with the document.
   *
   * A tag belongs to the box that defines it, so the ones the destination has
   * never heard of cannot come — but throwing them all away, which this used
   * to do, loses work for no reason when both boxes know what a Shell receipt
   * is. The match is on the *category* as well as the tag: a tag is
   * "Vendor: Shell", not "Shell", and dropping the first half would let a
   * vendor land in a category about places.
   *
   * The ids have to be the destination's own rows. The same word in two boxes
   * is two rows, because the vocabulary is per box — carrying the old ids
   * across would leave the document wearing another box's tags.
   *
   * Case- and space-insensitive, the same rule the classifier's gate uses, so
   * "tesco" on one side finds "Tesco" on the other.
   */
  const kept = await db
    .select({ id: boxTags.id })
    .from(boxTags)
    .innerJoin(boxCategories, eq(boxCategories.id, boxTags.categoryId))
    .where(
      sql`${boxCategories.boxId} = ${boxId} and exists (
        select 1
        from ${boxItemTags} it
        join ${boxTags} ot on ot.id = it.tag_id
        join ${boxCategories} oc on oc.id = ot.category_id
        where it.item_id = ${itemId}
          and lower(btrim(oc.name)) = lower(btrim(${boxCategories.name}))
          and lower(btrim(ot.name)) = lower(btrim(${boxTags.name}))
      )`,
    );

  // Ordered so a failure part-way leaves the document where it was rather than
  // in the new box wearing the old box's labels.
  await db.delete(boxItemTags).where(eq(boxItemTags.itemId, itemId));

  if (kept.length > 0) {
    await db
      .insert(boxItemTags)
      .values(kept.map((tag) => ({ itemId, tagId: tag.id })))
      .onConflictDoNothing();
  }

  await db
    .update(boxItems)
    .set({ boxId, updatedAt: new Date() })
    .where(eq(boxItems.id, itemId));

  /*
   * And the file follows into the new box's folder.
   *
   * A box owns a Drive folder, so a document moved between boxes and left in
   * the old one is the app and Drive disagreeing about where something is filed
   * — which is the whole thing a box is for. The tags were carefully carried
   * across above; the bytes were not.
   */
  await enqueueFileMove({ boxItemId: itemId });
  drainMovesAfterResponse(1);

  /**
   * No re-read. The destination's vocabulary may well suggest more tags, but a
   * move is not a request to spend money and overwrite what you have corrected
   * by hand — "Read it again" is right there when it is what you meant.
   */
  revalidateShell();
}

/**
 * Make a new document in a box and hand back enough to open it.
 *
 * The pane needs the Drive id as well as the row id, because a Google format
 * is previewed by embedding Google’s own editor and that addresses Drive
 * directly. Returning it here saves the caller a second read of a row it has
 * just caused to exist.
 */
export async function createBoxFile(boxId: string, mimeType: string, name: string) {
  await requireSession();
  const row = await createBoxDocument(boxId, mimeType, name);
  revalidateShell();
  return row;
}

/**
 * Ask the bridge to fetch a message you have not labelled.
 *
 * The app cannot read Gmail and is not going to start: the scope that would
 * let it is restricted, and the cost of holding one is either an annual
 * security assessment or a refresh token Google expires weekly — the same
 * token Drive sync and the calendar run on. So this writes down that you asked
 * and the Apps Script picks it up.
 *
 * Refuses a Gmail permalink out loud rather than accepting one and failing an
 * hour later inside a script, because the id in it is one only Gmail’s own
 * interface understands.
 */
export async function requestEmail(
  /**
   * Which box it lands in, or null to use the default one.
   *
   * Null is what a project pane passes. A message asked for from a project is
   * still a document and still belongs in a box — one that existed only as a
   * project’s evidence would disappear with the project — but *which* box is
   * not a question worth asking at that moment, and the default box is the
   * same answer the scanner bridge gives to the same question.
   */
  boxId: string | null,
  raw: string,
  /** What to cite it on once it arrives, when you asked from a pane. */
  parent?: RequestParent,
) {
  await requireSession();

  const read = readEmailQuery(raw);
  if ('refuse' in read) return { ok: false as const, error: read.refuse };

  const box = boxId ?? (await defaultBox());
  if (!box) {
    return {
      ok: false as const,
      error: 'There is no box to file it in. Set one up on the Big Box page first.',
    };
  }

  await createEmailRequest(box, read.query, parent);

  /*
   * Asking for a message *on a project* is the moment that project wants a
   * Gmail label — it is where you would file the reply, and where the bridge
   * will look. Asking for one on its own is not: that message is going to a
   * box, and a box is not a project.
   *
   * The Drive folder is deliberately not made here. Wanting somewhere to file
   * mail says nothing about wanting somewhere to put files, and making both
   * because you asked for one is the habit this is getting rid of.
   */
  if (parent?.parentType === 'project') {
    await enqueueSync('create_project_label', parent.parentId);
  }

  revalidateShell();

  return { ok: true as const };
}

/**
 * The box a message goes to when nobody chose one.
 *
 * Read rather than created, unlike `createDefaultBox`: this runs on a paste
 * into a project pane, and quietly making a box because you pasted a URL is
 * not a thing to do behind someone’s back. Null means there is no Big Box yet
 * and the caller says so.
 */
async function defaultBox(): Promise<string | null> {
  const [row] = await db
    .select({ id: boxes.id })
    .from(boxes)
    .where(eq(boxes.isDefault, true))
    .limit(1);

  return row?.id ?? null;
}

/**
 * Put an entry in its box's feed, or take it out again.
 *
 * The only thing that arrives unlisted is a message fetched for a project:
 * you asked for it there, so that is where it belongs, and a feed you read
 * like a journal should not fill up with correspondence you never filed. But
 * some of it *is* worth filing — the quote you will want beside the receipts
 * — and this is how you say so, from the pane, one entry at a time.
 *
 * Reversible in both directions, because the judgement can go either way and
 * a one-way door would make people hesitate before using it.
 */
/**
 * Lift an entry to the top of its box, or put it back in the timeline.
 *
 * Pinned entries are pulled out of the day grouping rather than sorted within
 * it: a box is ordered by arrival and that ordering is the filing system, so
 * moving one row up the middle of it would make every heading a little bit of
 * a lie. Out of the timeline and above it is the honest place.
 */
export async function setBoxItemPinned(itemId: string, pinned: boolean) {
  await requireSession();

  await db
    .update(boxItems)
    .set({ pinned, updatedAt: new Date() })
    .where(eq(boxItems.id, itemId));

  revalidateShell();
}

export async function setBoxItemListed(id: string, listed: boolean) {
  await requireSession();

  await db
    .update(boxItems)
    .set({ listed, updatedAt: new Date() })
    .where(eq(boxItems.id, id));

  revalidateShell();
}

/**
 * Remember where the Apps Script panel is deployed.
 *
 * Typed in rather than committed: a deployment URL names one person’s script
 * in one person’s Google account, and this repository is public. It is also
 * the sort of thing that changes — a fresh deployment rather than a new
 * version of an existing one gives a different URL — and a setting can be
 * corrected on the page it is used from.
 *
 * Only an Apps Script address is accepted. The button opens in a new tab and
 * runs with your Google session, so an arbitrary URL saved here would be a
 * link the app vouches for and should not.
 */
export async function setAppsScriptUrl(raw: string) {
  await requireSession();

  const url = raw.trim();

  if (url === "") {
    await db
      .insert(preferences)
      .values({ id: SINGLETON, appsScriptUrl: null })
      .onConflictDoUpdate({
        target: preferences.id,
        set: { appsScriptUrl: null, updatedAt: new Date() },
      });

    revalidateShell();
    return { ok: true as const };
  }

  if (!/^https:\/\/script\.google\.com\/[^\s]+$/i.test(url)) {
    return {
      ok: false as const,
      error:
        'That is not an Apps Script address. Deploy the panel as a web app and paste the /exec URL, which begins https://script.google.com/.',
    };
  }

  await db
    .insert(preferences)
    .values({ id: SINGLETON, appsScriptUrl: url })
    .onConflictDoUpdate({
      target: preferences.id,
      set: { appsScriptUrl: url, updatedAt: new Date() },
    });

  revalidateShell();
  return { ok: true as const };
}

/** Clear a request you have read the failure of. */
export async function forgetEmail(id: string) {
  await requireSession();
  await forgetEmailRequest(id);
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

  /*
   * Citing a *message* on a project is the same signal as asking for one: this
   * project has correspondence, so it wants somewhere in Gmail to keep it.
   * Citing a document is not — a Big Box document lives in the box's folder and
   * linking touches nothing in Drive at all, which is the whole reason a link
   * is a link and not an attachment.
   */
  if (parentType === 'project') {
    const [item] = await db
      .select({ kind: boxItems.kind })
      .from(boxItems)
      .where(eq(boxItems.id, itemId))
      .limit(1);

    if (item?.kind === 'email') await enqueueSync('create_project_label', parentId);
  }

  revalidateShell();
}

/**
 * Move a file or a cited document from an action up to its project.
 *
 * A file lands on the step you were looking at when you attached it, which at
 * the time is exactly right — you were on that step. What you find out later is
 * that the step is finished and the quote is still relevant, or that three
 * different steps each hold one page of the same thing. **The project is the
 * unit you go looking in a year later**, which is the same reasoning that puts
 * an action's upload in its *project's* Drive folder rather than a folder of
 * its own: this is that rule catching up with a decision already made.
 *
 * Only upwards, and only to the project the thing already belongs to. Somewhere
 * to *choose* a new parent would be a mover, and a mover needs a picker, a
 * confirmation and an answer for what happens to a file moved to a project in
 * a different Drive folder. This needs none of that, because the destination is
 * not a choice — it is the one place the row is already related to.
 *
 * Nothing moves in Drive either way, which is what makes it cheap: an action's
 * files are in the project's folder to begin with.
 */
export async function moveAttachmentToProject(attachmentId: string) {
  await requireSession();

  /*
   * The project is read through the action rather than passed in. A client
   * saying which project to move a file to would be a client choosing an
   * attachment's parent, and this is deliberately not that — the whole
   * guarantee is that it can only go where it already belongs.
   */
  const [row] = await db
    .select({ projectId: actions.projectId })
    .from(attachments)
    .innerJoin(actions, eq(actions.id, attachments.parentId))
    .where(and(eq(attachments.id, attachmentId), eq(attachments.parentType, 'action')))
    .limit(1);

  if (!row?.projectId) return;

  await db
    .update(attachments)
    .set({ parentType: 'project', parentId: row.projectId })
    .where(eq(attachments.id, attachmentId));

  revalidateShell();
}

/** The same move for a cited box document — a link rewritten, nothing copied. */
export async function moveLinkToProject(itemId: string, actionId: string) {
  await requireSession();

  const [action] = await db
    .select({ projectId: actions.projectId })
    .from(actions)
    .where(eq(actions.id, actionId))
    .limit(1);

  if (!action?.projectId) return;

  /*
   * Written before the old one is removed, and `onConflictDoNothing` because
   * the document may already be cited on the project as well — in which case
   * the move is just the unlink below. Doing it the other way round would, on
   * a failure between the two statements, leave the document cited nowhere:
   * there are no transactions on this driver, so the order *is* the safety.
   */
  await db
    .insert(boxItemLinks)
    .values({ itemId, parentType: 'project', parentId: action.projectId })
    .onConflictDoNothing();

  // Same signal `linkDocument` sends: a message cited on a project means that
  // project has correspondence and wants somewhere in Gmail to keep it.
  const [item] = await db
    .select({ kind: boxItems.kind })
    .from(boxItems)
    .where(eq(boxItems.id, itemId))
    .limit(1);

  if (item?.kind === 'email') await enqueueSync('create_project_label', action.projectId);

  await db
    .delete(boxItemLinks)
    .where(
      and(
        eq(boxItemLinks.itemId, itemId),
        eq(boxItemLinks.parentType, 'action'),
        eq(boxItemLinks.parentId, actionId),
      ),
    );

  await relistUncitedDocuments([itemId]);

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

  await relistUncitedDocuments([itemId]);

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

/**
 * Write the line about a day.
 *
 * Keyed on the day alone, and not on the box it was typed in. You only had the
 * one Tuesday: a box is how documents are grouped, and the day you had is the
 * same day whichever shelf you happen to be looking at. Per box, the note left
 * in Receipts would be invisible from Feed and the same afternoon would get
 * described twice.
 *
 * An empty note deletes the row rather than storing a blank, so "nothing
 * written here" is the absence of a row rather than a row saying nothing —
 * which keeps every feed's lookup honest: a day is in the map or it is not.
 */
export async function setBoxDayNote(day: string, note: string) {
  await requireSession();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;

  const text = note.trim().slice(0, 10_000);

  if (!text) {
    await db.delete(boxDays).where(eq(boxDays.day, day));
  } else {
    await db
      .insert(boxDays)
      .values({ day, note: text })
      .onConflictDoUpdate({
        target: boxDays.day,
        set: { note: text, updatedAt: new Date() },
      });
  }

  revalidateShell();
}

/**
 * Where a capture dragged out of the inbox lands.
 *
 * The same five decisions the clarify panel offers, named as destinations
 * rather than as forms — because that is what a drag is. Dropping a capture on
 * "What can I do now" *is* saying it is a next action, and having to then fill
 * in the title it already has would be the app asking a question it can read
 * the answer to.
 */
export type CaptureDrop =
  | { kind: 'now' }
  | { kind: 'waiting' }
  | { kind: 'project' }
  | { kind: 'list'; listId: string }
  | { kind: 'box'; boxId: string };

/**
 * Clarify a capture by dropping it somewhere.
 *
 * Processing an inbox is mostly a sequence of small obvious decisions, and the
 * panel makes each one cost a selection, a form and a confirm. Most captures
 * do not need any of that: you know where it goes the moment you read the
 * line. Dragging it there says so in one gesture.
 *
 * The title and note come off the capture rather than the caller, using the
 * same rule the panel seeds its fields with — first line the title, the rest
 * the note. Nothing new is being decided here, so nothing new should have to
 * be typed, and the outcome is identical to having opened the form and pressed
 * confirm without changing anything.
 *
 * It routes through `clarifyInboxItem` rather than reimplementing any of it:
 * the attachment re-parenting, the `outcome` stamp and the immutability of the
 * raw capture are all decisions that must not have a second version.
 */
export async function dropCapture(itemId: string, target: CaptureDrop) {
  await requireSession();

  const [item] = await db
    .select({ rawText: inboxItems.rawText, status: inboxItems.status })
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  if (!item || item.status === 'clarified') return;

  const lines = (item.rawText ?? '').split('\n');
  const note = lines.slice(1).join('\n').trim();

  /*
   * A photo with no note has no first line to use. The clarify panel falls
   * back to the file's name in that case and so does this, because a list
   * item called "" is not a thing you can find again.
   */
  let title = lines[0]?.trim() ?? '';

  if (!title) {
    const [file] = await db
      .select({ name: attachments.name })
      .from(attachments)
      .where(
        and(eq(attachments.parentType, 'inbox_item'), eq(attachments.parentId, itemId)),
      )
      .limit(1);

    title = file?.name ?? 'Untitled';
  }

  const decision: ClarifyDecision =
    target.kind === 'list'
      ? { kind: 'list_item', title, listId: target.listId, note }
      : target.kind === 'box'
        ? { kind: 'filed', title, boxId: target.boxId, note }
        : target.kind === 'project'
          ? { kind: 'project', title, areaId: null, note }
          : {
              kind: target.kind === 'waiting' ? 'waiting' : 'next_action',
              title,
              projectId: null,
              contextIds: [],
              note,
            };

  await clarifyInboxItem(itemId, decision);
}

/** Read a list in your order, or in the order things arrived. */
export async function setListLayout(key: string, layout: ListLayout) {
  await requireSession();
  await setLayout(key, layout);
  revalidateShell();
}

/**
 * Work out what a shared listing is offering to sell you.
 *
 * Its own action rather than part of the capture, because reading is a step
 * you take *before* deciding — you look at what it found, correct it, and then
 * post. Folding it into the write would mean a wrong price arriving in the
 * budget with no chance to catch it.
 */
export async function suggestPurchase(text: string): Promise<PurchaseRead> {
  await requireSession();
  return readPurchase(text);
}

/**
 * Add something to a purchases list, with what it costs.
 *
 * Straight to the list rather than through the inbox, which is the whole point
 * of the tab: a thing you want to buy is already clarified — you know what it
 * is and you know it is a purchase — so routing it through a queue that exists
 * to answer "what is this?" adds a step and clutters the queue.
 */
export async function addPurchase(
  listId: string,
  title: string,
  fields: PurchaseFields,
  note: string,
) {
  await requireSession();

  const trimmed = title.trim();
  if (!trimmed) return null;

  const [row] = await db
    .insert(listItems)
    .values({
      listId,
      title: trimmed,
      fields,
      ...noteColumns(note),
    })
    .returning({ id: listItems.id });

  revalidateShell();
  return row.id;
}

// ---------------------------------------------------------------------------
// Emoji
// ---------------------------------------------------------------------------

/**
 * Which list is being marked.
 *
 * Every one of these is a list you read down looking for a particular row,
 * which is the only thing an emoji helps with. A detail pane has one row in it
 * and needs no help finding it.
 */
export type EmojiTarget = 'inbox' | 'actions' | 'projects' | 'list_items' | 'box';

/**
 * The table behind each, and which column holds the words to judge by.
 *
 * A table rather than a switch in three places: adding the sixth list should be
 * one line here, not a hunt through the read, the write and the clear for the
 * three places that each name every target.
 */
const EMOJI_TABLES = {
  inbox: { table: inboxItems, title: inboxItems.rawText },
  actions: { table: actions, title: actions.title },
  projects: { table: projects, title: projects.title },
  list_items: { table: listItems, title: listItems.title },
  /*
   * A box document's title is written by the model that read it, so this marks
   * from what the reading already produced rather than opening the file again.
   * Re-reading would be the honest way to get the best answer and costs a
   * document read apiece — a PDF bills as its text *and* an image of every
   * page — to improve a glyph. New documents get theirs from the classifier,
   * where it is free; this is how the ones already filed catch up.
   */
  box: {
    table: boxItems,
    /*
     * Whatever this entry has words in, in the order they are worth reading.
     *
     * `title` is written by the model that read the document — but a *note* has
     * no title at all and keeps its text in `description`, and a document not
     * yet read has neither and only a filename. Asking for `title` alone
     * silently skipped every note and every pending scan, which was a fifth of
     * the box saying nothing.
     */
    title: sql<string>`coalesce(${boxItems.title}, ${boxItems.description}, ${boxItems.name})`,
  },
} as const;

/**
 * Put an emoji in front of each of these rows.
 *
 * Pressed, never automatic. It costs a model call, and a list that quietly
 * spent money every time it rendered would be the opposite of what a queue is
 * for — so this runs over the ids the page had on screen when you pressed it,
 * once, and writes the answers down.
 *
 * The ids come from the caller rather than being re-queried here, and that is
 * deliberate: what you asked to mark is what you were looking at, filters and
 * all. Re-reading the table would silently mark a hundred rows you had scrolled
 * past a filter to exclude, and bill you for them.
 *
 * Rows the model skipped keep whatever they had. Clearing a good emoji because
 * one answer came back as a word would make pressing the button a risk.
 */
export async function emojifyRows(
  target: EmojiTarget,
  ids: string[],
  /**
   * Whether to re-ask about rows that already have one.
   *
   * Off by default, and that is the whole shape of the button: pressing it a
   * second time should fill the gaps, not spend a model call re-deciding two
   * hundred rows you have already looked at — and possibly changing one you had
   * corrected by hand. Redoing is a deliberate thing, not the default one.
   */
  redo = false,
) {
  await requireSession();

  const wanted = [...new Set(ids)].filter(Boolean);
  if (wanted.length === 0) return { ok: true as const, marked: 0 };

  const { table, title } = EMOJI_TABLES[target];

  const rows = (
    await db
      .select({ id: table.id, title, emoji: table.emoji })
      .from(table)
      .where(inArray(table.id, wanted))
  ).filter((row) => redo || !row.emoji);

  // Everything already had one. Not a failure: it is the answer.
  if (rows.length === 0) return { ok: true as const, marked: 0 };

  /*
   * The first line only, which is the title everywhere else in the app — a
   * capture is one `raw_text` with the note under a blank line, and sending the
   * note would spend tokens on the paragraph explaining *why* you wrote the
   * thing down rather than on what it is.
   */
  const asked = rows.map((row) => ({
    id: row.id,
    title: (row.title ?? '').split('\n')[0].trim(),
  }));

  const { found, failure } = await pickEmoji(
    asked,
    target === 'box' ? 'document' : 'task',
  );

  if (found.size === 0) {
    /*
     * The reason, not a guess at it.
     *
     * This used to say "that usually means CHATGPT_API_KEY is not set", which
     * was one possibility out of many stated as a finding — and reported
     * exactly the same way when the key was present and OpenAI had refused for
     * some other reason entirely. A retired model in `EMOJI_MODEL`, an
     * exhausted quota and a rate limit all read as a missing key, sending you
     * to look at a Vercel setting that was correct all along.
     */
    return {
      ok: false as const,
      error: failure ?? 'No emoji came back, and OpenAI gave no reason.',
    };
  }

  /*
   * One statement rather than a write per row. Every await on the Neon driver
   * is its own HTTP round trip, so forty rows would be forty of them for a
   * column three characters wide.
   */
  const cases = sql.join(
    [...found].map(([id, emoji]) => sql`when ${id}::uuid then ${emoji}`),
    sql` `,
  );

  await db
    .update(table)
    .set({ emoji: sql`case ${table.id} ${cases} end` })
    .where(inArray(table.id, [...found.keys()]));

  revalidateShell();
  return { ok: true as const, marked: found.size };
}

/**
 * Take them off again.
 *
 * The way back, and the reason the emoji is its own column rather than a prefix
 * on the title: prefixed into the text it would have reached search, Drive
 * filenames and every export, and there would be nothing to undo it with.
 */
export async function clearEmoji(target: EmojiTarget, ids: string[]) {
  await requireSession();

  const wanted = [...new Set(ids)].filter(Boolean);
  if (wanted.length === 0) return;

  const { table } = EMOJI_TABLES[target];
  await db.update(table).set({ emoji: null }).where(inArray(table.id, wanted));

  revalidateShell();
}

/**
 * Emoji for a whole box, asked for from the sidebar.
 *
 * The list button takes its ids from the page, deliberately: what you asked to
 * mark is what you were looking at, filters and all. From the sidebar there is
 * nothing being looked at — you have named a *box*, not a view of one — so this
 * resolves its own rows, and means every document in it whatever is on screen.
 * That is the honest reading of "redo this box", and it is why it is a separate
 * entry point rather than the same one with the ids left out.
 *
 * The header button is gone: a box pane already carries the pending count, the
 * gallery switch and the tag link, and a fourth control there was crowding the
 * one header with the most in it.
 */
export async function emojifyBox(boxId: string, redo = false) {
  await requireSession();

  const rows = await db
    .select({ id: boxItems.id })
    .from(boxItems)
    .where(eq(boxItems.boxId, boxId));

  return emojifyRows(
    'box',
    rows.map((row) => row.id),
    redo,
  );
}

/** Take them off, for the whole box. The documents keep their type icons. */
export async function clearBoxEmoji(boxId: string) {
  await requireSession();

  await db.update(boxItems).set({ emoji: null }).where(eq(boxItems.boxId, boxId));
  revalidateShell();
}

/**
 * Set one row's emoji by hand, or clear it.
 *
 * The model is a starting point and not an authority. It will call a project
 * about a kitchen extension a saucepan, and you are the one who has to
 * recognise that row at a glance for the next six months — so every emoji it
 * chooses is editable, and any row can be given one without asking it at all.
 *
 * The same five tables the button knows about, through the same map, so a list
 * that can be emojified can always be corrected and there is no third place
 * naming the tables.
 *
 * `null` clears it. Passing something that is not a single glyph is refused
 * rather than stored: the slot is a fixed width, and a word in it would push
 * every title on the list sideways.
 */
export async function setEmoji(target: EmojiTarget, id: string, emoji: string | null) {
  await requireSession();

  const clean = emoji === null ? null : oneEmoji(emoji);
  if (emoji !== null && clean === null) {
    return { ok: false as const, error: 'That needs to be a single emoji.' };
  }

  const { table } = EMOJI_TABLES[target];
  await db.update(table).set({ emoji: clean }).where(eq(table.id, id));

  revalidateShell();
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Milestones on a box timeline
// ---------------------------------------------------------------------------

/**
 * An event row carries almost nothing, and that is the design.
 *
 * A project id and a date. The title, and therefore every word a reader sees,
 * is joined from the project when the feed is read — so renaming a project
 * rewrites its history everywhere it appears, which is the only version of this
 * that stays true. `name` is required by the table and is never shown for an
 * event; it holds the moment rather than a filename, so a row inspected in the
 * database still says what it is.
 */
async function writeEvent(
  boxId: string,
  projectId: string,
  event: 'started' | 'concluded',
  when: Date,
) {
  await db.insert(boxItems).values({
    boxId,
    projectId,
    event,
    kind: 'event',
    name: event,
    // Nothing here is queued or read: an event has no file and no words of its
    // own, so there is nothing a model could add.
    status: 'ready',
    capturedAt: when,
  });
}

/**
 * Show a project's milestones on a box's timeline.
 *
 * A box is already read as a timeline, and what a project *did* belongs among
 * the receipts and letters of the months it was happening in — "Started the
 * kitchen" three lines above the first quote for it says something neither row
 * says alone.
 *
 * The link is the events themselves rather than a table of its own. There is
 * nothing a link would record that the presence of a started event does not
 * already say, and a second place to keep in step is a second place to drift.
 *
 * A project already finished gets both marks at once, because the point is to
 * see the shape of a year you have already had, not only the one you are in.
 */
export async function showProjectOnTimeline(projectId: string, boxId: string) {
  await requireSession();

  const [project] = await db
    .select({
      createdAt: projects.createdAt,
      completedAt: projects.completedAt,
      status: projects.status,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return { ok: false as const, error: 'That project is gone.' };

  // Already there: adding it twice would put two identical lines in the feed.
  const [existing] = await db
    .select({ id: boxItems.id })
    .from(boxItems)
    .where(
      and(
        eq(boxItems.boxId, boxId),
        eq(boxItems.projectId, projectId),
        eq(boxItems.kind, 'event'),
      ),
    )
    .limit(1);

  if (existing) return { ok: false as const, error: 'It is already on that timeline.' };

  await writeEvent(boxId, projectId, 'started', project.createdAt);

  if (ARCHIVED.includes(project.status) && project.completedAt) {
    await writeEvent(boxId, projectId, 'concluded', project.completedAt);
  }

  revalidateShell();
  return { ok: true as const };
}

/** Take a project off a timeline. Both marks go; the project is untouched. */
export async function hideProjectFromTimeline(projectId: string, boxId: string) {
  await requireSession();

  await db
    .delete(boxItems)
    .where(
      and(
        eq(boxItems.boxId, boxId),
        eq(boxItems.projectId, projectId),
        eq(boxItems.kind, 'event'),
      ),
    );

  revalidateShell();
}

/**
 * Keep the conclusion marks in step with the project's actual status.
 *
 * Called from `setProjectStatus`, and it writes to *every* timeline the project
 * is on rather than one — being on two is a thing you can do, and a conclusion
 * appearing on one of them would be worse than it appearing on neither.
 *
 * Reopening deletes the mark rather than leaving it. A concluded line above a
 * live project is a record of something that did not happen, and re-archiving
 * writes it again with whatever date it really finished on.
 */
async function syncConclusionEvents(projectId: string, completedAt: Date | null) {
  const rows = await db
    .selectDistinct({ boxId: boxItems.boxId })
    .from(boxItems)
    .where(and(eq(boxItems.projectId, projectId), eq(boxItems.kind, 'event')));

  if (rows.length === 0) return;

  await db
    .delete(boxItems)
    .where(
      and(
        eq(boxItems.projectId, projectId),
        eq(boxItems.kind, 'event'),
        eq(boxItems.event, 'concluded'),
      ),
    );

  if (!completedAt) return;

  for (const row of rows) {
    await writeEvent(row.boxId, projectId, 'concluded', completedAt);
  }
}

/** Which boxes a project's milestones are on, for the control that sets them. */
export async function timelinesFor(projectId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ boxId: boxItems.boxId })
    .from(boxItems)
    .where(and(eq(boxItems.projectId, projectId), eq(boxItems.kind, 'event')));

  return rows.map((row) => row.boxId);
}

/**
 * Fix the first line of a capture.
 *
 * **This does not contradict "raw capture is immutable", and the distinction is
 * worth being exact about.** That rule constrains the *app*: the suggester must
 * never rewrite what you wrote, and clarifying must stamp its outcome beside the
 * original rather than editing it. Both exist so the app cannot quietly change
 * your words — so that what you find in six months is what you actually typed.
 *
 * None of that is an argument for stopping *you* correcting your own typo. The
 * record being protected is protection against the machine, not against the
 * author, and a queue you cannot fix a mis-tap in is a queue with a permanent
 * piece of grit in it.
 *
 * Only the first line. A capture is one `raw_text` — first line the title, blank
 * line, then the note — and the title is the part a list shows and the part you
 * would want to fix. The note underneath is left exactly as it was.
 */
export async function renameCapture(itemId: string, title: string) {
  await requireSession();

  const next = title.trim();
  if (!next) return;

  const [item] = await db
    .select({ rawText: inboxItems.rawText })
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .limit(1);

  if (!item) return;

  /*
   * Normalised on the way through, for the same reason `docFromText` does it.
   *
   * A capture typed into a textarea arrives with CRLF, and rebuilding the text
   * with a bare newline in front of the remainder leaves `\n\r\n` in the middle
   * of the document — a stray carriage return that survives every `trim()` and
   * turns up later as a blank line nobody typed. Found by reading the stored
   * bytes after the first rename; the row on screen looked perfectly correct.
   */
  const lines = (item.rawText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const rest = lines.slice(1).join('\n');

  /*
   * A capture that was only ever a title gets no trailing newline, and one with
   * a note keeps the blank line that separates the two — the shape every reader
   * of this column already expects.
   */
  await db
    .update(inboxItems)
    .set({ rawText: rest.trim() ? `${next}\n${rest}` : next })
    .where(eq(inboxItems.id, itemId));

  revalidateShell();
}

// ---------------------------------------------------------------------------
// What the AI costs
// ---------------------------------------------------------------------------

/**
 * Record money added to the OpenAI account.
 *
 * The app cannot see the account — every billing endpoint refuses a project
 * key, which was measured rather than assumed — so this is the one number it
 * has to be told. Everything the app spends after the most recent one is what
 * has gone since, and the difference is the estimate the page leads with.
 */
export async function recordTopUp(amount: number, note: string) {
  await requireSession();

  if (!Number.isFinite(amount) || amount <= 0) return;

  await db
    .insert(aiTopups)
    .values({ amount, note: note.trim().slice(0, 200) || null });

  revalidatePath('/connections');
}

/** Forget one, for a figure typed wrongly. */
export async function forgetTopUp(id: string) {
  await requireSession();
  await db.delete(aiTopups).where(eq(aiTopups.id, id));
  revalidatePath('/connections');
}

/**
 * What a model costs per million tokens.
 *
 * Kept in the database rather than compiled in, because prices change and an
 * app shipping last year's would be confidently wrong about money. Nothing is
 * seeded: a made-up default is indistinguishable on screen from a real one,
 * and the page says plainly which models it cannot price.
 */
export async function setModelPrice(
  model: string,
  inputPerMillion: number,
  cachedPerMillion: number,
  outputPerMillion: number,
) {
  await requireSession();

  const name = model.trim();
  if (!name) return;

  const ok = (n: number) => Number.isFinite(n) && n >= 0 && n < 10_000;
  if (!ok(inputPerMillion) || !ok(cachedPerMillion) || !ok(outputPerMillion)) return;

  await db
    .insert(aiPrices)
    .values({
      model: name,
      inputPerMillion,
      cachedPerMillion,
      outputPerMillion,
    })
    .onConflictDoUpdate({
      target: aiPrices.model,
      set: {
        inputPerMillion,
        cachedPerMillion,
        outputPerMillion,
        updatedAt: new Date(),
      },
    });

  revalidatePath('/connections');
}

/**
 * Make the Gmail label that files messages into this box.
 *
 * A Google call inside a request, and the one place where that is right for a
 * label: the whole point of the label is that you go and apply it in Gmail a
 * moment later, so answering "it will exist shortly" would be answering the
 * wrong question. It is also a press, once per box, rather than anything the
 * app does on its own — making labels in someone's account is not a background
 * activity.
 */
export async function createBoxLabel(boxId: string) {
  await requireSession();

  try {
    await ensureBoxLabel(boxId);
  } catch {
    return { error: 'Gmail would not make that label.' };
  }

  revalidateShell();
  return { ok: true as const };
}
