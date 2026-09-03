import { Fragment, type ReactNode } from 'react';
import { isNoteColour, colourVar } from '@/lib/note-colour';
import { readToken } from '@/lib/internal-link';

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

const EMPTY: ResolvedLinks = new Map();

type Node = {
  type?: string;
  text?: string;
  content?: Node[];
  attrs?: Record<string, unknown>;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
};

/** Only these; a note holds whatever was pasted into it. */
const SAFE_PROTOCOL = /^(https?:|mailto:)/i;

/** What each token resolves to, or null where the thing has gone. */
export type ResolvedLinks = Map<string, { title: string; href: string } | null>;

function withMarks(
  text: string,
  marks: Node['marks'],
  key: string,
  links: ResolvedLinks,
): ReactNode {
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
      case 'internalLink': {
        const raw = String(mark.attrs?.target ?? '');
        const target = readToken(raw);
        if (!target) break;

        const known = links.get(raw);

        /*
         * A target that has been deleted still shows, struck through and dead.
         *
         * Rendering it as ordinary text was the alternative and it loses
         * something: the note is a record of what you were thinking, and that
         * it once pointed at a project is part of what it said. A link that has
         * gone dead is information. What it pointed *at* is unrecoverable; that
         * it pointed is not.
         *
         * `undefined` — nothing was looked up — is left alone rather than
         * called dead, so a row rendered without a resolution shows plain text
         * instead of striking out every link in the box.
         */
        if (known === null) {
          out = (
            <span
              className="relative text-grey-500 line-through decoration-grey-400"
              title="That no longer exists"
            >
              {out}
            </span>
          );
          break;
        }

        if (!known) break;

        /*
         * Whether this leaves is read off the address rather than the kind.
         *
         * The page decides where a link goes — a box sends all three to its own
         * pane three, a page with no pane sends each to where it lives — so the
         * only thing that can honestly answer "does this leave the app" is the
         * href that came back. Asking the kind instead would have to be updated
         * every time a page changed its mind.
         */
        const away = !known.href.startsWith('/');

        out = (
          <a
            href={known.href}
            target={away ? '_blank' : undefined}
            rel={away ? 'noopener noreferrer' : undefined}
            // `relative` for the reason the anchor below needs it: the row
            // navigates through a stretched overlay this has to sit above.
            className="relative font-medium text-selected underline decoration-dotted underline-offset-2"
            title={known.title}
          >
            {out}
          </a>
        );
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

function render(node: Node, key: string, links: ResolvedLinks): ReactNode {
  if (node.type === 'text') return withMarks(node.text ?? '', node.marks, key, links);
  if (node.type === 'hardBreak') return <br key={key} />;

  const children = (node.content ?? []).map((child, i) =>
    render(child, `${key}.${i}`, links),
  );

  switch (node.type) {
    case 'paragraph':
      /*
       * An empty paragraph is a blank line somebody typed, and it has to keep
       * a line's height.
       *
       * Pressing Enter twice is how a note is given air, and `<p></p>` collapses
       * to nothing — so the break you put in vanished and the paragraphs either
       * side ran together. A `<br>` gives the box a line to be, which is what
       * ProseMirror itself puts in an empty block for the same reason.
       */
      return <p key={key}>{children.length > 0 ? children : <br />}</p>;
    case 'heading': {
      /*
       * The three levels stay three levels.
       *
       * They were flattened to one weight at first, on the argument that a list
       * row is only a few lines tall and an `<h1>` at full size would be the
       * whole row. True of the size, and wrong about the structure: a heading
       * is how a long note is navigated, and three of them rendered
       * identically say the note has no shape. So the sizes are scaled down to
       * suit a row rather than collapsed into each other — smaller than the
       * editor's 1.4/1.2/1.05, still ranked.
       */
      const level = Number(node.attrs?.level ?? 1);
      const size =
        level === 1 ? 'text-[1.15em]' : level === 2 ? 'text-[1.06em]' : 'text-[1em]';

      return (
        <p key={key} className={`font-semibold ${size}`}>
          {children}
        </p>
      );
    }

    case 'horizontalRule':
      /*
       * A divider is a real break in a note and it was being dropped: an
       * unrecognised node renders its children, and a rule has none, so it came
       * out as nothing at all. The one node here where "degrade to the
       * contents" degrades to silence.
       */
      /*
       * Lighter than the line between two entries, deliberately.
       *
       * It was `grey-300` against a `grey-200` boundary, so a break *inside* one
       * note looked stronger than the break between two records — the hierarchy
       * upside down. A rule within a note is a whisper; the row's own edge is
       * the statement.
       */
      return <hr key={key} className="my-[0.5em] border-t border-grey-150" />;
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

export function NoteText({
  doc,
  links,
}: {
  doc: unknown;
  /**
   * What each internal token resolves to. Absent means nothing was looked up,
   * and the links render as plain text rather than as dead ones.
   */
  links?: ResolvedLinks;
}) {
  if (!doc || typeof doc !== 'object') return null;

  /*
   * The class is what gives the blocks their spacing.
   *
   * `.ProseMirror` rules only apply inside the editor, and Tailwind's reset
   * zeroes every margin — so in a row the paragraphs had none at all and a
   * note written as three paragraphs arrived as one. The rules live in
   * `globals.css` beside the editor's own and read the same `--note-gap`, so a
   * note set compact is compact in both places.
   */
  return (
    <span className="note-text">{render(doc as Node, 'n', links ?? EMPTY)}</span>
  );
}
