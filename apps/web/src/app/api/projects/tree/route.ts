import { NextResponse } from 'next/server';
import { and, eq, isNotNull, or } from 'drizzle-orm';
import { db, projectTrees, projects } from '@gtd/db';
import { WHY, authoriseSecret } from '@/lib/box/auth';
import { MAX_NODES, cleanTree } from '@/lib/tree-clean';

export const dynamic = 'force-dynamic';

/**
 * What is in a project's Drive folder and under its Gmail label.
 *
 * Two steps, and only the Apps Script uses either. `GET` hands out the projects
 * worth walking — the ones that actually have a folder or a label — and `POST`
 * stores what the walk found.
 *
 * **Secret only, no session fallback.** There is nothing here for a browser to
 * do. The whole reason this route exists is that the app cannot read a folder it
 * did not fill: that needs `drive.readonly`, and reading messages under a label
 * needs `gmail.readonly`. Both are restricted scopes, and taking either would
 * put Drive sync, the calendar and the box bridge into annual review with the
 * refresh token expiring weekly in the meantime. So the script reads and the app
 * is told, exactly as with the scanner and the email bridge.
 */

export async function GET(request: Request) {
  const failure = authoriseSecret(request);
  if (failure !== null) {
    return NextResponse.json({ error: 'unauthorised', why: WHY[failure] }, { status: 401 });
  }

  /*
   * Only projects with something to walk. A project that predates the Google
   * connection has neither id, and handing the script a list of nothings would
   * have it open Drive once per project to discover that.
   */
  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      driveFolderId: projects.driveFolderId,
      gmailLabelId: projects.gmailLabelId,
    })
    .from(projects)
    .where(
      and(
        or(isNotNull(projects.driveFolderId), isNotNull(projects.gmailLabelId)),
        eq(projects.status, 'active'),
      ),
    );

  return NextResponse.json({ ok: true, projects: rows });
}

export async function POST(request: Request) {
  const failure = authoriseSecret(request);
  if (failure !== null) {
    return NextResponse.json({ error: 'unauthorised', why: WHY[failure] }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Partial<{
    projectId: string;
    drive: unknown;
    gmail: unknown;
    error: string;
  }>;

  const projectId = (body.projectId ?? '').trim();
  if (!projectId) {
    return NextResponse.json({ error: 'Which project?' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  // Deleted between the list and the walk, which is a minute or two on a big
  // account. Not an error: there is simply nowhere to put the answer.
  if (!project) {
    return NextResponse.json({ ok: true, skipped: 'that project is gone' });
  }

  const budget = { left: MAX_NODES };
  const drive = cleanTree(body.drive, budget);
  const gmail = cleanTree(body.gmail, budget);

  const error =
    typeof body.error === 'string' && body.error.trim()
      ? body.error.trim().slice(0, 500)
      : null;

  /*
   * A failed walk keeps the last good tree and records why, rather than
   * replacing a useful answer with an empty one. An older picture of a folder is
   * worth a great deal more than no picture, as long as the pane says which it
   * is looking at.
   */
  if (error && !drive && !gmail) {
    await db
      .insert(projectTrees)
      .values({ projectId, drive: null, gmail: null, error })
      .onConflictDoUpdate({ target: projectTrees.projectId, set: { error } });

    return NextResponse.json({ ok: true, kept: 'the previous tree', error });
  }

  await db
    .insert(projectTrees)
    .values({ projectId, drive, gmail, error, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: projectTrees.projectId,
      set: { drive, gmail, error, fetchedAt: new Date() },
    });

  return NextResponse.json({ ok: true, nodes: MAX_NODES - budget.left });
}
