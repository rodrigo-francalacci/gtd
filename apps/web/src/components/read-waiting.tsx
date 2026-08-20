'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { readDocument } from '@/lib/read-document';

/**
 * Read everything that's waiting, in batches.
 *
 * The cron drains this queue on its own, but on a Hobby account it may only
 * run daily — Vercel rejects a more frequent schedule outright. A morning's
 * scanning would otherwise sit untitled until tomorrow, which is a long time
 * to wait to find out whether any of it worked.
 *
 * Batched by the route, not here: each request reads a few documents and says
 * how many are left, and this calls again until there are none. One long
 * request would die at the function's time limit somewhere in the middle, with
 * no way to tell how far it got.
 */
export function ReadWaiting({ waiting }: { waiting: number }) {
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = left !== null;

  const run = async () => {
    setError(null);
    setLeft(waiting);

    try {
      // Bounded: a job that stays pending — a stuck row, a backing-off retry —
      // would otherwise spin here forever asking for the same thing.
      for (let pass = 0; pass < 40; pass++) {
        const result = await readDocument();

        if (result.error) {
          setError(result.error);
          break;
        }

        setLeft(result.remaining);
        router.refresh();

        if (result.remaining === 0) break;

        // Nothing moved: everything left is backing off after a failure, and
        // asking again immediately would just spin.
        if (result.done === 0 && result.failed === 0) break;
      }
    } catch {
      setError('Could not reach the app.');
    } finally {
      setLeft(null);
      router.refresh();
    }
  };

  if (waiting === 0 && !running && !error) return null;

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={running}
        onClick={run}
        className="rounded-sm bg-grey-800 px-2 py-0.5 text-[11px] text-paper disabled:opacity-50"
      >
        {running
          ? `Reading… ${left} to go`
          : `Read the ${waiting} waiting`}
      </button>
      {error ? <span className="text-[11px] text-stale">{error}</span> : null}
    </span>
  );
}
