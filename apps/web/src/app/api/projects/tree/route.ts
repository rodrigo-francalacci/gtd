import { NextResponse } from 'next/server';
import { and, eq, isNotNull, or } from 'drizzle-orm';
import { db, projectTrees, projects, type TreeNode } from '@gtd/db';
import { WHY, authoriseSecret } from '@/lib/box/auth';

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

/** A walk is capped, and the caps are here so the script cannot argue. */
const MAX_NODES = 4000;
const MAX_DEPTH = 12;

/**
 * Whatever the script sent, reduced to the shape this app will store.
 *
 * The script is trusted with the *account*, not with the JSON: it is a program
 * that can be edited by hand, and a tree is rendered straight into a pane. So
 * every field is taken by name and by type, unknown keys are dropped, and the
 * whole thing is bounded — depth, breadth and total nodes — because a cycle or a
 * runaway folder would otherwise become a row that no page can render.
 */
function clean(
  raw: unknown,
  budget: { left: number },
  depth = 0,
): TreeNode | null {
  if (!raw || typeof raw !== 'object' || budget.left <= 0) return null;

  const node = raw as Record<string, unknown>;
  const kind = node.kind;

  if (kind !== 'folder' && kind !== 'file' && kind !== 'label' && kind !== 'message') {
    return null;
  }

  budget.left -= 1;

  const text = (value: unknown, limit = 300): string | null =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;

  const out: TreeNode = {
    id: text(node.id, 200) ?? '',
    name: text(node.name) ?? '(untitled)',
    kind,
    mimeType: text(node.mimeType, 120),
    size: typeof node.size === 'number' && node.size >= 0 ? node.size : null,
    modified: text(node.modified, 40),
    from: text(node.from, 200),
    // Only somewhere on Google. A tree is rendered as links, and a `javascript:`
    // url in one would be a script that runs when clicked.
    url: /^https:\/\/[a-z]+\.google\.com\//i.test(String(node.url ?? ''))
      ? String(node.url)
      : null,
  };

  if (typeof node.more === 'number' && node.more > 0) out.more = Math.floor(node.more);

  if (Array.isArray(node.children) && depth < MAX_DEPTH) {
    const children = node.children
      .map((child) => clean(child, budget, depth + 1))
      .filter((child): child is TreeNode => child !== null);

    if (children.length > 0) out.children = children;
  }

  return out;
}

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
  const drive = clean(body.drive, budget);
  const gmail = clean(body.gmail, budget);

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
