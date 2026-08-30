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
/**
 * Which palette the app draws itself in.
 *
 * Null means "ask the operating system", which a media query answers before
 * first paint. The other three are explicit choices and beat it — `paper` can
 * only ever be one, because no operating system asks for parchment.
 */
export type Theme = 'light' | 'dark' | 'paper' | 'sci' | null;

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

/**
 * How a box lays its documents out.
 *
 * Its own preference rather than a fourth density: the densities trade
 * metadata for rows and apply everywhere, while this only means anything where
 * the things listed have a picture.
 */
export type BoxView = 'list' | 'gallery';

export type Preferences = {
  viewMode: ViewMode;
  boxView: BoxView;
  /** Null means "no explicit choice yet" — fall back to the per-mode default. */
  listPaneWidth: number | null;
  theme: Theme;
  /**
   * The Apps Script panel, if one has been deployed. Null is the ordinary
   * state — the bridges run perfectly well from the script editor.
   */
  appsScriptUrl: string | null;
  /**
   * Google calendars to leave out. Null means no choice has been made here and
   * Google's own ticked state decides — see the column comment in the schema.
   */
  hiddenCalendars: string[] | null;
};

/** The width to render, honouring an explicit choice over the mode default. */
export function paneWidth(prefs: Preferences): number {
  return prefs.listPaneWidth ?? DEFAULT_PANE_WIDTH[prefs.viewMode];
}
