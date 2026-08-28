/**
 * Colour for the source view, without a syntax-highlighting library.
 *
 * These are three small, well-behaved languages and the job is *reading*, not
 * compiling: what a writer needs is to tell a heading from a paragraph and a
 * command from its argument at a glance. A general highlighter would bring a
 * grammar engine and several hundred kilobytes to answer a question three
 * regular expressions answer, in a pane that already loads a markdown parser
 * and a maths converter on demand.
 *
 * It is deliberately a *tokeniser*, not a parser. It can be wrong about a `#`
 * inside a fenced code block and that costs a wrongly coloured line — which is
 * the whole cost, because nothing downstream reads this. The rendered view is
 * what is authoritative about meaning; this only has to help you find the line
 * you were looking for.
 *
 * **Everything is escaped before any markup is added**, and every token's text
 * goes through `escapeHtml` on the way in. This output is injected as HTML into
 * a layer under the textarea, so a document containing `<script>` must colour
 * it, never run it.
 */

export type Highlight = { text: string; cls?: string };

/** The palette, as semantic classes rather than colours. */
const C = {
  /** Structure: headings, fences, environments — the shape of the document. */
  heading: 'text-[color:var(--code-heading)]',
  /** Markers: list bullets, table pipes, blockquote arrows. */
  marker: 'text-[color:var(--code-marker)]',
  /** Commands, tags and entities — the language rather than the words. */
  keyword: 'text-[color:var(--code-keyword)]',
  /** Strings, URLs, attribute values. */
  string: 'text-[color:var(--code-string)]',
  /** Comments, and anything the reader is meant to skip. */
  comment: 'text-[color:var(--code-comment)]',
  /** Emphasis, inline code, maths — a span that means something extra. */
  accent: 'text-[color:var(--code-accent)]',
} as const;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Run a list of rules over the source, in order, taking the earliest match.
 *
 * Whatever no rule claims comes back as plain text, so the output always
 * reconstructs the input exactly — which is not a nicety. The coloured layer
 * sits *behind* the textarea and the two have to wrap identically, character
 * for character, or the caret drifts away from the colours under it.
 */
function tokenise(source: string, rules: { re: RegExp; cls: string }[]): Highlight[] {
  const out: Highlight[] = [];
  let at = 0;

  while (at < source.length) {
    let best: { index: number; length: number; cls: string } | null = null;

    for (const rule of rules) {
      rule.re.lastIndex = at;
      const match = rule.re.exec(source);
      if (!match || match[0].length === 0) continue;

      if (!best || match.index < best.index) {
        best = { index: match.index, length: match[0].length, cls: rule.cls };
      }
    }

    if (!best) break;

    if (best.index > at) out.push({ text: source.slice(at, best.index) });
    out.push({ text: source.slice(best.index, best.index + best.length), cls: best.cls });
    at = best.index + best.length;
  }

  if (at < source.length) out.push({ text: source.slice(at) });
  return out;
}

const MARKDOWN = [
  // A fenced block, opening line and all, so the language tag is coloured too.
  { re: /^```[^\n]*$/gm, cls: C.heading },
  { re: /^#{1,6} [^\n]*$/gm, cls: C.heading },
  // Setext underlines, which are a heading with nothing that looks like one.
  { re: /^(?:=|-){3,}$/gm, cls: C.heading },
  { re: /^\s*(?:[-*+]|\d+\.)\s/gm, cls: C.marker },
  { re: /^\s*>\s?/gm, cls: C.marker },
  { re: /^\|.*\|$/gm, cls: C.marker },
  { re: /!?\[[^\]\n]*\]\([^)\n]*\)/g, cls: C.string },
  { re: /`[^`\n]+`/g, cls: C.accent },
  { re: /\*\*[^*\n]+\*\*|__[^_\n]+__/g, cls: C.accent },
  { re: /\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, cls: C.accent },
  { re: /^\s*<!--[\s\S]*?-->/gm, cls: C.comment },
];

const LATEX = [
  // A comment runs to the end of the line, and an escaped \% is not one.
  { re: /(?<!\\)%[^\n]*/g, cls: C.comment },
  { re: /\\(?:begin|end)\{[^}\n]*\}/g, cls: C.heading },
  {
    re: /\\(?:chapter|section|subsection|subsubsection|paragraph|title|author|date)\*?(?=[{[])/g,
    cls: C.heading,
  },
  { re: /\\[a-zA-Z@]+\*?/g, cls: C.keyword },
  { re: /\\[^a-zA-Z\s]/g, cls: C.keyword },
  { re: /\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, cls: C.accent },
  { re: /[{}]/g, cls: C.marker },
  { re: /(?<!\\)[&]|\\\\/g, cls: C.marker },
];

const HTML = [
  { re: /<!--[\s\S]*?-->/g, cls: C.comment },
  { re: /<!DOCTYPE[^>]*>/gi, cls: C.comment },
  // The whole tag as one token: colouring the name and the attributes
  // separately needs a parser, and a tag is one thing to the eye anyway.
  { re: /<\/?[a-zA-Z][^>]*>/g, cls: C.keyword },
  { re: /&[a-zA-Z#][a-zA-Z0-9]*;/g, cls: C.accent },
];

const RULES: Record<string, { re: RegExp; cls: string }[]> = {
  markdown: MARKDOWN,
  latex: LATEX,
  html: HTML,
};

/**
 * The source as coloured HTML, ready to sit under a transparent textarea.
 *
 * A trailing newline gets a space after it: a textarea shows a final empty line
 * and an element does not, so without this the layer is one line shorter than
 * the text on top of it and the last line's colours sit above the caret.
 */
export function highlight(source: string, format: string): string {
  const rules = RULES[format];
  if (!rules) return escapeHtml(source) + '\n';

  const html = tokenise(source, rules)
    .map((token) =>
      token.cls
        ? `<span class="${token.cls}">${escapeHtml(token.text)}</span>`
        : escapeHtml(token.text),
    )
    .join('');

  return html + '\n';
}

/** Whether this format gets colour at all. Plain text is plain. */
export function hasHighlighting(format: string): boolean {
  return format in RULES;
}
