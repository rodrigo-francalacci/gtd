'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { forgetEmail } from '@/lib/actions';
import type { EmailRequestRow } from '@/lib/box/email-requests';
import { IconEnvelope } from './icons';

/**
 * Messages the bridge has been asked for and not yet delivered.
 *
 * Everything else in a box arrives the instant you ask for it — a note, a
 * photograph, a scan. A requested message does not: it waits for the Apps Script
 * to run, which on a time trigger is minutes and on a manual one is until you go
 * and press it. Without a line saying so, pasting a Gmail address looks exactly
 * like pasting one into a text field that ate it.
 *
 * **A failure stays until you dismiss it**, and that is the more important half.
 * The usual reason a request fails is one you can act on — an id Gmail does not
 * recognise, a search that matched nothing — and a request that quietly
 * disappeared would be indistinguishable from one that worked. You would find
 * out months later, looking for a message that was never filed.
 */
export function EmailRequests({ requests }: { requests: EmailRequestRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (requests.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1 px-4 pb-2">
      {requests.map((request) => {
        const failed = request.status === 'failed';

        return (
          <li
            key={request.id}
            className={[
              'flex items-baseline gap-2 rounded-sm px-2 py-1 text-[11px]',
              failed ? 'bg-stale-bg text-stale' : 'bg-grey-100 text-grey-500',
            ].join(' ')}
          >
            <span className="shrink-0 opacity-70">
              <IconEnvelope />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate" title={request.query}>
                {request.query}
              </span>
              <span className="block opacity-80">
                {failed
                  ? (request.note ?? 'The bridge could not find that.')
                  : 'Waiting for the bridge to fetch this.'}
              </span>
            </span>

            {/* Only a failure can be dismissed. Dropping a pending one would
                race the script, which may be fetching it as you press. */}
            {failed ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await forgetEmail(request.id);
                    router.refresh();
                  })
                }
                className="shrink-0 underline underline-offset-2 disabled:opacity-40"
              >
                Dismiss
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
