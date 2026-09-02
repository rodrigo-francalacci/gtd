import 'server-only';

import { actions, db } from '@gtd/db';
import { and, eq, isNull } from 'drizzle-orm';
import {
  ensureFolder,
  folderIsEmpty,
  getFile,
  moveFile,
  renameFolder,
  trashFile,
} from './client';
import { settleFolderRace } from './folder-race';
import { ROOT, safeName } from './sync';

/** Where a project-less action keeps its files while it is still live. */
const ACTIONS = 'Actions';
const ARCHIVE = 'Archive';

/**
 * A folder for an action that has no project.
 *
 * An action *with* a project keeps its files in that project's folder — the
 * project is the unit you go looking in a year later, and a folder per action
 * would bury it. One without a project used to fall through to `GTD/Inbox`
 * along with every unclarified capture, and that said something false: the
 * inbox is where things go that have *not* been decided about, and an action is
 * a decision already taken. A promoted, project-less action is not waiting to
 * be clarified; it just has nothing above it.
 *
 * So it gets its own container, named after the action so the folder can be
 * recognised from Drive without opening it, and archived the way a project's is
 * once the action is done.
 */
export function actionContainerPath(
  status: string,
  completedAt: Date | null,
): string[] {
  if (status !== 'done') return [ACTIONS];

  /*
   * `Archive/<year>/Actions`, which is the project rule with one more level.
   *
   * The year comes first so a year's work stays together — the same reasoning
   * `containerPath` uses, and the reason the two must not disagree. The
   * `Actions` level under it is what stops a finished action's folder sitting
   * among the finished *projects*, where a list of twenty projects would be
   * padded out with single steps that were never projects at all.
   */
  const year = (completedAt ?? new Date()).getFullYear();
  return [ARCHIVE, String(year), ACTIONS];
}

/** The folder an action's files belong in right now, made if it is missing. */
export async function ensureActionFolder(actionId: string): Promise<string | null> {
  const [action] = await db
    .select({
      title: actions.title,
      status: actions.status,
      completedAt: actions.completedAt,
      projectId: actions.projectId,
      driveFolderId: actions.driveFolderId,
    })
    .from(actions)
    .where(eq(actions.id, actionId))
    .limit(1);

  if (!action) return null;

  /*
   * It has a project now, so the project's folder is the answer and the one it
   * used to have is a leftover.
   *
   * Filing an action into a project queues a move for each of its files and
   * then this, in that order, so by the time it runs the folder should be empty
   * — and only an empty one is binned, on Drive's word rather than an
   * assumption about ordering. If the moves have not landed yet the folder
   * stays and the next tick takes it, which is the right way round: a stray
   * empty folder is untidy, and binning one with a document still in it is not.
   */
  if (action.projectId) {
    if (action.driveFolderId) {
      const existing = await getFile(action.driveFolderId);

      if (existing && !existing.trashed && (await folderIsEmpty(action.driveFolderId))) {
        await trashFile(action.driveFolderId);
        await db
          .update(actions)
          .set({ driveFolderId: null })
          .where(eq(actions.id, actionId));
      }
    }

    return null;
  }

  const wanted = safeName(action.title) || 'Action';

  let container = await ensureFolder(ROOT);
  for (const segment of actionContainerPath(action.status, action.completedAt)) {
    container = await ensureFolder(segment, container);
  }

  /*
   * A folder it already has is moved and renamed rather than replaced.
   *
   * `ensureFolder` searches *inside* a container, so once an action is done it
   * would find nothing under `Archive/<year>/Actions` and cheerfully make a
   * second folder — leaving the files in the first one, under a name that is
   * now wrong, with nothing pointing at it. Reconciling the folder it has is
   * the only thing that keeps one folder per action.
   *
   * Checked before it is trusted, like a project's and a box's: a folder
   * deleted in Drive must not be uploaded into, because Drive accepts a parent
   * that is in the bin and the file simply vanishes thirty days later.
   */
  if (action.driveFolderId) {
    const existing = await getFile(action.driveFolderId);

    if (existing && !existing.trashed) {
      if (existing.parents?.[0] !== container) {
        await moveFile(action.driveFolderId, container);
      }
      if (existing.name !== wanted) {
        await renameFolder(action.driveFolderId, wanted);
      }
      return action.driveFolderId;
    }
  }

  const folderId = await ensureFolder(wanted, container);

  // Written only if nobody has filled it in since it was read — the same
  // single-statement referee the project and box folders use, because two tabs
  // attaching at once otherwise make two folders and one of the files lands in
  // the one nothing points at.
  const [won] = await db
    .update(actions)
    .set({ driveFolderId: folderId })
    .where(
      and(
        eq(actions.id, actionId),
        action.driveFolderId === null
          ? isNull(actions.driveFolderId)
          : eq(actions.driveFolderId, action.driveFolderId),
      ),
    )
    .returning({ id: actions.id });

  if (won) return folderId;

  const [now] = await db
    .select({ driveFolderId: actions.driveFolderId })
    .from(actions)
    .where(eq(actions.id, actionId))
    .limit(1);

  return settleFolderRace(folderId, now?.driveFolderId ?? null);
}
