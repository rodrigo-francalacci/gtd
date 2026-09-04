'use client';

import type { ReactNode } from 'react';
import { FullScreen } from './full-screen';

/**
 * One row, given the whole window: what you wrote on the left, everything else
 * on the right.
 *
 * A detail pane is a column about a third of a screen wide, and it has to hold
 * two different kinds of thing in one scroll — the note, which you *write* and
 * which wants a page, and the facts around it (its files, the documents it
 * cites, when it arrived, what it is used by), which you *consult*. Stacked,
 * writing means scrolling past the facts and checking a fact means scrolling
 * away from the sentence you were in.
 *
 * Side by side, neither moves. That is the whole idea, and it is the same one
 * the boards are built on: the pane is right for choosing what to look at, and
 * wrong for working on it once chosen.
 *
 * **The note is rendered by the caller, not by the detail pane.** Each pane
 * takes `hideNotes` and drops its own block, and the page hands the editor here
 * instead. One boolean per pane rather than teaching four components a second
 * layout — and it means the two columns can scroll independently, which is the
 * point and which a single re-flowed component could not do.
 *
 * **Two scrollers, one `min-h-0` each.** A grid child will not shrink below its
 * content without it, so the whole modal would scroll as one and the columns
 * would come apart at the bottom.
 */
export function FocusView({
  title,
  subtitle,
  closeHref,
  actions,
  notes,
  rest,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  closeHref: string;
  actions?: ReactNode;
  /** The note editor, built by the page against the right row and action. */
  notes: ReactNode;
  /** The detail pane with its note dropped — everything you consult. */
  rest: ReactNode;
}) {
  return (
    <FullScreen
      title={title}
      subtitle={subtitle}
      closeHref={closeHref}
      actions={actions}
    >
      {/*
        Both columns are capped, and the pair is centred.
        
        The writing column has a measure — see `NoteEditor`'s `fill` — so
        letting its panel take every spare pixel left the text floating in the
        middle of an enormous empty sheet, which looks like a mistake rather
        than like margin. Capped at 44rem the panel is the column of text plus a
        little air, which is what a page is.
        
        `justify-center` puts the leftover width outside both panels rather than
        inside one of them. On a very wide screen that reads as a document on a
        desk; on a laptop the cap barely binds and nothing moves.
      */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,44rem)_minmax(0,26rem)] lg:justify-center lg:overflow-hidden">
        {/*
          The writing side. `data-surface="detail"` because it *is* the reading
          surface — the theme with three grounds should put a note on the same
          sheet here as it does in pane three, or the same note would change
          colour on the way into the modal.
        */}
        <section
          data-surface="detail"
          className="min-h-0 overflow-y-auto overflow-x-clip rounded-sm border border-grey-200 px-6 py-5"
        >
          {notes}
        </section>

        <aside
          data-surface="detail"
          className="min-h-0 overflow-y-auto overflow-x-clip rounded-sm border border-grey-200 px-5 py-4"
        >
          {rest}
        </aside>
      </div>
    </FullScreen>
  );
}
