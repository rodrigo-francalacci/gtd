import 'server-only';

import { db, projects, syncJobs } from '@gtd/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { GoogleAuthError } from '@/lib/auth/token';
import { GoogleApiError } from './client';
import { LiveGoogleSync } from './live-sync';

const MAX_ATTEMPTS = 5;

/** Enqueue work. Cheap enough to call inside a request. */
export async function enqueueSync(
  kind: 'create_project_links' | 'move_project_links',
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
  kind: 'create_project_links' | 'move_project_links',
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

  if (kind === 'create_project_links') {
    const [driveFolderId, gmailLabelId] = await Promise.all([
      project.driveFolderId ??
        sync.createProjectFolder(project.id, project.title),
      project.gmailLabelId ?? sync.createGmailLabel(project.id, project.title),
    ]);

    if (driveFolderId || gmailLabelId) {
      await db
        .update(projects)
        .set({ driveFolderId, gmailLabelId })
        .where(eq(projects.id, project.id));
    }

    // A new project also needs its containers to match its status.
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
 * Queue link creation for projects that predate the Google connection.
 *
 * Only new projects and status changes enqueue work, so anything created
 * before Google was connected has no folder or label. This is the deliberate
 * catch-up, rather than a background sweep that would surprise you by
 * creating folders you didn't ask for.
 */
export async function backfillProjectLinks(): Promise<number> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        isNull(projects.driveFolderId),
        isNull(projects.gmailLabelId),
      ),
    );

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
    .where(and(isNull(projects.driveFolderId), isNull(projects.gmailLabelId)));

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
