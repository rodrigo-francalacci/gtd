/**
 * Pane constants and types shared by server queries and client components.
 * Deliberately free of `server-only` so the resize handle can import it.
 */

/**
 * Three densities, not two.
 *
 * `comfortable` wraps each row's metadata onto a second line and `compact` lays
 * the same fields out as table columns — both answer "what else is true about
 * this row". `simple` answers the other question a list gets asked: what is in
 * it. Titles only, no columns, no header strip, nothing but the line you wrote.
 */
export type ViewMode = 'comfortable' | 'compact' | 'simple';

/**
 * Null is a real value here: it means no choice has been made, and the
 * operating system decides in CSS. Only an explicit pick is stored, so
 * changing the OS setting still moves an app that was never told otherwise.
 */
export type Theme = 'light' | 'dark' | null;

/** Bounds enforced both by the drag handle and by the server action. */
export const MIN_PANE_WIDTH = 260;
export const MAX_PANE_WIDTH = 900;

export const DEFAULT_PANE_WIDTH: Record<ViewMode, number> = {
  comfortable: 480,
  // A table needs room for its fixed columns.
  compact: 736,
  // A title and nothing else needs no more than it takes to read one.
  simple: 380,
};

export type Preferences = {
  viewMode: ViewMode;
  /** Null means "no explicit choice yet" — fall back to the per-mode default. */
  listPaneWidth: number | null;
  theme: Theme;
};

/** The width to render, honouring an explicit choice over the mode default. */
export function paneWidth(prefs: Preferences): number {
  return prefs.listPaneWidth ?? DEFAULT_PANE_WIDTH[prefs.viewMode];
}
