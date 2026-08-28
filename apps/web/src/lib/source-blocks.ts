/**
 * The blocks nobody should have to remember the syntax for.
 *
 * A table is the case that makes this worth having: markdown's is three lines
 * of pipes and hyphens with a rule about the alignment row, LaTeX's is
 * `\begin{tabular}` plus a column spec, and HTML's is four nested tags. All
 * three are things you look up, copy from somewhere else, and get subtly wrong
 * — which is exactly the sort of typing a button should do.
 *
 * Each block says where the caret should land afterwards, because a snippet
 * that drops you at the end of a table is a snippet you then have to navigate
 * back into. `select` marks the run of text to select, so the placeholder is
 * highlighted and the next keystroke replaces it.
 */

export type Block = {
  /** What the button says. Short: this is a strip, not a menu. */
  label: string;
  /** The longer form, for the tooltip. */
  title: string;
  /** What to insert. `|` is not special; selection is given separately. */
  text: string;
  /**
   * The substring to select once inserted — the placeholder to type over. Its
   * *first* occurrence, which is why placeholders are distinctive words rather
   * than "text".
   */
  select?: string;
  /**
   * Whether it must start on its own line. A heading in the middle of a
   * sentence is not a heading, so the caret is moved to a fresh line first.
   */
  block?: boolean;
  /** Wrap the current selection instead of inserting a placeholder. */
  wrap?: { before: string; after: string };
};

const MARKDOWN: Block[] = [
  { label: 'H1', title: 'Heading', text: '# Heading\n', select: 'Heading', block: true },
  { label: 'H2', title: 'Subheading', text: '## Subheading\n', select: 'Subheading', block: true },
  { label: '¶', title: 'Paragraph break', text: '\n\n', block: false },
  { label: '•', title: 'Bullet list', text: '- First\n- Second\n- Third\n', select: 'First', block: true },
  { label: '1.', title: 'Numbered list', text: '1. First\n2. Second\n3. Third\n', select: 'First', block: true },
  {
    label: 'Table',
    title: 'Table',
    text: '| Column | Column |\n| --- | --- |\n| Cell | Cell |\n',
    select: 'Column',
    block: true,
  },
  { label: 'Quote', title: 'Blockquote', text: '> Quoted\n', select: 'Quoted', block: true },
  { label: 'Code', title: 'Code block', text: '```\ncode\n```\n', select: 'code', block: true },
  { label: 'Link', title: 'Link', text: '[text](https://)', select: 'text', wrap: { before: '[', after: '](https://)' } },
  { label: 'Image', title: 'Image', text: '![alt](https://)', select: 'alt' },
  { label: 'B', title: 'Bold', text: '**bold**', select: 'bold', wrap: { before: '**', after: '**' } },
  { label: 'I', title: 'Italic', text: '*italic*', select: 'italic', wrap: { before: '*', after: '*' } },
  { label: '—', title: 'Horizontal rule', text: '\n---\n', block: true },
];

const LATEX: Block[] = [
  { label: '§', title: 'Section', text: '\\section{Heading}\n', select: 'Heading', block: true },
  { label: '§§', title: 'Subsection', text: '\\subsection{Heading}\n', select: 'Heading', block: true },
  { label: '¶', title: 'Paragraph break', text: '\n\n', block: false },
  {
    label: '•',
    title: 'Bullet list',
    text: '\\begin{itemize}\n  \\item First\n  \\item Second\n\\end{itemize}\n',
    select: 'First',
    block: true,
  },
  {
    label: '1.',
    title: 'Numbered list',
    text: '\\begin{enumerate}\n  \\item First\n  \\item Second\n\\end{enumerate}\n',
    select: 'First',
    block: true,
  },
  {
    label: 'Table',
    title: 'Table',
    text:
      '\\begin{tabular}{ll}\n  Column & Column \\\\\n  Cell & Cell \\\\\n\\end{tabular}\n',
    select: 'Column',
    block: true,
  },
  {
    label: 'Figure',
    title: 'Figure',
    text:
      '\\begin{figure}\n  \\includegraphics{file}\n  \\caption{Caption}\n\\end{figure}\n',
    select: 'file',
    block: true,
  },
  { label: 'Maths', title: 'Displayed maths', text: '\\[\n  x = y\n\\]\n', select: 'x = y', block: true },
  { label: 'Verb', title: 'Verbatim block', text: '\\begin{verbatim}\ncode\n\\end{verbatim}\n', select: 'code', block: true },
  { label: 'B', title: 'Bold', text: '\\textbf{bold}', select: 'bold', wrap: { before: '\\textbf{', after: '}' } },
  { label: 'I', title: 'Italic', text: '\\emph{italic}', select: 'italic', wrap: { before: '\\emph{', after: '}' } },
];

const HTML: Block[] = [
  { label: 'H1', title: 'Heading', text: '<h1>Heading</h1>\n', select: 'Heading', block: true },
  { label: 'H2', title: 'Subheading', text: '<h2>Subheading</h2>\n', select: 'Subheading', block: true },
  { label: '¶', title: 'Paragraph', text: '<p>Text</p>\n', select: 'Text', block: true },
  {
    label: '•',
    title: 'Bullet list',
    text: '<ul>\n  <li>First</li>\n  <li>Second</li>\n</ul>\n',
    select: 'First',
    block: true,
  },
  {
    label: '1.',
    title: 'Numbered list',
    text: '<ol>\n  <li>First</li>\n  <li>Second</li>\n</ol>\n',
    select: 'First',
    block: true,
  },
  {
    label: 'Table',
    title: 'Table',
    text:
      '<table>\n  <tr><th>Column</th><th>Column</th></tr>\n  <tr><td>Cell</td><td>Cell</td></tr>\n</table>\n',
    select: 'Column',
    block: true,
  },
  { label: 'Quote', title: 'Blockquote', text: '<blockquote>Quoted</blockquote>\n', select: 'Quoted', block: true },
  { label: 'Code', title: 'Code block', text: '<pre><code>code</code></pre>\n', select: 'code', block: true },
  { label: 'Link', title: 'Link', text: '<a href="https://">text</a>', select: 'text' },
  { label: 'Image', title: 'Image', text: '<img src="https://" alt="alt">', select: 'alt' },
  { label: 'B', title: 'Bold', text: '<strong>bold</strong>', select: 'bold', wrap: { before: '<strong>', after: '</strong>' } },
  { label: 'I', title: 'Italic', text: '<em>italic</em>', select: 'italic', wrap: { before: '<em>', after: '</em>' } },
];

const BLOCKS: Record<string, Block[]> = { markdown: MARKDOWN, latex: LATEX, html: HTML };

export function blocksFor(format: string): Block[] {
  return BLOCKS[format] ?? [];
}

/**
 * Work out the new text and where the caret goes, without touching the DOM.
 *
 * Pure so it can be reasoned about and checked: the fiddly parts — a block
 * needing its own line, a selection being wrapped rather than replaced — are
 * exactly the parts worth having a test for.
 */
export function applyBlock(
  source: string,
  start: number,
  end: number,
  block: Block,
): { text: string; from: number; to: number } {
  const selected = source.slice(start, end);

  // Something is selected and this block knows how to go round it: wrap rather
  // than throw the selection away, which is what every editor does and what
  // anyone who has just highlighted a word expects.
  if (selected && block.wrap) {
    const inserted = block.wrap.before + selected + block.wrap.after;
    return {
      text: source.slice(0, start) + inserted + source.slice(end),
      from: start + block.wrap.before.length,
      to: start + block.wrap.before.length + selected.length,
    };
  }

  /*
   * A block-level snippet starts on a fresh line. Only a newline is added when
   * one is needed — inserting at the very start, or after an existing line
   * break, needs nothing, and adding one anyway leaves a blank line growing at
   * the top of the document every time a button is pressed.
   */
  const before = source.slice(0, start);
  const lead = block.block && before.length > 0 && !before.endsWith('\n') ? '\n' : '';

  const inserted = lead + block.text;
  const text = before + inserted + source.slice(end);

  if (!block.select) {
    const at = start + inserted.length;
    return { text, from: at, to: at };
  }

  const offset = inserted.indexOf(block.select);
  if (offset < 0) {
    const at = start + inserted.length;
    return { text, from: at, to: at };
  }

  return {
    text,
    from: start + offset,
    to: start + offset + block.select.length,
  };
}
