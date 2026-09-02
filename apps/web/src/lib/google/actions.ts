'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import { backfillProjectLinks, drainSyncQueue, retryFailedJobs } from './queue';
import {
  reconcileAttachmentFiles,
  refreshGoogleNames,
  renameDriveAttachments,
} from './attachments';
import { reconcileBoxFiles, renameBoxFiles } from './boxes';
import { LiveGoogleSync } from './live-sync';
import type { LinkDrift } from './sync';
import {
  backfillEnrichment,
  drainEnrichmentQueue,
  retryFailedEnrichment,
} from '@/lib/enrich/queue';

export async function runSyncNow() {
  await requireSession();
  // Names come back in the same pass: if you have just renamed a doc in
  // Google, "run sync now" is the button you would reach for.
  await Promise.all([
    drainSyncQueue(25),
    refreshGoogleNames(),
    renameBoxFiles(),
    reconcileBoxFiles(),
    renameDriveAttachments(),
    reconcileAttachmentFiles(),
  ]);
  revalidateShell();
}

export async function backfillLinks() {
  await requireSession();
  const queued = await backfillProjectLinks();
  // Run straight away rather than waiting for the next cron tick; you asked
  // for it, so you should see it happen.
  if (queued > 0) await drainSyncQueue(50);
  revalidatePath('/connections');
  return queued;
}

export async function retrySyncFailures() {
  await requireSession();
  await retryFailedJobs();
  revalidatePath('/connections');
}

/** Every pane shows attachment names, so a rename touches all of them. */
function revalidateShell() {
  revalidatePath('/', 'layout');
}

export async function runEnrichmentNow() {
  await requireSession();
  await drainEnrichmentQueue(10);
  revalidatePath('/connections');
}

export async function readExistingFiles() {
  await requireSession();
  const queued = await backfillEnrichment();
  if (queued > 0) await drainEnrichmentQueue(20);
  revalidatePath('/connections');
  return queued;
}

export async function retryEnrichmentFailures() {
  await requireSession();
  await retryFailedEnrichment();
  await drainEnrichmentQueue(10);
  revalidatePath('/connections');
}

/**
 * Drift report. Read-only by design — the brief wants this to tell you what
 * diverged, not to quietly undo whatever you did in Drive.
 */
export async function verifyLinksNow(): Promise<LinkDrift[]> {
  await requireSession();
  return new LiveGoogleSync().verifyLinks();
}
