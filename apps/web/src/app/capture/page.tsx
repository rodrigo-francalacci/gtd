import type { Metadata, Viewport } from 'next';
import { MobileCapture } from '@/components/mobile-capture';
import { requireSession } from '@/lib/auth/session';
import { getRecentCaptures } from '@/lib/queries';

export const metadata: Metadata = {
  title: 'Capture',
  // Added to a home screen this becomes the app's name, so it says what the
  // thing does rather than repeating the system's name.
  appleWebApp: { capable: true, title: 'Capture', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // `resizes-content` keeps the Capture button above the on-screen keyboard
  // instead of behind it. Pinch-zoom is left alone: disabling it to stop iOS
  // zooming on focus is the wrong fix, and 16px text is the right one.
  interactiveWidget: 'resizes-content',
};

/**
 * Capture, for a phone and for the browser extension.
 *
 * Outside the `(app)` route group on purpose: that group is the three-pane
 * desktop shell with a sidebar, and none of it belongs on a phone held in one
 * hand. This is a single screen with one job.
 *
 * It still gates on the session, because the group's layout is not doing it
 * here. Signing in once leaves the cookie in place, so the link can go
 * straight to a home screen — and it is why the extension opens this page
 * rather than posting to an API: a navigation carries a `SameSite=Lax` cookie
 * and a cross-site fetch does not.
 *
 * `text` and `url` prefill it. They are the extension's whole payload: what
 * you selected, and where you were.
 */
export default async function CapturePage(props: PageProps<'/capture'>) {
  await requireSession();

  const searchParams = await props.searchParams;
  const text = typeof searchParams.text === 'string' ? searchParams.text : '';
  const url = typeof searchParams.url === 'string' ? searchParams.url : '';

  const recent = await getRecentCaptures(5);

  return <MobileCapture recent={recent} initialText={text} initialUrl={url} />;
}
