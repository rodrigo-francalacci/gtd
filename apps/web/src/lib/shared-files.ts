'use client';

/**
 * Collecting the files a share left in the cache.
 *
 * The other half of `public/sw.js`. The worker cannot hand files to a page
 * directly — a redirect carries a URL and nothing else — so it parks them and
 * puts a key in the query. This reads them back out and clears up.
 *
 * They are removed as they are read. The cache is a hand-off, not storage: a
 * photo left behind would be collected again by the next share that happened
 * to be looking, and would sit in the browser's storage until something
 * evicted it.
 */
export async function collectSharedFiles(key: string, count: number): Promise<File[]> {
  if (!('caches' in window)) return [];

  const cache = await caches.open('gtd-share');
  const files: File[] = [];

  for (let index = 0; index < count; index += 1) {
    const path = `/__share/${key}/${index}`;

    const response = await cache.match(path);
    if (!response) continue;

    const blob = await response.blob();
    const name = decodeURIComponent(
      response.headers.get('X-Share-Name') ?? `shared-${index}`,
    );

    files.push(new File([blob], name, { type: blob.type }));
    await cache.delete(path);
  }

  return files;
}

/**
 * Register the worker.
 *
 * Failure is silent and survivable: without it a share of plain text still
 * works — Android will POST to the server, which redirects — and only shared
 * *files* need the interception. Nothing else in the app depends on it.
 */
export function registerShareWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/** An hour is far longer than the half second between the two halves. */
const ABANDONED_AFTER_MS = 60 * 60 * 1000;

/**
 * Throw away files from shares that never landed.
 *
 * The worker parks the bytes and the page collects them, and almost always
 * those happen a moment apart. Almost: back out of the share, lose the app
 * before it draws, kill it mid-launch — and the photo stays in the cache with
 * nobody left who knows it is there. One abandoned share is nothing; the habit
 * of leaving them is a browser store that only ever grows, holding copies of
 * pictures the user thinks they never shared.
 *
 * The key begins with the timestamp it was written at, so deciding is a
 * subtraction and needs no second record to go stale in its own right.
 */
export async function sweepAbandonedShares(): Promise<void> {
  if (!('caches' in window)) return;

  try {
    const cache = await caches.open('gtd-share');
    const cutoff = Date.now() - ABANDONED_AFTER_MS;

    await Promise.all(
      (await cache.keys()).map(async (request) => {
        const [, , key] = new URL(request.url).pathname.split('/');
        const written = Number(key?.split('-')[0]);

        // An unparseable key is one this version did not write. Left alone:
        // guessing at another shape's meaning is how a sweep deletes something
        // that was not abandoned at all.
        if (Number.isFinite(written) && written < cutoff) await cache.delete(request);
      }),
    );
  } catch {
    // Housekeeping. Never worth surfacing, never worth failing a capture for.
  }
}
