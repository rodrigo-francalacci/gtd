/**
 * Helpers for the TipTap/ProseMirror JSON stored in the `notes` jsonb columns.
 */

export type TipTapNode = {
  type?: string;
  text?: string;
  content?: TipTapNode[];
  attrs?: Record<string, unknown>;
  marks?: unknown[];
};

export type TipTapDoc = TipTapNode & { type: 'doc' };

export const emptyDoc: TipTapDoc = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/**
 * Flatten a document to plain text. This feeds the `search_text` column, which
 * the generated `search_vector` is built from — so search reaches note bodies,
 * not just titles.
 */
export function extractText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';

  const parts: string[] = [];

  const walk = (node: TipTapNode) => {
    if (typeof node.text === 'string') parts.push(node.text);
    node.content?.forEach(walk);
  };

  walk(doc as TipTapNode);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** True when the document has no meaningful content. */
export function isEmptyDoc(doc: unknown): boolean {
  return extractText(doc).length === 0;
}

/**
 * Turn plain text into a document the note editor can open.
 *
 * The counterpart to `extractText`, for the one place text arrives without an
 * editor behind it: a capture typed on a phone or into the capture box, which
 * has no formatting on purpose. Blank lines separate paragraphs, because that
 * is what someone typing a note means by them.
 *
 * An empty string yields `emptyDoc` rather than a document with no content —
 * ProseMirror rejects a `doc` whose content array is empty.
 */
export function docFromText(text: string): TipTapDoc {
  const paragraphs = text
    // A textarea submits CRLF by specification, so this always has carriage
    // returns in it. Left in, they survive `trim()` in the middle of a
    // paragraph and end up inside the stored text.
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return emptyDoc;

  return {
    type: 'doc',
    content: paragraphs.map((block) => ({
      type: 'paragraph',
      // A single newline inside a paragraph is a line break, not a new one.
      content: block.split('\n').flatMap((line, i) =>
        i === 0
          ? [{ type: 'text', text: line }]
          : [{ type: 'hardBreak' }, { type: 'text', text: line }],
      ),
    })),
  };
}
