import { NextResponse } from 'next/server';
import { db, folderTrees, type TreeNode } from '@gtd/db';
import { WHY, authoriseSecret } from '@/lib/box/auth';
import { linkedDriveFolders } from '@/lib/queries';
import { MAX_NODES, cleanTree } from '@/lib/tree-clean';

export const dynamic = 'force-dynamic';

/**
 * What is inside a Drive folder a note points at.
 *
 * The sibling of `/api/projects/tree`, and it exists for exactly the same
 * reason: the app holds `drive.file` and can see only the files it created
 * itself, so a folder you made in Drive and dropped things into is invisible to
 * it. Listing one needs `drive.readonly`, which is restricted, and taking it
 * would put Drive sync, the calendar and the box bridge into annual review with
 * a seven-day refresh token in the meantime. So the script reads and the app is
 * told, for the fourth time in this codebase.
 *
 * **The app decides what may be walked, and that is the point of the `GET`.**
 * A route that took any folder id and walked it would be a way to enumerate the
 * whole of somebody's Drive through a script that has permission to. What comes
 * back instead is precisely the set of folders that appear in a `D<id>` link in
 * a note — folders the user has already named by hand, in their own words. A
 * link is the authorisation.
 *
 * **Secret only, no session fallback.** There is nothing here for a browser to
 * do; the whole reason the route exists is that a browser's app cannot do it.
 */
export async function GET(request: Request) {
  const failure = authoriseSecret(request);
  if (failure !== null) {
    return NextResponse.json({ error: 'unauthorised', why: WHY[failure] }, { status: 401 });
  }

  const folders = await linkedDriveFolders();
  return NextResponse.json({ ok: true, folders });
}

export async function POST(request: Request) {
  const failure = authoriseSecret(request);
  if (failure !== null) {
    return NextResponse.json({ error: 'unauthorised', why: WHY[failure] }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Partial<{
    folderId: string;
    name: string;
    tree: unknown;
    error: string;
  }>;

  const folderId = (body.folderId ?? '').trim();
  if (!folderId) {
    return NextResponse.json({ error: 'Which folder?' }, { status: 400 });
  }

  /*
   * Only a folder somebody has actually linked to.
   *
   * The `GET` says what may be walked, and this checks the answer coming back —
   * otherwise the list would be advice rather than a rule, and a script edited
   * by hand could store a tree of any folder in the account. Cheap: the same
   * query the listing runs, and it is one tick a day.
   */
  const allowed = await linkedDriveFolders();
  if (!allowed.some((folder) => folder.id === folderId)) {
    return NextResponse.json(
      { ok: true, skipped: 'nothing links to that folder' },
    );
  }

  const budget = { left: MAX_NODES };
  const tree: TreeNode | null = cleanTree(body.tree, budget);

  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 300)
      : null;

  const error =
    typeof body.error === 'string' && body.error.trim()
      ? body.error.trim().slice(0, 500)
      : null;

  /*
   * A failed walk keeps the last good tree and records why. An older picture of
   * a folder beats no picture as long as the pane says which it is — the same
   * rule the project trees follow, and the reason `fetched_at` is shown
   * wherever a tree is.
   */
  if (error && !tree) {
    await db
      .insert(folderTrees)
      .values({ folderId, name, tree: null, error })
      .onConflictDoUpdate({ target: folderTrees.folderId, set: { error } });

    return NextResponse.json({ ok: true, kept: 'the previous tree', error });
  }

  await db
    .insert(folderTrees)
    .values({ folderId, name, tree, error, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: folderTrees.folderId,
      set: { name, tree, error, fetchedAt: new Date() },
    });

  return NextResponse.json({ ok: true, nodes: MAX_NODES - budget.left });
}
