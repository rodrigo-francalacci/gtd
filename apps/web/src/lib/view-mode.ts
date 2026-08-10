import 'server-only';
import { cookies } from 'next/headers';

export type ViewMode = 'comfortable' | 'compact';

export const VIEW_MODE_COOKIE = 'gtd_view';

/**
 * Read the list-pane density.
 *
 * Kept in a cookie rather than localStorage so the server renders the right
 * variant on the first pass — a client-side preference would flash the wrong
 * layout on every navigation. Not in the URL either: this is a standing
 * preference, not part of what a link points at.
 */
export async function getViewMode(): Promise<ViewMode> {
  const store = await cookies();
  return store.get(VIEW_MODE_COOKIE)?.value === 'compact' ? 'compact' : 'comfortable';
}
