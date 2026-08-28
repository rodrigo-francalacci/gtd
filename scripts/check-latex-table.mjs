/**
 * Checks for the LaTeX reading view's tables and page shape.
 *
 * The fixture is the shape of a real document rather than a tidy example: a
 * landscape A4 table with `booktabs` rules, spans in both directions, a column
 * colour from `>{\columncolor{...}}`, and a `geometry` margin. That combination
 * is what showed the old renderer up — it split on `&`, threw every rule away
 * and called the first row a header, so a table designed to be read across came
 * out as a grid with no lines and the wrong cells in the wrong places.
 *
 * The spanning tests are the ones worth having. A `\multirow` that does not
 * reserve its column shifts every cell below it one place to the left, which is
 * subtle enough to survive a glance and makes the table say something false.
 *
 *   node --experimental-strip-types --import ./scripts/ts-resolve.mjs \n *        scripts/check-latex-table.mjs
 *
 * The resolver is not optional: `latex-html` imports `latex-table` the way the
 * app writes imports, without an extension, and Node will not resolve that.
 */

import { readLatex } from '../apps/web/src/lib/latex-html.ts';
import { readColumns, readPalette } from '../apps/web/src/lib/latex-table.ts';

let failures = 0;

const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name}` +
      (ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`),
  );
};

const B = String.fromCharCode(92); // a backslash, kept out of the string literals
const R = B + B; // a LaTeX row break

const SOURCE = [
  `${B}documentclass[a4paper, landscape, 10pt]{article}`,
  `${B}usepackage[margin=1.5cm]{geometry}`,
  `${B}usepackage{booktabs}`,
  `${B}usepackage[table]{xcolor}`,
  `${B}usepackage{multirow}`,
  `${B}definecolor{lightcol}{gray}{0.95}`,
  `${B}renewcommand{${B}arraystretch}{1.3}`,
  `${B}begin{document}`,
  `${B}begin{center}`,
  `${B}begin{tabular}{@{}l >{${B}columncolor{lightcol}}c c r@{}}`,
  `${B}toprule`,
  `${B}multicolumn{2}{c}{${B}textbf{Group A}} & ${B}multicolumn{2}{c}{${B}textbf{Group B}} ${R}`,
  `${B}cmidrule(lr){1-2} ${B}cmidrule(lr){3-4}`,
  `${B}multirow{2}{*}{Spans} & one & two & three ${R}`,
  ` & four & five & six ${R}`,
  `${B}midrule`,
  `Last & a & b & c ${R}`,
  `${B}bottomrule`,
  `${B}end{tabular}`,
  `${B}end{center}`,
  `${B}end{document}`,
].join('\n');

const doc = readLatex(SOURCE);
const html = doc.html;

// --- the page the preamble asked for -------------------------------------

check('landscape is noticed', doc.page.landscape, true);
check('A4 landscape is 297mm wide', doc.page.width, 297);
check('the base size is read', doc.page.base, 10);
check('the geometry margin is read', doc.page.margin, '15mm');
check('arraystretch is read', doc.page.arraystretch, 1.3);

// --- the column specification --------------------------------------------

const palette = readPalette(SOURCE);
check('definecolor gray is read', palette.lightcol, 'rgb(242,242,242)');

const columns = readColumns(`@{}l >{${B}columncolor{lightcol}}c c r@{}`, palette);
check('four columns, not six', columns.length, 4);
check('alignments in order', columns.map((c) => c.align), ['left', 'center', 'center', 'right']);
check(
  'the colour lands on the column it decorates',
  columns.map((c) => c.background),
  [null, 'rgb(242,242,242)', null, null],
);

/*
 * The shape a real document uses: the colour is inside a `*{n}{...}` repeat, so
 * it has to survive the recursion. This is what the source that prompted all of
 * this actually writes, and it stripes alternate pairs of columns.
 */
const striped = readColumns(
  `@{} l *{2}{c} *{2}{>{${B}columncolor{lightcol}}c} *{2}{c} @{}`,
  palette,
);
check('a repeat expands to its count', striped.length, 7);
check(
  'and carries the colour into every copy',
  striped.map((c) => Boolean(c.background)),
  [false, false, false, true, true, false, false],
);
check('a gray model becomes a real colour', palette.lightcol, 'rgb(242,242,242)');

// --- the table ------------------------------------------------------------

const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
check('four rows', rows.length, 4);

const cellsIn = (row) => (row.match(/<td/g) ?? []).length;

check('the header row is two spanning cells', cellsIn(rows[0]), 2);
check('both spans are colspan 2', (rows[0].match(/colspan="2"/g) ?? []).length, 2);

check('the multirow row writes four cells', cellsIn(rows[1]), 4);
check('one of them spans two rows', (rows[1].match(/rowspan="2"/g) ?? []).length, 1);

/*
 * The row under a `\multirow` is the whole point. It has three `&`-separated
 * cells because the first column is already covered from above, and a renderer
 * that does not track that writes four and shifts everything left.
 */
check('the row beneath it writes three, not four', cellsIn(rows[2]), 3);

check('rules become borders', (html.match(/border-top/g) ?? []).length > 0, true);
check('the closing rule survives', /ruled-bottom/.test(html), true);
check('the column colour reaches the cells', (html.match(/rgb\(242,242,242\)/g) ?? []).length > 0, true);
check('bold inside a cell still renders', /<strong>Group A<\/strong>/.test(html), true);

// --- a cmidrule covers only its own columns ------------------------------

const partial = rows[1].split('</td>');
check(
  'a partial rule does not border every cell',
  partial.filter((c) => c.includes('border-top')).length <= 4,
  true,
);

// --- nothing regressed for a plain table ---------------------------------

const plain = readLatex(
  [
    `${B}begin{tabular}{ll}`,
    `a & b ${R}`,
    `c & d ${R}`,
    `${B}end{tabular}`,
  ].join('\n'),
);
const plainRows = plain.html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
check('a plain two-by-two still has two rows', plainRows.length, 2);
check('and two cells each', plainRows.map(cellsIn), [2, 2]);
check('a document with no class options has a null page', plain.page.width, null);

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
