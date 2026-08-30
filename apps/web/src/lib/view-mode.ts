import 'server-only';

import { SINGLETON, db, preferences } from '@gtd/db';
import { eq } from 'drizzle-orm';
import type { Preferences } from './pane';

/** The themes there are. Anything else in the column is treated as no choice. */
const THEMES = ['light', 'dark', 'paper', 'sci'] as const;

export type {
  BoxView,
  Preferences,
  Theme,
  ViewMode,
} from './pane';
export {
  DEFAULT_PANE_WIDTH,
  MAX_PANE_WIDTH,
  MIN_PANE_WIDTH,
  paneWidth,
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
    viewMode:
      row?.viewMode === 'compact' || row?.viewMode === 'simple'
        ? row.viewMode
        : 'comfortable',
    boxView: row?.boxView === 'gallery' ? 'gallery' : 'list',
    listPaneWidth: row?.listPaneWidth ?? null,
    /*
     * An allowlist, not a cast. The column is plain text, so a value that is
     * not a theme this app has must come back as null — which means "ask the
     * operating system" and is the one answer that is always safe. Written this
     * way rather than as a chain of ternaries because there are three of them
     * now and a fourth would not fit on the line.
     */
    theme: THEMES.find((t) => t === row?.theme) ?? null,
    appsScriptUrl: row?.appsScriptUrl ?? null,
    // Null and [] mean different things here — "never chosen" versus "chosen,
    // hide nothing" — so an absent value must not collapse to an empty array.
    hiddenCalendars: Array.isArray(row?.hiddenCalendars) ? row.hiddenCalendars : null,
  };
}
