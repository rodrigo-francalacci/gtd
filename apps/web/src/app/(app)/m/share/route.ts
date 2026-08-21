import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * The share POST, when the service worker did not catch it.
 *
 * Normally it never runs: `public/sw.js` intercepts this path and redirects
 * with the files parked in the cache. But a worker takes a moment to install
 * on the very first visit, and one can be evicted — and without something
 * here, that share would land on a 405 and look like the app was broken at
 * exactly the moment somebody was trying to use it.
 *
 * So: keep what can be kept. The words survive, because they fit in a query
 * string; the files cannot, because handing them on would mean uploading them
 * to Drive before you had seen the screen, and a capture app must never file
 * something you have not looked at. The page says so rather than silently
 * dropping them — a photo you believe you shared and cannot find later is a
 * worse outcome than being asked to share it again.
 */
export async function POST(request: Request) {
  const params = new URLSearchParams();

  try {
    const form = await request.formData();

    for (const field of ['title', 'text', 'url'] as const) {
      const value = form.get(field);
      if (typeof value === 'string' && value.trim()) params.set(field, value);
    }

    const files = form
      .getAll('files')
      .filter((file) => file instanceof File && file.size > 0);

    if (files.length > 0) params.set('missed', String(files.length));
  } catch {
    // An unreadable share still opens the app. An empty capture box can be
    // recovered from; a browser error page cannot.
  }

  const query = params.toString();

  // 303 so the browser follows with a GET rather than repeating the POST.
  return NextResponse.redirect(new URL(query ? `/m?${query}` : '/m', request.url), 303);
}
