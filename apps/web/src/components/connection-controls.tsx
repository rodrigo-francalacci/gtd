'use client';

import { useState, useTransition } from 'react';
import {
  backfillLinks,
  retrySyncFailures,
  runSyncNow,
  verifyLinksNow,
} from '@/lib/google/actions';
import type { LinkDrift } from '@/lib/google/sync';

const ISSUE_LABELS: Record<LinkDrift['issue'], string> = {
  missing_drive_folder: 'Drive folder missing',
  missing_gmail_label: 'Gmail label missing',
  wrong_parent: 'In the wrong place',
  not_linked: 'Not linked yet',
};

export function SyncControls({ hasFailures }: { hasFailures: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => void runSyncNow())}
        className="rounded-sm bg-grey-800 px-2.5 py-1 text-[12px] text-paper disabled:opacity-40"
      >
        Run sync now
      </button>

      {hasFailures ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => void retrySyncFailures())}
          className="text-[12px] text-grey-600 underline underline-offset-2"
        >
          Retry failed jobs
        </button>
      ) : null}

      {pending ? <span className="text-[11px] text-grey-500">Working…</span> : null}
    </div>
  );
}

/**
 * Catch-up for projects that existed before Google was connected. Deliberately
 * a button rather than something automatic: creating folders and labels in
 * someone's account is not a thing to do behind their back.
 */
export function BackfillLinks({ unlinked }: { unlinked: number }) {
  const [pending, startTransition] = useTransition();
  const [queued, setQueued] = useState<number | null>(null);

  if (unlinked === 0 && queued === null) {
    return (
      <p className="mt-2 text-[12px] text-grey-600">
        Every project has its folder and label.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setQueued(await backfillLinks());
          })
        }
        className="rounded-sm border border-grey-300 px-2.5 py-1 text-[12px] text-grey-700 disabled:opacity-40"
      >
        {pending
          ? 'Creating…'
          : `Create links for ${unlinked} project${unlinked === 1 ? '' : 's'}`}
      </button>

      {queued !== null && !pending ? (
        <p className="mt-2 text-[12px] text-grey-600">
          {queued === 0
            ? 'Nothing left to link.'
            : `Queued ${queued} and ran them. Reload to see the links.`}
        </p>
      ) : null}
    </div>
  );
}

export function VerifyLinks() {
  const [pending, startTransition] = useTransition();
  const [drift, setDrift] = useState<LinkDrift[] | null>(null);

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setDrift(await verifyLinksNow());
          })
        }
        className="rounded-sm border border-grey-300 px-2.5 py-1 text-[12px] text-grey-700 disabled:opacity-40"
      >
        {pending ? 'Checking…' : 'Verify links'}
      </button>

      {drift !== null ? (
        drift.length === 0 ? (
          <p className="mt-2 text-[12px] text-grey-600">
            Everything matches. No drift between the app and Google.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {drift.map((d) => (
              <li key={`${d.projectId}-${d.issue}`} className="text-[12px]">
                <span className="text-grey-800">{d.projectTitle}</span>{' '}
                <span className="text-stale">{ISSUE_LABELS[d.issue]}</span>
                <span className="text-grey-500"> — {d.detail}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
