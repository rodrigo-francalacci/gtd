import 'server-only';

import {
  boxItemTags,
  boxItems,
  boxJobs,
  boxTags,
  boxes,
  db,
} from '@gtd/db';
import { and, eq, sql } from 'drizzle-orm';
import { GoogleAuthError } from '@/lib/auth/token';
import {
  GoogleApiError,
  downloadFile,
  exportFile,
  renameFile,
} from '@/lib/google/client';
import { driveNameFor, exportTypeFor, isGoogleNative } from '@/lib/google/sync';
import { getBoxCategories } from '@/lib/queries';
import {
  MAX_CLASSIFY_BYTES,
  MAX_TEXT_CHARS,
  UnreadableDocument,
  canClassify,
  classifier,
  validateTags,
  type Classifier,
} from './classify';
import { UnreachableLink, resolveLink } from './link';

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
  // No early return for a missing key any more: a link is read by fetching it,
  // so those jobs run regardless and only document jobs wait for a key.
  const model = classifier();

  /*
   * Anything abandoned mid-flight goes back on the queue first.
   *
   * Claiming writes `running`, and only the same invocation writes it back — so
   * a worker torn down mid-drain (a function hitting its limit, a deploy, a
   * command interrupted) leaves the row `running` for ever: never claimed
   * again, never retried, and not visible as a failure. `sync_jobs` learned
   * this; these two had the same hole.
   *
   * Fifteen minutes because nothing here can legitimately still be going — a
   * serverless function's ceiling is five — so anything older is a corpse. That
   * margin is also what makes this safe at the head of every drain: two
   * overlapping workers cannot reset each other's live jobs. `attempts` is left
   * alone, so a job that keeps killing its worker still gives up in the end.
   */
  await db
    .update(boxJobs)
    .set({ status: 'pending' })
    .where(
      and(
        eq(boxJobs.status, 'running'),
        sql`coalesce(${boxJobs.startedAt}, ${boxJobs.createdAt}) < now() - interval '15 minutes'`,
      ),
    );

  const claimed = await db
    .update(boxJobs)
    .set({
      status: 'running',
      attempts: sql`${boxJobs.attempts} + 1`,
      startedAt: new Date(),
    })
    .where(
      sql`${boxJobs.id} in (
        select j.id from ${boxJobs} j
        join ${boxItems} i on i.id = j.item_id
        where j.status = 'pending'
          and j.run_after <= now()
          -- A link is read by fetching it, not by a model, so it is claimable
          -- whether or not a key is configured. Only documents need one.
          and (${model !== null} or i.kind = 'link')
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
    skipped: model === null,
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
        error instanceof UnreachableLink ||
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

async function runJob(model: Classifier | null, itemId: string) {
  const [item] = await db
    .select({
      id: boxItems.id,
      boxId: boxItems.boxId,
      kind: boxItems.kind,
      driveFileId: boxItems.driveFileId,
      name: boxItems.name,
      mimeType: boxItems.mimeType,
      sizeBytes: boxItems.sizeBytes,
      url: boxItems.url,
    })
    .from(boxItems)
    .where(eq(boxItems.id, itemId))
    .limit(1);

  // Deleted before the worker got to it. Not an error — the job is moot.
  if (!item) return;

  if (item.kind === 'link') return runLinkJob(model, item.id);

  // A note or a place has no file and is already in its final form. Nothing
  // should have queued one, but a kind can change under a queued job, and
  // failing it would be inventing a problem.
  if (item.kind !== 'document' || !item.driveFileId) return;

  // Only a document needs a model, and the claim above guarantees one.
  if (!model) return;

  if (!canClassify(item.mimeType)) {
    throw new UnreadableDocument(
      `Nothing here can read ${item.mimeType ?? 'a file with no type'}.`,
    );
  }

  // Checked before the download, so an enormous file costs nothing at all —
  // not a Drive transfer, and certainly not a model call.
  if (item.sizeBytes !== null && item.sizeBytes > MAX_CLASSIFY_BYTES) {
    return fileWithoutReading(item, item.sizeBytes);
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

  const bytes = await upstream.arrayBuffer();

  // The row's size can be null — a Google Doc has no bytes until it is
  // exported, and an old ingest may never have recorded one — so the same
  // ceiling is applied again to what actually arrived.
  if (bytes.byteLength > MAX_CLASSIFY_BYTES) {
    return fileWithoutReading(item, bytes.byteLength);
  }

  const result = await model.classify(
    { name: item.name, mimeType: asType, bytes },
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
      emoji: result.emoji,
      description: result.description || null,
      docDate: result.date,
      text: result.text ? result.text.slice(0, MAX_TEXT_CHARS) : null,
      // The vector is generated from this column, so anything that writes one
      // has to write the other. Tag names go in too: searching "Tesco" should
      // find the receipt whether or not the word survived the scan.
      searchText: [result.description, result.text, tagNames.join(' ')]
        .filter(Boolean)
        .join('\n')
        .slice(0, MAX_TEXT_CHARS),
      status: 'ready',
      updatedAt: new Date(),
    })
    .where(eq(boxItems.id, itemId));

  /**
   * Drive is told the new name here, at the moment the old one became wrong.
   *
   * It used to wait for `renameBoxFiles` on the cron tick — which on a Hobby
   * account is *daily*. So a receipt scanned at two in the afternoon, read a
   * second later and correctly titled in the app, sat in Drive under the
   * scanner’s filename until the following morning. Nothing was broken and
   * everything looked broken, which is the worst combination: opening the
   * Drive folder showed none of the work the app had just done.
   *
   * This is a Google call inside a request, which the app otherwise refuses.
   * It sits under the same exception the read itself does: this function has
   * already downloaded the file from Drive and spent a model call on it, so
   * one metadata write is not what makes it slow. `drive.file` covers it,
   * because the app created the file.
   *
   * Failing is survivable and deliberately quiet in the caller: the title is
   * already saved, and `renameBoxFiles` is still there as the backstop that
   * catches it on the next tick. What must not happen is the rename taking
   * the *read* down with it — that would cost a model call to fix a filename.
   */
  await renameInDrive(itemId, result.title, result.date);
}

/**
 * Too big to read, so filed on what is already known about it.
 *
 * `ready`, deliberately, not `failed`. Nothing has gone wrong: the file is in
 * Drive, the row is in the box, the entry previews and downloads like any
 * other, and searching its name finds it. The only thing it lacks is a
 * summary, and the honest way to show that is an entry that says so rather
 * than a red one implying something is broken and might be retried.
 *
 * The title comes from the filename, which for a big document is usually the
 * best name anyone has — a book arrives called what it is.
 */
async function fileWithoutReading(
  item: { id: string; name: string },
  size: number,
): Promise<void> {
  const mb = (size / (1024 * 1024)).toFixed(1);
  const title = titleFromFilename(item.name);
  const description = `Filed without being read — ${mb} MB is beyond the size this app will send to be summarised. The file itself is here in full.`;

  await db
    .update(boxItems)
    .set({
      title,
      description,
      // Name and note only. There is no transcription, and `search_text` must
      // say exactly as much as is actually known.
      searchText: [title, description].join('\n'),
      status: 'ready',
      updatedAt: new Date(),
    })
    .where(eq(boxItems.id, item.id));
}

/** A filename as something to read: no extension, no separators. */
function titleFromFilename(name: string): string | null {
  const stem = name.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[_-]+/g, ' ').trim();
  return stem || null;
}

/**
 * Read a link: follow it, and see what it turns out to be.
 *
 * A Maps address becomes a place — the coordinates are in the URL once the
 * shortener has been followed, so the entry changes kind. That looks odd
 * written down and is honest in practice: nobody knew what the address was
 * until somebody looked, and a place filed as a link is a place you won't find
 * on a map.
 *
 * Anything else is a page. Its own metadata gives the title, the sentence and
 * the picture for free and without a model, which is why links work with no
 * API key at all. With a key, the page's text goes through the same classifier
 * as a document, so an article can carry the box's tags — and its summary
 * replaces the marketing line a site puts in `og:description`.
 */
async function runLinkJob(model: Classifier | null, itemId: string) {
  const [item] = await db
    .select({ id: boxItems.id, boxId: boxItems.boxId, url: boxItems.url })
    .from(boxItems)
    .where(eq(boxItems.id, itemId))
    .limit(1);

  if (!item?.url) return;

  const resolved = await resolveLink(item.url);

  if (resolved.lat !== undefined && resolved.lng !== undefined) {
    await db
      .update(boxItems)
      .set({
        kind: 'location',
        lat: resolved.lat,
        lng: resolved.lng,
        url: resolved.url,
        title: resolved.title,
        searchText: resolved.title,
        status: 'ready',
        updatedAt: new Date(),
      })
      .where(eq(boxItems.id, itemId));
    return;
  }

  let title = resolved.title;
  let description = resolved.description;
  let tagIds: string[] = [];
  let tagNames: string[] = [];

  if (model && resolved.text && resolved.text.length > 200) {
    const [box] = await db
      .select({ instruction: boxes.instruction, rules: boxes.rules })
      .from(boxes)
      .where(eq(boxes.id, item.boxId))
      .limit(1);

    const categories = await getBoxCategories(item.boxId);

    try {
      const read = await model.classify(
        {
          name: title ?? resolved.url,
          mimeType: 'text/plain',
          bytes: new TextEncoder().encode(resolved.text).buffer as ArrayBuffer,
        },
        { instruction: box?.instruction ?? '', rules: box?.rules ?? '' },
        categories,
      );

      title = read.title || title;
      description = read.description || description;

      const checked = validateTags(categories, read.tags);
      tagIds = checked.tagIds;
      tagNames = categories
        .flatMap((c) => c.tags)
        .filter((t) => tagIds.includes(t.id))
        .map((t) => t.name);
    } catch {
      // The page was fetched and that is the part that matters. A model that
      // refused it costs the tags, not the entry.
    }
  }

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
      url: resolved.url,
      title,
      description,
      imageUrl: resolved.imageUrl,
      text: resolved.text,
      searchText: [description, resolved.text, tagNames.join(' ')]
        .filter(Boolean)
        .join('\n')
        .slice(0, MAX_TEXT_CHARS),
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

  if (item.kind === 'location' || item.kind === 'note') {
    // Already in final form: nothing to read.
    await db.delete(boxJobs).where(eq(boxJobs.itemId, itemId));
    return;
  }

  if (item.kind === 'document' && !canClassify(item.mimeType)) {
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

/**
 * Push one document’s title out to Drive.
 *
 * Reads the row back rather than trusting what was just written, because the
 * *extension* comes from the name Drive currently holds and only the row
 * knows it — and because a Docs-editor file must be left alone, which is a
 * fact about the row rather than about the title.
 */
async function renameInDrive(
  itemId: string,
  title: string | null | undefined,
  docDate: string | null,
): Promise<void> {
  if (!title) return;

  try {
    const [row] = await db
      .select({
        name: boxItems.name,
        mimeType: boxItems.mimeType,
        driveFileId: boxItems.driveFileId,
      })
      .from(boxItems)
      .where(eq(boxItems.id, itemId))
      .limit(1);

    if (!row?.driveFileId) return;
    // Google names its own editor files; you rename one by typing in its
    // title bar, and the app holding a copy of that name would be pretending
    // to own something it does not.
    if (isGoogleNative(row.mimeType)) return;

    const wanted = driveNameFor(title, row.name, docDate);
    if (!wanted || wanted === row.name) return;

    await renameFile(row.driveFileId, wanted);

    // Written only once Drive agrees. Writing first would leave the app
    // certain of a name that was never applied, and never retrying, because
    // the disagreement the sweep looks for would be gone.
    await db.update(boxItems).set({ name: wanted }).where(eq(boxItems.id, itemId));
  } catch (error) {
    console.error('could not rename in Drive after reading', itemId, error);
  }
}
