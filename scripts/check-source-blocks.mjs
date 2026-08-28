/**
 * Checks for `lib/source-blocks.ts` and `lib/source-highlight.ts`.
 *
 * The caret arithmetic is the part worth testing: a block that lands in the
 * right place but leaves the caret in the wrong one is a button that makes more
 * work than it saves, and it is exactly the sort of thing that looks fine until
 * you use it at the start of a document, or with something selected, or twice
 * in a row.
 *
 * The highlighter has one property that matters more than any colour it picks:
 * its output must reconstruct the input exactly. It sits *behind* a transparent
 * textarea, so a single character added or lost slides the colours out from
 * under the words from that point on.
 *
 *   node --experimental-strip-types scripts/check-source-blocks.mjs
 */

import { applyBlock, blocksFor } from '../apps/web/src/lib/source-blocks.ts';
import { escapeHtml, hasHighlighting, highlight } from '../apps/web/src/lib/source-highlight.ts';

let failures = 0;

const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name}` +
      (ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`),
  );
};

const block = (format, label) => blocksFor(format).find((b) => b.label === label);

// --- inserting -----------------------------------------------------------

{
  const h1 = block('markdown', 'H1');
  const out = applyBlock('', 0, 0, h1);
  check('a heading into an empty document adds no leading newline', out.text, '# Heading\n');
  check('and selects the placeholder', out.text.slice(out.from, out.to), 'Heading');
}

{
  const h1 = block('markdown', 'H1');
  const out = applyBlock('Some text', 9, 9, h1);
  check('a block after text starts its own line', out.text, 'Some text\n# Heading\n');
  check('the placeholder is still selected', out.text.slice(out.from, out.to), 'Heading');
}

{
  const h1 = block('markdown', 'H1');
  const out = applyBlock('Some text\n', 10, 10, h1);
  check('a block after a newline adds no second one', out.text, 'Some text\n# Heading\n');
}

{
  const table = block('markdown', 'Table');
  const out = applyBlock('', 0, 0, table);
  check(
    'a markdown table is three lines',
    out.text,
    '| Column | Column |\n| --- | --- |\n| Cell | Cell |\n',
  );
  check('and the first heading cell is selected', out.text.slice(out.from, out.to), 'Column');
}

// --- wrapping ------------------------------------------------------------

{
  const bold = block('markdown', 'B');
  const out = applyBlock('make this bold', 5, 9, bold);
  check('bold wraps a selection', out.text, 'make **this** bold');
  check('and keeps it selected', out.text.slice(out.from, out.to), 'this');
}

{
  const bold = block('markdown', 'B');
  const out = applyBlock('nothing selected', 0, 0, bold);
  check('bold with no selection inserts a placeholder', out.text.startsWith('**bold**'), true);
  check('and selects the word', out.text.slice(out.from, out.to), 'bold');
}

{
  const em = block('latex', 'I');
  const out = applyBlock('make this italic', 5, 9, em);
  check('LaTeX italic wraps a selection', out.text, 'make \\emph{this} italic');
}

// --- every block is coherent --------------------------------------------

for (const format of ['markdown', 'latex', 'html']) {
  const blocks = blocksFor(format);
  check(`${format} has blocks`, blocks.length > 0, true);

  for (const b of blocks) {
    if (b.select) {
      check(
        `${format} · ${b.label}: its placeholder is in its own text`,
        b.text.includes(b.select),
        true,
      );
    }

    // Inserting into an empty document must never throw and must contain the
    // snippet — the cheapest possible guard against a malformed entry.
    const out = applyBlock('', 0, 0, b);
    check(`${format} · ${b.label}: inserts`, out.text.includes(b.text.trim().split('\n')[0]), true);
    check(
      `${format} · ${b.label}: caret lands inside the document`,
      out.from >= 0 && out.to <= out.text.length && out.from <= out.to,
      true,
    );
  }
}

// --- the highlighter must not change the text ---------------------------

const SAMPLES = {
  markdown: '# Title\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n\n`code` **bold** $x_i$\n<!-- note -->\n',
  latex:
    '% a comment\n\\section{Heading}\n\\begin{itemize}\n  \\item First & second \\\\\n\\end{itemize}\n$x = y$\n',
  html: '<!doctype html>\n<!-- note -->\n<h1 class="a">Hi &amp; bye</h1>\n<p>Text</p>\n',
};

/** Undo the escaping, so the comparison is against the original characters. */
const unescape = (html) =>
  html
    .replace(/<span class="[^"]*">/g, '')
    .replace(/<\/span>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

for (const [format, sample] of Object.entries(SAMPLES)) {
  check(`${format} is highlighted at all`, hasHighlighting(format), true);
  check(
    `${format} highlighting reconstructs the source exactly`,
    unescape(highlight(sample, format)),
    sample + '\n',
  );
  check(
    `${format} colours something`,
    highlight(sample, format).includes('<span'),
    true,
  );
}

check('an unknown format is left alone', hasHighlighting('text'), false);
check(
  'and is still escaped',
  highlight('<script>alert(1)</script>', 'text'),
  '&lt;script&gt;alert(1)&lt;/script&gt;\n',
);
check(
  'angle brackets never survive as markup',
  highlight('<h1>x</h1>', 'html').includes('<h1>'),
  false,
);
check('escapeHtml handles the three that matter', escapeHtml('<&>'), '&lt;&amp;&gt;');

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
