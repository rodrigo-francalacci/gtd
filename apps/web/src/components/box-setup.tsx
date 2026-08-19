'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { createDefaultBox } from '@/lib/actions';

/**
 * First run.
 *
 * A button rather than something that happens on first render, because it
 * makes a folder in someone's Drive — the same call the app makes about
 * backfilling project links. Creating things in a person's Drive without being
 * asked is not a thing to do in the background.
 */
export function BoxSetup() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[17px] font-medium text-grey-900">The Big Box</h1>

      <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-grey-700">
        <p>
          A box you put documents in, newest on top. Scan a letter, a bill or a
          receipt and it lands here — read, named, summarised, dated and tagged,
          so you can find it again by roughly when it arrived or by what was on
          it.
        </p>
        <p>
          Separate from your lists on purpose. A document is not a commitment,
          and filing one is not clarifying. When a document does turn out to
          mean work, you can start a project from it and the two stay linked
          without the file leaving the box.
        </p>
        <p className="text-grey-500">
          This creates one box called Feed, and a <code>GTD/Box/Feed</code>{' '}
          folder in your Drive. You can add more boxes after — receipts, fuel, a
          journal — each with its own tags.
        </p>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await createDefaultBox();
            router.refresh();
          })
        }
        className="self-start rounded-sm bg-grey-800 px-3 py-1.5 text-[12px] text-paper disabled:opacity-50"
      >
        {pending ? 'Setting up…' : 'Set up the Big Box'}
      </button>

      <p className="text-[11px] leading-relaxed text-grey-500">
        Getting scans in needs one more step: the bridge script in{' '}
        <code>scripts/big-box-feed.gs</code>, which watches the folders you scan
        into. The app can only read files it created itself, so something has to
        hand them over — see the README beside it.
      </p>
    </div>
  );
}
