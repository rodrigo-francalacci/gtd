import type { MetadataRoute } from 'next';

/**
 * Makes the capture page addable to a phone's home screen.
 *
 * `start_url` is `/capture` rather than `/`: the reason to install this on a
 * phone is to get a thought out of your head in one tap, and landing on the
 * desktop shell first would spend the tap that matters. The full app is one
 * link away from inside it.
 *
 * `display: standalone` drops the browser chrome, which is most of what makes
 * the difference between "a bookmark" and "the capture app" until the APK
 * exists.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GTD Capture',
    short_name: 'Capture',
    description: 'Get a thought out of your head — text, photo or voice note.',
    start_url: '/capture',
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
  };
}
