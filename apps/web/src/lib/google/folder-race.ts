import 'server-only';

import { folderIsEmpty, trashFile } from './client';

/**
 * Two tabs, one folder.
 *
 * `ensureFolder` searches Drive and creates only if it finds nothing, which is
 * idempotent when called twice in a row and is *not* when called twice at once:
 * both searches come back empty, both create, and Drive is perfectly happy to
 * hold two folders with the same name in the same parent. Measured, not
 * theorised — two tabs attaching a file to the same folderless project made two
 * `Projects/<name>` folders, the row pointed at one, and one of the two uploads
 * went into the other. A real file, in a real folder, that nothing in the app
 * or in `check-orphans` could ever see again.
 *
 * There are no transactions on this driver, so the arbiter is a single
 * conditional statement: each caller writes its folder id only if the column
 * still holds what that caller read a moment ago. Exactly one such update can
 * match, which makes the database the referee without a lock, in the same way
 * the queues claim work.
 *
 * This is what the loser does afterwards. Its folder is empty by construction —
 * nothing is uploaded until the caller has an id to upload into, and it does
 * not have one yet — so binning it costs nothing and leaves the account with
 * the one folder the app is pointing at.
 */
export async function settleFolderRace(
  /** The folder this caller just made or found. */
  made: string,
  /** What the column holds now, after losing the conditional write. */
  winner: string | null,
): Promise<string> {
  // Nobody raced us, or we both found the same pre-existing folder.
  if (!winner || winner === made) return made;

  /*
   * Only ever bin an empty one.
   *
   * `ensureFolder` returns a folder it *found* just as readily as one it made,
   * and a found folder can be somebody's filing from last year — a stale
   * pointer in the row is enough to send two callers down this path with an old
   * folder in hand. Being wrong here would trash real documents to tidy up a
   * duplicate, so the check is Drive's answer rather than our assumption. If it
   * has anything in it we keep both and take the winner's: a spare folder is
   * untidy, and deleting somebody's files is not.
   */
  if (await folderIsEmpty(made)) await trashFile(made);

  return winner;
}
