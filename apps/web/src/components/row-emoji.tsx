/**
 * The emoji slot in front of a row's title.
 *
 * **A fixed width, always, once a list has any.** This is the whole design, and
 * the rest of the app already learned it the hard way: a glyph in front of the
 * title on *some* rows indents those rows and leaves the left edge ragged, and
 * in a view whose entire content is a column of titles that is the one thing
 * there is to get right. It is why a paperclip goes on the right.
 *
 * An emoji cannot go on the right — it is there to be seen *before* the words,
 * which is the point of having one — so the slot is reserved instead. Every row
 * in an emojified list gets the same space whether or not it has a glyph to put
 * in it, so the titles still start on one line.
 *
 * `undefined` means this list has never been emojified: no slot at all, and the
 * list is pixel-for-pixel what it was. `null` means this row has no emoji but
 * its neighbours do, so the space is held. That distinction is the component.
 */
export function RowEmoji({ emoji }: { emoji?: string | null }) {
  if (emoji === undefined) return null;

  return (
    <span
      aria-hidden={!emoji}
      /*
       * `w-5` rather than a character's own width, which varies: a flag is wider
       * than a book, and letting each one size itself puts the titles back where
       * they started. `leading-none` keeps a tall glyph from stretching the row
       * beyond the line height the density chose.
       */
      className="w-5 shrink-0 select-none text-center leading-none"
    >
      {emoji ?? ''}
    </span>
  );
}
