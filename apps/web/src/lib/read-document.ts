/**
 * Asking the app to read a document, from the browser.
 *
 * A plain `fetch` rather than a Server Action, because reading is a Drive
 * download plus a model call and needs its own `maxDuration` — which is a
 * route-segment setting, so the work has to live in a route. See
 * `app/api/box/read/route.ts`.
 */

export type ReadResult = {
  done: number;
  failed: number;
  /** Documents still queued after this call, so a batch knows to go again. */
  remaining: number;
  /** Set when nothing could be read, in words worth showing. */
  error?: string;
};

export async function readDocument(itemId?: string): Promise<ReadResult> {
  const response = await fetch('/api/box/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(itemId ? { itemId } : {}),
  });

  const body = (await response.json().catch(() => ({}))) as Partial<ReadResult> & {
    skipped?: boolean;
    error?: string;
  };

  if (!response.ok) {
    return {
      done: 0,
      failed: 0,
      remaining: 0,
      error: body.error ?? `The app returned ${response.status}.`,
    };
  }

  const result: ReadResult = {
    done: body.done ?? 0,
    failed: body.failed ?? 0,
    remaining: body.remaining ?? 0,
  };

  // No key configured: the queue deliberately claims nothing rather than
  // failing anything, which from here looks like a button that did nothing.
  if (body.skipped) {
    return {
      ...result,
      error:
        'No API key is set, so nothing can be read yet. Documents keep their ' +
        'files and dates, and are read whole once a key is added.',
    };
  }

  if (result.done === 0 && result.failed > 0) {
    return { ...result, error: 'That one could not be read. See the note above.' };
  }

  return result;
}

/**
 * Read everything waiting in the queue, in batches, until there is none.
 *
 * The loop rather than the request: each call reads a few documents and says
 * how many are left, because one long request would die at the function's time
 * limit somewhere in the middle with no way to tell how far it got. Shared, so
 * the box menu and any other caller cannot disagree about when to stop.
 *
 * Bounded at forty passes: a job that stays pending — a stuck row, a retry
 * backing off — would otherwise spin here asking for the same thing forever.
 */
export async function readAllWaiting(
  onProgress: (left: number) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    for (let pass = 0; pass < 40; pass++) {
      const result = await readDocument();

      if (result.error) return { ok: false, error: result.error };

      onProgress(result.remaining);
      if (result.remaining === 0) break;

      // Nothing moved: everything left is backing off after a failure, and
      // asking again immediately would only spin.
      if (result.done === 0 && result.failed === 0) break;
    }

    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach the app.' };
  }
}
