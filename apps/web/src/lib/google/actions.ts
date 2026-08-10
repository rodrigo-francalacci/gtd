'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import { drainSyncQueue, retryFailedJobs } from './queue';
import { LiveGoogleSync } from './live-sync';
import type { LinkDrift } from './sync';

export async function runSyncNow() {
  await requireSession();
  await drainSyncQueue(25);
  revalidatePath('/connections');
}

export async function retrySyncFailures() {
  await requireSession();
  await retryFailedJobs();
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
