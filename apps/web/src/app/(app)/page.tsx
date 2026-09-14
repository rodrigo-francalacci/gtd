import { redirect } from 'next/navigation';

/**
 * Where the app opens, which is a different answer on each device.
 *
 * On a phone the navigation is the home screen — every box and list one tap
 * from launch, the way a messaging app opens on its conversations. On a desktop
 * the navigation is always on screen anyway, so the brief's default view, "what
 * can I do now", is what fills the rest.
 *
 * The server cannot tell which it is talking to — the difference is a width,
 * and only the browser knows it — so everything goes to `/menu`, and that page
 * moves a desktop on to Now. The installed app starts at `/menu` directly, but
 * this still matters: Android refreshes an installed app's manifest on its own
 * schedule, and until it does the app keeps opening at `/`.
 */
export default function Home() {
  redirect('/menu');
}
