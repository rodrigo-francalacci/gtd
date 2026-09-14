import { MenuHome } from '@/components/menu-home';

/**
 * The phone's home screen: the navigation, and nothing else.
 *
 * A phone used to open on "what can I do now" with the map of the app folded
 * into a drawer, so reaching a particular box was two taps — open the drawer,
 * then the box — where a messaging app puts every conversation one tap from
 * launch. The navigation *is* the list of places here, so on a phone it is the
 * first screen and `AppShell` gives it the whole width.
 *
 * A route rather than the drawer left open, because a place is what makes Back
 * work the way it does in that messaging app: open a box from here, press
 * Back, and you are here again. A drawer opened by state has no history entry
 * to come back to, so Back would land on whatever page happened to be under
 * it.
 *
 * No panes of its own. A desktop always has the navigation on screen and
 * nothing to show at this address, so `MenuHome` sends it on to Now — the
 * brief's default view. `/`, sign-in and the Google callback all arrive here
 * rather than at Now, because only the browser knows which device it is.
 */
export default function MenuPage() {
  return <MenuHome />;
}
