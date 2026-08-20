import 'server-only';

import {
  boxItemTags,
  boxItems,
  boxJobs,
  boxTags,
  boxes,
  db,
} from '@gtd/db';
import { eq, sql } from 'drizzle-orm';
import { GoogleAuthError } from '@/lib/auth/token';
import { GoogleApiError, downloadFile, exportFile } from '@/lib/google/client';
import { exportTypeFor, isGoogleNative } from '@/lib/google/sync';
import { getBoxCategories } from '@/lib/queries';
import {
  UnreadableDocument,
  canClassify,
  classifier,
  validateTags,
  type Classifier,
} from './classify';

const MAX_ATTEMPTS = 4;

/**
 * Queue a document to be read. Cheap by design — one row.
 *
 * Ingest must not wait on a model any more than capture does: the document is
 * safe in Drive and recorded here the moment the bytes land, and everything
 * that makes it *findable* happens afterwards.
 */
export async function enqueueBoxJob(itemId: string): Promise<boolean> {
  await db.insert(boxJobs).values({ itemId });
  return true;
}

export type BoxDrainResult = {
  claimed: number;
  done: number;
  failed: number;
  retrying: number;
  /** True when there's no API key, so nothing was claimed at all. */
  skipped?: boolean;
};

/**
 * Read a batch of documents.
 *
 * Same claim-in-one-UPDATE shape as the other two queues, for the same reason:
 * two overlapping cron runs must not read the same document twice and pay for
 * it twice.
 *
 * Unlike the enrichment queue there is no useful no-key path. That one can at
 * least store a text file's contents without a model; here every field worth
 * having — the title, the summary, the tags — is the model's, so with no key
 * we claim nothing and the documents wait.
 */
export async function drainBoxQueue(
  limit = 5,
  /**
   * Read this one document rather than whatever is next.
   *
   * The cron takes the oldest and doesn't care which; a person pressing "read
   * it now" means *this* one, and would be badly served by the queue going off
   * to read something else and reporting success.
   */
  itemId?: string,
): Promise<BoxDrainResult> {
  const model = classifier();
  if (!model) return { claimed: 0, done: 0, failed: 0, retrying: 0, skipped: true };

  const claimed = await db
    .update(boxJobs)
    .set({ status: 'running', attempts: sql`${boxJobs.attempts} + 1` })
    .where(
      sql`${boxJobs.id} in (
        select j.id from ${boxJobs} j
        where j.status = 'pending'
          and j.run_after <= now()
          and (${itemId ?? null}::uuid is null or j.item_id = ${itemId ?? null}::uuid)
        order by j.created_at
        limit ${limit}
        for update skip locked
      )`,
    )
    .returning({
      id: boxJobs.id,
      itemId: boxJobs.itemId,
      attempts: boxJobs.attempts,
    });

  const result: BoxDrainResult = {
    claimed: claimed.length,
    done: 0,
    failed: 0,
    retrying: 0,
  };

  for (const job of claimed) {
    try {
      await runJob(model, job.itemId);

      await db
        .update(boxJobs)
        .set({ status: 'done', completedAt: new Date(), lastError: null })
        .where(eq(boxJobs.id, job.id));

      result.done += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const permanent =
        error instanceof UnreadableDocument ||
        error instanceof GoogleAuthError ||
        (error instanceof GoogleApiError && !error.retryable);

      const giveUp = permanent || job.attempts >= MAX_ATTEMPTS;

      await db
        .update(boxJobs)
        .set({
          status: giveUp ? 'failed' : 'pending',
          lastError: message.slice(0, 1000),
          runAfter: new Date(
            Date.now() + Math.min(2 ** job.attempts, 60 * 24) * 60_000,
          ),
        })
        .where(eq(boxJobs.id, job.id));

      if (giveUp) {
        // The document keeps its arrival date and its file; only the reading
        // failed. Saying so on the row is what lets the pane offer a retry
        // instead of showing an untitled document forever with no explanation.
        await db
          .update(boxItems)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(boxItems.id, job.itemId));

        result.failed += 1;
      } else {
        result.retrying += 1;
      }
    }
  }

  return result;
}

async function runJob(model: Classifier, itemId: string) {
  const [item] = await db
    .select({
      id: boxItems.id,
      boxId: boxItems.boxId,
      kind: boxItems.kind,
      driveFileId: boxItems.driveFileId,
      name: boxItems.name,
      mimeType: boxItems.mimeType,
    })
    .from(boxItems)
    .where(eq(boxItems.id, itemId))
    .limit(1);

  // Deleted before the worker got to it. Not an error — the job is moot.
  if (!item) return;

  // A note or a place has no file and is already in its final form. Nothing
  // should have queued one, but a kind can change under a queued job, and
  // failing it would be inventing a problem.
  if (item.kind !== 'document' || !item.driveFileId) return;

  if (!canClassify(item.mimeType)) {
    throw new UnreadableDocument(
      `Nothing here can read ${item.mimeType ?? 'a file with no type'}.`,
    );
  }

  const [box] = await db
    .select({ instruction: boxes.instruction, rules: boxes.rules })
    .from(boxes)
    .where(eq(boxes.id, item.boxId))
    .limit(1);

  const categories = await getBoxCategories(item.boxId);

  // A Docs-editor file has no bytes to download — Drive refuses `alt=media` —
  // so ask Google to render it first, exactly as the enrichment queue does.
  const google = isGoogleNative(item.mimeType);
  const asType = google
    ? exportTypeFor(item.mimeType!)
    : (item.mimeType ?? 'application/octet-stream');

  const upstream = google
    ? await exportFile(item.driveFileId, asType)
    : await downloadFile(item.driveFileId);

  if (!upstream.ok) {
    throw new GoogleApiError(
      `${google ? 'export' : 'download'} of ${item.name} failed: ${upstream.status}`,
      upstream.status,
    );
  }

  const result = await model.classify(
    { name: item.name, mimeType: asType, bytes: await upstream.arrayBuffer() },
    { instruction: box?.instruction ?? '', rules: box?.rules ?? '' },
    categories,
  );

  const checked = validateTags(categories, result.tags);

  // Values the model was allowed to invent — a city on a fuel receipt — become
  // real tags, so the next receipt from the same place reuses this one rather
  // than proposing it again.
  const createdIds: string[] = [];
  for (const tag of checked.create) {
    const [row] = await db
      .insert(boxTags)
      .values({ categoryId: tag.categoryId, name: tag.name })
      // The unique index is case-insensitive, so a race between two documents
      // from the same new city resolves to one tag rather than an error.
      .onConflictDoNothing()
      .returning({ id: boxTags.id });

    if (row) {
      createdIds.push(row.id);
    } else {
      const [existing] = await db
        .select({ id: boxTags.id })
        .from(boxTags)
        .where(
          sql`${boxTags.categoryId} = ${tag.categoryId} and lower(${boxTags.name}) = lower(${tag.name})`,
        )
        .limit(1);
      if (existing) createdIds.push(existing.id);
    }
  }

  const tagIds = [...new Set([...checked.tagIds, ...createdIds])];

  const tagNames = [...categories.flatMap((c) => c.tags)]
    .filter((t) => tagIds.includes(t.id))
    .map((t) => t.name)
    .concat(checked.create.map((c) => c.name));

  // Not a transaction: the neon-http driver has none, which is why nothing
  // else in this app uses one either. The order is what makes that safe —
  // tags first, then the row, with `status: 'ready'` written last. A failure
  // anywhere in the middle leaves the document pending, and the retry rewrites
  // all of it from scratch.

  // From scratch, so a re-run doesn't accumulate tags from an earlier pass
  // that the model has since changed its mind about.
  await db.delete(boxItemTags).where(eq(boxItemTags.itemId, itemId));

  if (tagIds.length > 0) {
    await db
      .insert(boxItemTags)
      .values(tagIds.map((tagId) => ({ itemId, tagId })))
      .onConflictDoNothing();
  }

  await db
    .update(boxItems)
    .set({
      title: result.title || null,
      description: result.description || null,
      docDate: result.date,
      text: result.text || null,
      // The vector is generated from this column, so anything that writes one
      // has to write the other. Tag names go in too: searching "Tesco" should
      // find the receipt whether or not the word survived the scan.
      searchText: [result.description, result.text, tagNames.join(' ')]
        .filter(Boolean)
        .join('\n')
        .slice(0, 100_000),
      status: 'ready',
      updatedAt: new Date(),
    })
    .where(eq(boxItems.id, itemId));
}

/** Queue health, for the connections page. */
export async function getBoxQueueStatus() {
  const rows = await db
    .select({ status: boxJobs.status, n: sql<number>`count(*)::int` })
    .from(boxJobs)
    .groupBy(boxJobs.status);

  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));

  const failures = await db
    .select({
      id: boxJobs.id,
      name: boxItems.name,
      lastError: boxJobs.lastError,
      attempts: boxJobs.attempts,
    })
    .from(boxJobs)
    .leftJoin(boxItems, eq(boxItems.id, boxJobs.itemId))
    .where(eq(boxJobs.status, 'failed'))
    .limit(5);

  return {
    configured: classifier() !== null,
    pending: byStatus.pending ?? 0,
    done: byStatus.done ?? 0,
    failed: byStatus.failed ?? 0,
    failures,
  };
}

/**
 * Read one document again — after a key is added, or a tag list is fixed.
 *
 * Refuses to queue what nothing can read, and that guard has to live *here*
 * rather than at the call sites. `completeBoxUpload` already exempts audio,
 * and the composer then undid it by asking for every upload to be read the
 * moment it landed: the request put the recording back in the queue and the
 * worker duly failed it as unreadable. One funnel, one rule.
 *
 * An unreadable item is set `ready` instead, which is the honest state —
 * nothing is pending, there is simply nothing to read — and it heals anything
 * already marked failed by the older behaviour.
 */
export async function requeueBoxItem(itemId: string): Promise<void> {
  const [item] = await db
    .select({ kind: boxItems.kind, mimeType: boxItems.mimeType })
    .from(boxItems)
    .where(eq(boxItems.id, itemId))
    .limit(1);

  if (!item) return;

  if (item.kind !== 'document' || !canClassify(item.mimeType)) {
    await db.delete(boxJobs).where(eq(boxJobs.itemId, itemId));
    await db
      .update(boxItems)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(eq(boxItems.id, itemId));
    return;
  }

  await db
    .update(boxItems)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(eq(boxItems.id, itemId));

  await db.delete(boxJobs).where(eq(boxJobs.itemId, itemId));
  await enqueueBoxJob(itemId);
}

/** How many documents are still waiting to be read. */
export async function countWaitingDocuments(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(boxJobs)
    .where(sql`${boxJobs.status} = 'pending'`);

  return row?.n ?? 0;
}
