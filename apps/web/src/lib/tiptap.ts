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
