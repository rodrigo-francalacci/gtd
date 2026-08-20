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
