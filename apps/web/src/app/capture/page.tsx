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
 * Capture, for a phone — the stand-in until there is an APK.
 *
 * Outside the `(app)` route group on purpose: that group is the three-pane
 * desktop shell with a sidebar, and none of it belongs on a phone held in one
 * hand. This is a single screen with one job.
 *
 * It still gates on the session, because the group's layout is not doing it
 * here. Signing in once on the phone leaves the cookie in place, so the link
 * can go straight to the home screen afterwards.
 */
export default async function CapturePage() {
  await requireSession();

  const recent = await getRecentCaptures(5);

  return <MobileCapture recent={recent} />;
}
