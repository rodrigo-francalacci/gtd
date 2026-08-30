import 'server-only';

import { db, projects, syncJobs } from '@gtd/db';
import { eq, isNull, or, sql } from 'drizzle-orm';
import { GoogleAuthError } from '@/lib/auth/token';
import { GoogleApiError } from './client';
import { LiveGoogleSync } from './live-sync';

const MAX_ATTEMPTS = 5;

/** Enqueue work. Cheap enough to call inside a request. */
export type SyncKind =
  | 'create_project_links'
  | 'create_project_folder'
  | 'create_project_label'
  | 'move_project_links';

export async function enqueueSync(
  kind: SyncKind,
  projectId: string,
): Promise<void> {
  await db.insert(syncJobs).values({ kind, projectId });
}

export type DrainResult = {
  claimed: number;
  done: number;
  failed: number;
  retrying: number;
};

/**
 * Process a batch of queued jobs.
 *
 * Claims rows with a single conditional UPDATE so two overlapping cron runs
 * can't process the same job — the database decides the winner, not the
 * order the workers happened to start in.
 */
export async function drainSyncQueue(limit = 10): Promise<DrainResult> {
  const claimed = await db
    .update(syncJobs)
    .set({ status: 'running', attempts: sql`${syncJobs.attempts} + 1` })
    .where(
      sql`${syncJobs.id} in (
        select id from ${syncJobs}
        where status = 'pending' and run_after <= now()
        order by created_at
        limit ${limit}
        for update skip locked
      )`,
    )
    .returning({
      id: syncJobs.id,
      kind: syncJobs.kind,
      projectId: syncJobs.projectId,
      attempts: syncJobs.attempts,
    });

  const result: DrainResult = {
    claimed: claimed.length,
    done: 0,
    failed: 0,
    retrying: 0,
  };

  const sync = new LiveGoogleSync();

  for (const job of claimed) {
    try {
      await runJob(sync, job.kind, job.projectId);

      await db
        .update(syncJobs)
        .set({ status: 'done', completedAt: new Date(), lastError: null })
        .where(eq(syncJobs.id, job.id));

      result.done += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // A missing grant or a revoked refresh token will not fix itself, and a
      // 4xx from Google means the request was wrong. Retrying either just
      // burns the queue, so only back off on transient failures.
      const transient =
        error instanceof GoogleApiError
          ? error.retryable
          : !(error instanceof GoogleAuthError);

      const giveUp = !transient || job.attempts >= MAX_ATTEMPTS;

      await db
        .update(syncJobs)
        .set({
          status: giveUp ? 'failed' : 'pending',
          lastError: message.slice(0, 1000),
          // Exponential backoff, capped so a stuck job still retries daily.
          runAfter: new Date(
            Date.now() + Math.min(2 ** job.attempts, 60 * 24) * 60_000,
          ),
        })
        .where(eq(syncJobs.id, job.id));

      if (giveUp) result.failed += 1;
      else result.retrying += 1;
    }
  }

  return result;
}

async function runJob(
  sync: LiveGoogleSync,
  kind: SyncKind,
  projectId: string,
): Promise<void> {
  const [project] = await db
    .select({
      id: projects.id,
      title: projects.title,
      status: projects.status,
      completedAt: projects.completedAt,
      driveFolderId: projects.driveFolderId,
      gmailLabelId: projects.gmailLabelId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  // Deleted before the worker got to it — nothing to do, and not an error.
  if (!project) return;

  if (kind !== 'move_project_links') {
    /*
     * Only what was asked for, and only what is missing.
     *
     * A folder and a label are wanted at different moments: attaching a file
     * wants somewhere to put it, filing a message wants somewhere to file it.
     * Making the other one at the same time would be the app deciding you
     * wanted it, which is the whole thing this stopped doing.
     */
    const wantsFolder = kind === 'create_project_links' || kind === 'create_project_folder';
    const wantsLabel = kind === 'create_project_links' || kind === 'create_project_label';

    const [driveFolderId, gmailLabelId] = await Promise.all([
      project.driveFolderId ??
        (wantsFolder ? sync.createProjectFolder(project.id, project.title) : null),
      project.gmailLabelId ??
        (wantsLabel ? sync.createGmailLabel(project.id, project.title) : null),
    ]);

    if (driveFolderId !== project.driveFolderId || gmailLabelId !== project.gmailLabelId) {
      await db
        .update(projects)
        .set({ driveFolderId, gmailLabelId })
        .where(eq(projects.id, project.id));
    }

    /*
     * Whatever was just made has to sit in the container its status calls for.
     * `moveForStatus` skips a null id, so making only a label moves only the
     * label — an archived project that finally gets a folder gets it under
     * `Archive/<year>`, not under `Projects`.
     */
    await sync.moveForStatus({ ...project, driveFolderId, gmailLabelId }, project.status);
    return;
  }

  await sync.moveForStatus(project, project.status);
}

/** Queue health, for the connections page. */
export async function getSyncQueueStatus() {
  const rows = await db
    .select({ status: syncJobs.status, n: sql<number>`count(*)::int` })
    .from(syncJobs)
    .groupBy(syncJobs.status);

  const failures = await db
    .select({
      id: syncJobs.id,
      projectId: syncJobs.projectId,
      lastError: syncJobs.lastError,
      attempts: syncJobs.attempts,
    })
    .from(syncJobs)
    .where(eq(syncJobs.status, 'failed'))
    .limit(5);

  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));

  return {
    pending: byStatus.pending ?? 0,
    running: byStatus.running ?? 0,
    done: byStatus.done ?? 0,
    failed: byStatus.failed ?? 0,
    failures,
  };
}

/**
 * Missing *either* link, not both.
 *
 * Half-linked is now the ordinary state rather than an edge case: a project
 * that has had a file attached has a folder and no label, and one that has had
 * a message filed against it has a label and no folder. Requiring both to be
 * null would exclude exactly those from the backfill, which is the one place
 * that is allowed to mean "all of it".
 */
const UNLINKED = or(
  isNull(projects.driveFolderId),
  isNull(projects.gmailLabelId),
);

/**
 * Make the folder and the label for every project that is missing either.
 *
 * The one caller that really does mean *both*, for every project, which is why
 * it is a button somebody presses and not something the app does on its own.
 * Nothing else creates a container speculatively any more: a project gets a
 * folder when a file needs somewhere to go and a label when a message needs
 * somewhere to be filed, so most projects will legitimately have neither for
 * their whole lives.
 *
 * It stays because there is a real want behind it — "I would like the tree in
 * Drive to mirror my projects" — and because it is the answer for anyone who
 * had the old behaviour and wants to keep it.
 */
export async function backfillProjectLinks(): Promise<number> {
  const rows = await db.select({ id: projects.id }).from(projects).where(UNLINKED);

  for (const row of rows) {
    await enqueueSync('create_project_links', row.id);
  }

  return rows.length;
}

/** How many projects the backfill would act on. */
export async function countUnlinkedProjects(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(projects)
    .where(UNLINKED);

  return row?.n ?? 0;
}

/** Re-queue everything that gave up, e.g. after reconnecting Google. */
export async function retryFailedJobs(): Promise<number> {
  const rows = await db
    .update(syncJobs)
    .set({ status: 'pending', attempts: 0, runAfter: new Date(), lastError: null })
    .where(eq(syncJobs.status, 'failed'))
    .returning({ id: syncJobs.id });

  return rows.length;
}
