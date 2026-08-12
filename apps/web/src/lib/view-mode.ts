import 'server-only';

import { SINGLETON, db, preferences } from '@gtd/db';
import { eq } from 'drizzle-orm';
import type { Preferences } from './pane';

export type {
  Preferences,
  Theme,
  ViewMode,
} from './pane';
export {
  DEFAULT_PANE_WIDTH,
  DEFAULT_PREVIEW_WIDTH,
  MAX_PANE_WIDTH,
  MAX_PREVIEW_WIDTH,
  MIN_PANE_WIDTH,
  MIN_PREVIEW_WIDTH,
  paneWidth,
  previewWidth,
} from './pane';

/**
 * UI preferences, read from the database rather than a cookie so they follow
 * the account rather than the browser — which is also what keeps them right
 * once the phone app exists.
 */
export async function getPreferences(): Promise<Preferences> {
  const [row] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.id, SINGLETON))
    .limit(1);

  return {
    viewMode: row?.viewMode === 'compact' ? 'compact' : 'comfortable',
    listPaneWidth: row?.listPaneWidth ?? null,
    previewPaneWidth: row?.previewPaneWidth ?? null,
    theme: row?.theme === 'dark' ? 'dark' : row?.theme === 'light' ? 'light' : null,
  };
}
