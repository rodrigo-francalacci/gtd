import 'server-only';

import { attachments, db, enrichmentJobs } from '@gtd/db';
import type { EnrichmentJobKind } from '@gtd/db';
import { eq, sql } from 'drizzle-orm';
import { nameAttachment } from '@/lib/ai/filename';
import { GoogleAuthError } from '@/lib/auth/token';
import { GoogleApiError, downloadFile, exportFile } from '@/lib/google/client';
import { exportTypeFor, isGoogleNative } from '@/lib/google/sync';
import { TextReader, UnreadableFile, canRead, reader, type Reader } from './reader';

const MAX_ATTEMPTS = 4;

/**
 * The mime types worth queueing, as SQL. `canRead` says the same thing in
 * TypeScript; both exist because one guards an insert and the other filters a
 * claim, and having them disagree would mean rows queued that never run.
 */
const READABLE = sql`(
  mime_type like 'text/%'
  or (
    mime_type like 'application/vnd.google-apps.%'
    -- A gallery is a folder: Google-native, and nothing to export.
    and mime_type <> 'application/vnd.google-apps.folder'
  )
  or mime_type in (
    'application/pdf', 'application/json', 'application/xml', 'application/x-yaml',
    'image/jpeg', 'image/png', 'image/gif', 'image/webp'
  )
)`;

/** Of those, the ones needing no model — so they run without an API key. */
const READABLE_WITHOUT_MODEL = sql`(
  mime_type like 'text/%'
  or (
    mime_type like 'application/vnd.google-apps.%'
    -- A gallery is a folder: Google-native, and nothing to export.
    and mime_type <> 'application/vnd.google-apps.folder'
  )
  or mime_type in ('application/json', 'application/xml', 'application/x-yaml')
)`;

/**
 * Queue a file to be read, if anything can read it.
 *
 * Called from the upload path and deliberately cheap: it writes one row. The
 * capture must never wait on a model any more than it waits on Drive.
 */
export async function enqueueEnrichment(
  attachmentId: string,
  mimeType: string | null,
): Promise<boolean> {
  // Audio is the gap: there is no transcription provider wired up yet, and
  // queueing a job nothing can run would only manufacture a failure.
  if (!canRead(mimeType)) return false;

  const kind: EnrichmentJobKind = 'ocr';
  await db.insert(enrichmentJobs).values({ kind, attachmentId });
  return true;
}

export type EnrichResult = {
  claimed: number;
  done: number;
  failed: number;
  retrying: number;
  /** True when there's no API key, so only plain text could be claimed. */
  skipped?: boolean;
};

/**
 * Read a batch of queued files.
 *
 * Same claim-with-one-UPDATE shape as the sync outbox, for the same reason:
 * two overlapping cron runs must not read the same file twice and pay for it
 * twice.
 */
export async function drainEnrichmentQueue(limit = 5): Promise<EnrichResult> {
  // Without a key we can still read plain text, and we deliberately do not
  // *claim* anything else — an unclaimed job is a job waiting patiently, where
  // a claimed one that can't be run would burn an attempt and eventually be
  // marked failed for a reason that has nothing to do with the file.
  const model = reader();
  const read = model ?? new TextReader();

  const claimed = await db
    .update(enrichmentJobs)
    .set({ status: 'running', attempts: sql`${enrichmentJobs.attempts} + 1` })
    .where(
      sql`${enrichmentJobs.id} in (
        select j.id from ${enrichmentJobs} j
        join ${attachments} a on a.id = j.attachment_id
        where j.status = 'pending'
          and j.run_after <= now()
          and (${model !== null} or ${READABLE_WITHOUT_MODEL})
        order by j.created_at
        limit ${limit}
        for update skip locked
      )`,
    )
    .returning({
      id: enrichmentJobs.id,
      kind: enrichmentJobs.kind,
      attachmentId: enrichmentJobs.attachmentId,
      attempts: enrichmentJobs.attempts,
    });

  const result: EnrichResult = {
    claimed: claimed.length,
    done: 0,
    failed: 0,
    retrying: 0,
    skipped: model === null,
  };

  for (const job of claimed) {
    try {
      await runJob(read, job.attachmentId);

      await db
        .update(enrichmentJobs)
        .set({ status: 'done', completedAt: new Date(), lastError: null })
        .where(eq(enrichmentJobs.id, job.id));

      result.done += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // A file the reader cannot handle, or a revoked Google grant, will not
      // become readable on the fourth attempt.
      const permanent =
        error instanceof UnreadableFile ||
        error instanceof GoogleAuthError ||
        (error instanceof GoogleApiError && !error.retryable);

      const giveUp = permanent || job.attempts >= MAX_ATTEMPTS;

      await db
        .update(enrichmentJobs)
        .set({
          status: giveUp ? 'failed' : 'pending',
          lastError: message.slice(0, 1000),
          runAfter: new Date(
            Date.now() + Math.min(2 ** job.attempts, 60 * 24) * 60_000,
          ),
        })
        .where(eq(enrichmentJobs.id, job.id));

      if (giveUp) result.failed += 1;
      else result.retrying += 1;
    }
  }

  return result;
}

async function runJob(read: Reader, attachmentId: string) {
  const [row] = await db
    .select({
      driveFileId: attachments.driveFileId,
      name: attachments.name,
      mimeType: attachments.mimeType,
    })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  // Detached before the worker got to it. Not an error — the job is simply
  // moot, and the cascade will take the row soon enough anyway.
  if (!row?.driveFileId) return;

  // A Docs-editor file has no bytes to download — Drive refuses `alt=media`
  // outright — so ask Google to render it first. A sheet comes back as CSV,
  // everything else as plain text, and either way what arrives is text the
  // reader can store without a model.
  const google = isGoogleNative(row.mimeType);
  const asType = google ? exportTypeFor(row.mimeType!) : (row.mimeType ?? 'application/octet-stream');

  const upstream = google
    ? await exportFile(row.driveFileId, asType)
    : await downloadFile(row.driveFileId);

  if (!upstream.ok) {
    throw new GoogleApiError(
      `${google ? 'export' : 'download'} of ${row.name} failed: ${upstream.status}`,
      upstream.status,
    );
  }

  const text = await read.read({
    name: row.name,
    mimeType: asType,
    bytes: await upstream.arrayBuffer(),
  });

  // An empty result is a real answer — a blank page is blank. Storing '' says
  // "read, found nothing" and stops the job being retried forever, which null
  // would not distinguish from "never looked".
  await db
    .update(attachments)
    .set({ ocrText: text })
    .where(eq(attachments.id, attachmentId));

  /*
   * And now that there are words, name the file after them.
   *
   * This is the moment the naming becomes possible and the moment it is
   * cheapest: the reading has just been paid for, and `nameAttachment` sends a
   * slice of it rather than looking at the file again. Doing it at capture time
   * instead would nearly always find `ocr_text` still null — the queue drains
   * on the cron tick, hours later — so the rename would silently never happen.
   *
   * Not awaited into the job's own success: a file that was read and indexed
   * has done the thing the job exists for, and failing it over a filename would
   * cost the reading a retry. `nameAttachment` declines quietly for anything
   * with a name somebody chose, which is most files.
   */
  await nameAttachment(attachmentId).catch(() => {});
}

/**
 * Queue anything attached before this queue existed — or before its type was
 * supported. Without it, every file uploaded up to now stays invisible to
 * search for good, which is a worse failure than a slow one.
 *
 * Matches on "has no job", not "has no text": an empty `ocr_text` is a real
 * answer meaning the file was read and said nothing, and re-reading those
 * every time would pay for the same blank page repeatedly.
 */
export async function backfillEnrichment(): Promise<number> {
  const rows = await db
    .select({ id: attachments.id, mimeType: attachments.mimeType })
    .from(attachments)
    .where(
      sql`not exists (
        select 1 from ${enrichmentJobs} j where j.attachment_id = ${attachments.id}
      )`,
    );

  let queued = 0;
  for (const row of rows) {
    if (await enqueueEnrichment(row.id, row.mimeType)) queued += 1;
  }

  return queued;
}

/** Queue health, for the connections page. */
export async function getEnrichmentStatus() {
  const rows = await db
    .select({ status: enrichmentJobs.status, n: sql<number>`count(*)::int` })
    .from(enrichmentJobs)
    .groupBy(enrichmentJobs.status);

  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));

  const failures = await db
    .select({
      id: enrichmentJobs.id,
      name: attachments.name,
      lastError: enrichmentJobs.lastError,
      attempts: enrichmentJobs.attempts,
    })
    .from(enrichmentJobs)
    .leftJoin(attachments, eq(attachments.id, enrichmentJobs.attachmentId))
    .where(eq(enrichmentJobs.status, 'failed'))
    .limit(5);

  // How many attached files have never been offered to the queue at all.
  const [never] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attachments)
    .where(
      sql`not exists (
        select 1 from ${enrichmentJobs} j where j.attachment_id = ${attachments.id}
      ) and ${READABLE}`,
    );

  return {
    configured: reader() !== null,
    neverQueued: never?.n ?? 0,
    pending: byStatus.pending ?? 0,
    done: byStatus.done ?? 0,
    failed: byStatus.failed ?? 0,
    failures,
  };
}

/** Re-queue everything that gave up, e.g. after adding an API key. */
export async function retryFailedEnrichment(): Promise<number> {
  const rows = await db
    .update(enrichmentJobs)
    .set({ status: 'pending', attempts: 0, runAfter: new Date(), lastError: null })
    .where(eq(enrichmentJobs.status, 'failed'))
    .returning({ id: enrichmentJobs.id });

  return rows.length;
}
