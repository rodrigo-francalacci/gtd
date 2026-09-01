'use client';

import { useState, useTransition } from 'react';
import {
  backfillLinks,
  readExistingFiles,
  retryEnrichmentFailures,
  retrySyncFailures,
  runEnrichmentNow,
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
 * Make both containers for every project that is missing either.
 *
 * The one place in the app that means *all of them*, which is why it is a
 * button somebody presses. Everything else waits until there is something to
 * put in a folder or file under a label — creating them in someone's account
 * because a row exists is not a thing to do behind their back.
 */
export function BackfillLinks({ unlinked }: { unlinked: number }) {
  const [pending, startTransition] = useTransition();
  const [queued, setQueued] = useState<number | null>(null);

  if (unlinked === 0 && queued === null) {
    return (
      <p className="mt-2 text-[12px] text-grey-600">
        Every project already has both.
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
          : `Make them for ${unlinked} project${unlinked === 1 ? '' : 's'}`}
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

/**
 * The reading queue. Kept apart from the sync controls because its usual
 * failure is a different one — a missing API key rather than a Google
 * problem — and running them together would send you to the wrong place.
 */
export function EnrichmentControls({
  configured,
  pending,
  failed,
  neverQueued,
}: {
  configured: boolean;
  pending: number;
  failed: number;
  neverQueued: number;
}) {
  const [running, startTransition] = useTransition();
  const [queued, setQueued] = useState<number | null>(null);

  return (
    <>
      {configured ? null : (
        <p className="mt-2 max-w-prose text-[12px] leading-relaxed text-stale">
          No model key is set — the same{' '}
          <code className="text-[11px]">CHATGPT_API_KEY</code> the boxes use, or{' '}
          <code className="text-[11px]">ANTHROPIC_API_KEY</code>. Plain text is
          still read, since that needs no model, but photos and PDFs are left
          alone.{' '}
          {pending > 0
            ? `${pending} ${pending === 1 ? 'file is' : 'files are'} queued and will be read the moment there is a key; they are waiting, not lost.`
            : null}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={running}
          onClick={() => startTransition(async () => void runEnrichmentNow())}
          className="rounded-sm border border-grey-300 px-2.5 py-1 text-[12px] text-grey-700 disabled:opacity-40"
        >
          Read queued files now
        </button>

        {neverQueued > 0 ? (
          <button
            type="button"
            disabled={running}
            onClick={() =>
              startTransition(async () => {
                setQueued(await readExistingFiles());
              })
            }
            className="text-[12px] text-grey-600 underline underline-offset-2"
          >
            Read the {neverQueued} already attached
          </button>
        ) : null}

        {failed > 0 ? (
          <button
            type="button"
            disabled={running}
            onClick={() =>
              startTransition(async () => void retryEnrichmentFailures())
            }
            className="text-[12px] text-grey-600 underline underline-offset-2"
          >
            Retry {failed} failed
          </button>
        ) : null}

        {running ? (
          <span className="text-[11px] text-grey-500">Reading…</span>
        ) : null}
      </div>

      {queued !== null && !running ? (
        <p className="mt-2 text-[12px] text-grey-600">
          Queued {queued}. Anything a model has to read waits for a key.
        </p>
      ) : null}
    </>
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
