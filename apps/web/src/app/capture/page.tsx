import { redirect } from 'next/navigation';

/**
 * The old capture URL, kept as a redirect.
 *
 * Capture moved into the phone app at `/m`, where it is the home screen. This
 * address stays because other things point at it and should not have to be
 * changed in step: the browser extension's signed-out fallback opens
 * `/capture?text=&url=`, a home-screen shortcut may be saved to it, and it has
 * been the phone's address for long enough to be in someone's history.
 *
 * The query is carried across rather than dropped — the whole reason the
 * extension opens this URL is to hand over text a navigation can carry and a
 * cross-site fetch cannot, and arriving at an empty field would lose exactly
 * the thing it was protecting.
 */
export default async function CaptureRedirect(props: PageProps<'/capture'>) {
  const searchParams = await props.searchParams;

  const params = new URLSearchParams();
  for (const key of ['text', 'url', 'title'] as const) {
    const value = searchParams[key];
    if (typeof value === 'string' && value) params.set(key, value);
  }

  const query = params.toString();
  redirect(query ? `/m?${query}` : '/m');
}
