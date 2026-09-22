/**
 * What a photographed list is, on both sides of the wire.
 *
 * No `server-only` here: the route reads it, the panel that shows the proposal
 * reads it, and the types have to be the same shape in both — the rule
 * `queries.shared.ts` follows for the same reason.
 */

/**
 * Which list the photo is being read into, which is the whole of what nesting
 * means. The destination is chosen before the shutter, so the page itself
 * never has to say whether an indented line is a queue or a step.
 */
export type ListPhotoKind = 'now' | 'project' | 'purchases' | 'list' | 'inbox';

/** One physical line of handwriting, as read off the paper. */
export type ReadLine = {
  text: string;
  marker: 'bullet' | 'arrow' | 'none';
  indented: boolean;
  struck: boolean;
};

export type ReadItem = {
  text: string;
  /** A number the writer put beside it, for a shopping list. */
  price: number | null;
  /** The symbol as written — never converted, never assumed. */
  currency: string | null;
  /** The reader was not confident of the words. Shown, and worth checking. */
  unsure: boolean;
  /**
   * What sits under it on the page. What that *means* is the destination's
   * business: the next things an action becomes, or a note on a purchase.
   */
  children: Omit<ReadItem, 'children'>[];
};

export type ReadList = {
  /** The verbatim pass, kept so a bad read can be seen rather than guessed at. */
  lines: ReadLine[];
  items: ReadItem[];
};

/** What the child of an item is called, per destination, in the panel. */
export const CHILD_MEANS: Record<ListPhotoKind, string> = {
  now: 'then becomes',
  project: 'then becomes',
  purchases: 'note',
  list: 'note',
  inbox: 'note',
};

/**
 * The longest side a photograph is sent at, and it is two limits at once.
 *
 * A function's request body stops at 4.5 MB on Vercel and a phone photograph
 * is comfortably past it — the sample was 4.9 MB. It is also the size the
 * reader looks at anyway, so sending the original spends upload time on detail
 * that is thrown away before anything reads it.
 */
export const PHOTO_EDGE = 2048;

/** A rail, not a platform limit: a cleaned 2048px page lands near 700 KB. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
