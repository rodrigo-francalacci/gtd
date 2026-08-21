/*
 * The service worker exists for one reason: to catch a share.
 *
 * Android hands a share to an installed web app as an HTTP request to the URL
 * named in the manifest. Text alone could arrive as a GET with query
 * parameters and need none of this — but a manifest may declare only *one*
 * share target, and files can only travel by POST as multipart form data. So
 * the single target has to be a POST, and a POST needs intercepting: left to
 * the network it would go to the server, and the bytes of a photo you have not
 * yet decided to keep would be uploaded before you had seen the screen.
 *
 * Catching it here keeps the files on the device. They are parked in the cache
 * for the moment it takes to redirect, the page collects them, and nothing
 * leaves the phone until Capture is pressed.
 *
 * Deliberately *nothing else*. No offline caching, no precaching, no fetch
 * handling of any other request — a service worker that quietly starts serving
 * stale pages is a bug that outlives its own deployment, and offline is a
 * decision for later rather than something to acquire by accident.
 */

const SHARE_CACHE = 'gtd-share';
const SHARE_PATH = '/m/share';

// Take over immediately rather than waiting for every tab to close. Sharing is
// the first thing this is asked to do, often minutes after installing.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Everything that is not the share POST is left entirely alone — not even
  // passed through, which would make this worker a link in every request.
  if (event.request.method !== 'POST' || url.pathname !== SHARE_PATH) return;

  event.respondWith(handleShare(event.request));
});

async function handleShare(request) {
  const params = new URLSearchParams();

  try {
    const form = await request.formData();

    for (const field of ['title', 'text', 'url']) {
      const value = form.get(field);
      if (typeof value === 'string' && value.trim()) params.set(field, value);
    }

    const files = form
      .getAll('files')
      .filter((file) => file instanceof File && file.size > 0);

    if (files.length > 0) {
      /*
       * Parked in the cache rather than passed along.
       *
       * A redirect cannot carry bytes and the page cannot read the POST body,
       * so the files need somewhere to sit for the half second between the two
       * — and Cache Storage takes a Response, which a File already almost is.
       * Keyed by the moment it happened, so two shares in quick succession
       * cannot collect each other's photos.
       */
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const cache = await caches.open(SHARE_CACHE);

      await Promise.all(
        files.map((file, index) =>
          cache.put(
            shareUrl(key, index),
            new Response(file, {
              headers: {
                'Content-Type': file.type || 'application/octet-stream',
                // The filename does not survive a Response on its own, and it
                // is what the capture list shows for a photo with no words.
                'X-Share-Name': encodeURIComponent(file.name || `shared-${index}`),
              },
            }),
          ),
        ),
      );

      params.set('shared', key);
      params.set('n', String(files.length));
    }
  } catch {
    // A malformed share should still open the app. Arriving at an empty
    // capture box is recoverable; a browser error page is not.
  }

  const query = params.toString();

  // 303, so the browser follows with a GET. A 302 would repeat the POST.
  return Response.redirect(query ? `/m?${query}` : '/m', 303);
}

function shareUrl(key, index) {
  return `/__share/${key}/${index}`;
}
