/**
 * Column layouts for the compact list view.
 *
 * The header row and the item rows share one grid template so the columns line
 * up. The screenshot's Evernote showed "Criado | Título"; the equivalents here
 * are whatever actually distinguishes one row from another in each pane.
 */
export type ColumnSet = {
  /** CSS grid-template-columns, applied to both the header and every row. */
  template: string;
  headers: string[];
  /**
   * What sits before the title in a row. The header renders invisible spacers
   * of the same size so the first column label lines up with the titles below
   * it — measured from the real elements rather than a guessed padding.
   */
  leading: 'none' | 'grip' | 'grip-check';
};

/**
 * The title column takes the remaining space and every other column is fixed,
 * so the thing you actually read stays as wide as possible. The pane itself
 * widens in compact mode (see `ListPane`) to make room for the fixed columns.
 */
export const ACTION_COLUMNS: ColumnSet = {
  template: 'minmax(0,1fr) 8rem 8rem 3.5rem',
  headers: ['Title', 'Project', 'Contexts', 'State'],
  leading: 'grip-check',
};

/** Inside a project the project column would repeat, so it's dropped. */
export const PROJECT_ACTION_COLUMNS: ColumnSet = {
  template: 'minmax(0,1fr) 9rem 3.5rem',
  headers: ['Title', 'Contexts', 'State'],
  leading: 'grip-check',
};

export const PROJECT_COLUMNS: ColumnSet = {
  template: 'minmax(0,1fr) 7rem 3rem 3.5rem',
  headers: ['Project', 'Area', 'Next', 'Waiting'],
  leading: 'grip',
};

export const LIST_ITEM_COLUMNS: ColumnSet = {
  template: 'minmax(0,1fr) 5.5rem 7rem',
  headers: ['Item', 'Stage', 'Project'],
  leading: 'grip',
};

export const PURCHASE_COLUMNS: ColumnSet = {
  template: 'minmax(0,1fr) 4.5rem 5.5rem 5rem',
  headers: ['Item', 'Cost', 'Impact', 'Stage'],
  leading: 'grip',
};

/** Inbox rows have no controls before the title, hence `leading: 'none'`. */
export const INBOX_COLUMNS: ColumnSet = {
  template: 'minmax(0,1fr) 4.5rem 6.5rem',
  headers: ['Captured', 'Hint', 'When'],
  leading: 'none',
};

export const ARCHIVE_COLUMNS: ColumnSet = {
  template: 'minmax(0,1fr) 8rem 6rem',
  headers: ['Project', 'Goal', 'Finished'],
  leading: 'none',
};
