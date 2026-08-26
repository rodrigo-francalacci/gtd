'use client';

import { useEffect, useRef, useState } from 'react';
import {
  GOOGLE_DOC,
  GOOGLE_SHEET,
  GOOGLE_SLIDES,
} from '@/lib/google/sync';
import { HTML_MIME, LATEX_MIME, MARKDOWN_MIME } from '@/lib/text-formats';

/**
 * Everything this app can make from nothing, in one menu.
 *
 * There were three buttons — doc, sheet, slides — sitting in a header that
 * already carried a sort control, a record button and a file picker, and which
 * had once overflowed a phone pane badly enough to break the carousel swipe.
 * Adding markdown, LaTeX and HTML as three more buttons would have doubled the
 * row for the sake of things you press occasionally. Six choices behind one
 * word is the right shape once the choices outnumber the room.
 *
 * Grouped, and the grouping is the honest distinction rather than decoration:
 * the top three are files Google owns and edits, and the bottom three are files
 * this app owns and edits in the preview pane. Which of those you are choosing
 * decides where you will be typing a moment later, so it is worth a rule.
 */
export type NewDocumentKind = { mimeType: string; label: string };

const GOOGLE: NewDocumentKind[] = [
  { mimeType: GOOGLE_DOC, label: 'Google Doc' },
  { mimeType: GOOGLE_SHEET, label: 'Google Sheet' },
  { mimeType: GOOGLE_SLIDES, label: 'Google Slides' },
];

const OURS: NewDocumentKind[] = [
  { mimeType: MARKDOWN_MIME, label: 'Markdown' },
  { mimeType: LATEX_MIME, label: 'LaTeX' },
  { mimeType: HTML_MIME, label: 'HTML' },
];

export function NewDocumentMenu({
  onChoose,
  disabled = false,
  label = 'New',
}: {
  onChoose: (kind: NewDocumentKind) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  /**
   * Closes on a click anywhere else and on Escape.
   *
   * Both, because they are two different intentions: clicking away means "not
   * this, that instead", and Escape means "nothing, I was only looking". A menu
   * that answers only the first traps anyone who opened it by accident.
   */
  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (kind: NewDocumentKind) => {
    setOpen(false);
    onChoose(kind);
  };

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800 disabled:opacity-40"
      >
        {label} ▾
      </button>

      {open ? (
        <div
          role="menu"
          /*
           * Right-aligned, because this button sits at the right-hand end of a
           * pane header and a menu hanging left from there would open off the
           * edge of a phone pane — into an axis the pane is not allowed to
           * scroll on.
           */
          className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-sm border border-grey-300 bg-paper py-1 shadow-lg"
        >
          {GOOGLE.map((kind) => (
            <Item key={kind.mimeType} kind={kind} onChoose={choose} />
          ))}

          <div className="my-1 border-t border-grey-200" />

          {OURS.map((kind) => (
            <Item key={kind.mimeType} kind={kind} onChoose={choose} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Item({
  kind,
  onChoose,
}: {
  kind: NewDocumentKind;
  onChoose: (kind: NewDocumentKind) => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => onChoose(kind)}
      className="block w-full px-3 py-1.5 text-left text-[12px] text-grey-700 hover:bg-grey-100 hover:text-grey-900"
    >
      {kind.label}
    </button>
  );
}
