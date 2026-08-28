'use client';

import type { RefObject } from 'react';
import { applyBlock, blocksFor } from '@/lib/source-blocks';
import type { TextFormat } from '@/lib/text-formats';

/**
 * The blocks nobody should have to remember the syntax for.
 *
 * A table is the case that earns this. Markdown's is three lines of pipes with
 * a rule about the alignment row, LaTeX's wants a column specification, and
 * HTML's is four nested tags — all three are things you look up, paste from
 * somewhere else and get subtly wrong. That is exactly the typing a button
 * should do.
 *
 * It inserts and then *selects the placeholder*, so the next thing you type
 * replaces it. A snippet that leaves the caret at the end of a table is one you
 * then have to navigate back into, which is most of the work you were trying to
 * avoid.
 *
 * With something selected, the wrapping blocks wrap it rather than throwing it
 * away — highlight a word, press B, and it is bold. Every editor behaves this
 * way and anyone who has just highlighted a word expects it.
 */
export function SourceToolbar({
  format,
  area,
  value,
  onChange,
}: {
  format: TextFormat;
  area: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
}) {
  const blocks = blocksFor(format);
  if (blocks.length === 0) return null;

  return (
    <div
      /*
       * Scrolls sideways in its own container rather than wrapping. This is a
       * pane, and a strip of fourteen buttons wrapping to three rows on a phone
       * would take a third of the editor — while a pane that grows too wide is
       * the thing the app's own rule about horizontal overflow exists to stop.
       */
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-grey-200 bg-grey-50 px-2 py-1"
    >
      {blocks.map((block) => (
        <button
          key={block.label}
          type="button"
          title={block.title}
          /*
           * The caret has to still be where you left it. A button takes focus
           * on mousedown, the textarea's selection collapses, and the block
           * lands at the top of the document — so the press is suppressed and
           * the click does the work.
           */
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const field = area.current;
            if (!field) return;

            const { text, from, to } = applyBlock(
              value,
              field.selectionStart,
              field.selectionEnd,
              block,
            );

            onChange(text);

            /*
             * After the value has been written back. React re-renders on the
             * change above, and setting a selection before that lands is
             * setting it on text that is about to be replaced.
             */
            requestAnimationFrame(() => {
              field.focus();
              field.setSelectionRange(from, to);
            });
          }}
          className="shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] text-grey-600 hover:bg-grey-200 hover:text-grey-900"
        >
          {block.label}
        </button>
      ))}
    </div>
  );
}
