import { Fragment, type ReactNode } from 'react';
import { isNoteColour, colourVar } from '@/lib/note-colour';

/**
 * A note's rich text, rendered small enough for a list row.
 *
 * The feed used to show `description` — the plain mirror — so a note written
 * with headings, colour and bullets arrived in pane two as a wall of grey.
 * What you formatted is most of what makes a note recognisable at a glance,
 * which is exactly what a list is for, so pane two shows it.
 *
 * Hand-written rather than `generateHTML` from TipTap: that wants the whole
 * extension set loaded to render a line of text, in a list that may draw two
 * hundred rows. This walks the document and returns React, so there is no
 * `dangerouslySetInnerHTML` anywhere near it and nothing a note contains can
 * become markup.
 *
 * Anything it does not recognise renders its children rather than vanishing —
 * the same rule the LaTeX reading view follows. A silently dropped paragraph
 * would make the list lie about what the note says.
 */

type Node = {
  type?: string;
  text?: string;
  content?: Node[];
  attrs?: Record<string, unknown>;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
};

/** Only these; a note holds whatever was pasted into it. */
const SAFE_PROTOCOL = /^(https?:|mailto:)/i;

function withMarks(text: string, marks: Node['marks'], key: string): ReactNode {
  let out: ReactNode = text;

  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        out = <strong>{out}</strong>;
        break;
      case 'italic':
        out = <em>{out}</em>;
        break;
      case 'underline':
        out = <span className="underline underline-offset-2">{out}</span>;
        break;
      case 'strike':
        out = <span className="line-through">{out}</span>;
        break;
      case 'code':
        out = <code className="rounded-sm bg-grey-200 px-1 text-[0.9em]">{out}</code>;
        break;
      case 'noteColour': {
        const colour = mark.attrs?.colour;
        // The name is checked here as well as in the editor: a document can
        // reach this from the database, and only the four are ever painted.
        if (isNoteColour(colour)) {
          out = <span style={{ color: colourVar(colour) }}>{out}</span>;
        }
        break;
      }
      case 'link': {
        const href = String(mark.attrs?.href ?? '');
        if (!SAFE_PROTOCOL.test(href)) break;

        out = (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            /*
             * `relative` for the reason `Linkified` needs it: the row navigates
             * through a `<Link>` stretched over it, so an anchor in the text is
             * underneath that overlay until it is positioned. Only the anchor —
             * lift the line and clicking the words would stop opening the note.
             */
            className="relative text-selected underline underline-offset-2"
          >
            {out}
          </a>
        );
        break;
      }
      default:
        break;
    }
  }

  return <Fragment key={key}>{out}</Fragment>;
}

function render(node: Node, key: string): ReactNode {
  if (node.type === 'text') return withMarks(node.text ?? '', node.marks, key);
  if (node.type === 'hardBreak') return <br key={key} />;

  const children = (node.content ?? []).map((child, i) => render(child, `${key}.${i}`));

  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{children}</p>;
    case 'heading':
      // One weight for every level. A list row is three lines tall; an <h1>
      // drawn at its real size would be the row.
      return (
        <p key={key} className="font-semibold">
          {children}
        </p>
      );
    case 'bulletList':
      return (
        <ul key={key} className="list-disc pl-4">
          {children}
        </ul>
      );
    case 'orderedList':
      return (
        <ol key={key} className="list-decimal pl-4">
          {children}
        </ol>
      );
    case 'listItem':
      return <li key={key}>{children}</li>;
    case 'blockquote':
      return (
        <blockquote key={key} className="border-l-2 border-grey-300 pl-2">
          {children}
        </blockquote>
      );
    case 'codeBlock':
      return (
        <pre key={key} className="overflow-x-auto rounded-sm bg-grey-200 px-1.5 py-1 text-[0.9em]">
          {children}
        </pre>
      );
    default:
      // Unknown, including the document itself: show what is inside it.
      return <Fragment key={key}>{children}</Fragment>;
  }
}

export function NoteText({ doc }: { doc: unknown }) {
  if (!doc || typeof doc !== 'object') return null;
  return <>{render(doc as Node, 'n')}</>;
}
