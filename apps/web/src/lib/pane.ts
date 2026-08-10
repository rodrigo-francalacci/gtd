/**
 * Pane constants and types shared by server queries and client components.
 * Deliberately free of `server-only` so the resize handle can import it.
 */

export type ViewMode = 'comfortable' | 'compact';

/** Bounds enforced both by the drag handle and by the server action. */
export const MIN_PANE_WIDTH = 260;
export const MAX_PANE_WIDTH = 900;

export const DEFAULT_PANE_WIDTH: Record<ViewMode, number> = {
  comfortable: 480,
  // A table needs room for its fixed columns.
  compact: 736,
};

export type Preferences = {
  viewMode: ViewMode;
  /** Null means "no explicit choice yet" — fall back to the per-mode default. */
  listPaneWidth: number | null;
};

/** The width to render, honouring an explicit choice over the mode default. */
export function paneWidth(prefs: Preferences): number {
  return prefs.listPaneWidth ?? DEFAULT_PANE_WIDTH[prefs.viewMode];
}
