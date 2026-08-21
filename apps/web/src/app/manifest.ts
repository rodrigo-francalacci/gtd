import type { MetadataRoute } from 'next';

/**
 * Makes the app installable, and registers it as a share target on Android.
 *
 * `start_url` is `/`, which lands on "what can I do now" — the whole app,
 * because the whole app is on a phone now. It used to open straight onto the
 * capture screen, from when that screen was all there was here; opening a
 * capture box every time you reach for a tool that also holds your projects,
 * boxes and calendar is the tail wagging the dog. Capture is a tap away on the
 * bar, and a share goes there directly without passing through this at all.
 *
 * `display: standalone` drops the browser chrome, which is most of what makes
 * the difference between "a bookmark" and "the capture app".
 */

/**
 * Android's share sheet, via the Web Share Target API.
 *
 * The original brief ruled a PWA out because iOS cannot do this. That is true
 * of iOS and not of Android, which is the platform in use — so the one
 * requirement that would have forced a second native app does not bind, and
 * everything already built is reused instead of rewritten.
 *
 * POST rather than GET, and it is not a preference: a manifest may declare
 * only one share target, and files can only travel as multipart form data. So
 * text and photos come through the same door, and that door has to be a POST.
 * `public/sw.js` intercepts it so the bytes never leave the phone before you
 * have decided to keep them.
 *
 * `accept` is broad on purpose. This is a capture app: the whole point is that
 * whatever you are looking at can be got out of your head without first
 * deciding whether it is the sort of thing the app takes.
 */
const shareTarget = {
  action: '/m/share',
  method: 'POST',
  enctype: 'multipart/form-data',
  params: {
    title: 'title',
    text: 'text',
    url: 'url',
    files: [
      {
        name: 'files',
        accept: ['image/*', 'audio/*', 'video/*', 'application/pdf', 'text/*'],
      },
    ],
  },
};

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GTD',
    short_name: 'GTD',
    description: 'Get a thought out of your head — text, photo or voice note.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Matches --paper in both themes closely enough that the splash does not
    // flash a colour the app never uses.
    background_color: '#ffffff',
    theme_color: '#1c1c1c',
    icons: [
      {
        src: '/capture-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/capture-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
    // Cast: `share_target` is a real manifest member and a well-supported one
    // on Android, but Next's `Manifest` type does not describe it yet.
    ...({ share_target: shareTarget } as object),
  };
}
