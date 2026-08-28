import { readPalette, renderTabular, type Palette } from './latex-table';

/**
 * LaTeX, rendered well enough to read.
 *
 * **This is not TeX.** TeX is a typesetting program: it breaks paragraphs by
 * minimising badness over the whole paragraph, hyphenates from a dictionary,
 * kerns from font metrics, floats figures, numbers and resolves cross
 * references in two passes, and runs a macro expander that is Turing complete.
 * None of that happens here and none of it can, short of shipping a TeX
 * distribution — which for the browser means tens of megabytes of WebAssembly
 * plus a texlive tree to fetch packages from.
 *
 * What this does instead is answer the question the preview pane is actually
 * being asked: *what does this file say?* It reads the document structure —
 * sections, lists, tables, quotes, verbatim, emphasis — and hands the
 * mathematics, which is the part a browser genuinely cannot fake, to a real
 * TeX-to-MathML converter. For notes, a set of derivations, a letter, or the
 * draft of a paper, that is the whole of what you open a preview for.
 *
 * The honest name for the result is a reading view. Printing it produces a PDF
 * of *this*, not of what `pdflatex` would have made, and the pane says so.
 *
 * Everything unrecognised degrades to its argument rather than vanishing: an
 * unknown `\command{text}` renders as `text`. Silently dropping content would
 * make the preview lie about what is in the file, which is worse than showing
 * it unstyled.
 */

/** What a math span was, so the caller can render it with the right display. */
export type MathSpan = { tex: string; display: boolean };

export type LatexDocument = {
  /** HTML with `U+0001 n U+0001` markers where the maths goes. */
  html: string;
  /** The maths, in marker order. */
  math: MathSpan[];
  title: string | null;
  author: string | null;
  date: string | null;
  /**
   * What the preamble asked for about the *page*, which the reading view used
   * to ignore entirely.
   *
   * It cannot typeset, but it can at least be the right shape. A landscape A4
   * document rendered as a portrait column of prose is wrong in the one way a
   * reader notices immediately, and a table laid out for 27cm of width has
   * nowhere to go in 17.
   */
  page: PageShape;
};

export type PageShape = {
  /** Millimetres of usable width, or null when nothing said. */
  width: number | null;
  landscape: boolean;
  /** The class's base size, in points. */
  base: number | null;
  margin: string | null;
  /** From `renewcommand arraystretch` — how tall table rows sit. */
  arraystretch: number | null;
};

/** Paper sizes, in millimetres, for the ones a class option can name. */
const PAPER: Record<string, [number, number]> = {
  a4paper: [210, 297],
  a5paper: [148, 210],
  a3paper: [297, 420],
  letterpaper: [216, 279],
  legalpaper: [216, 356],
  b5paper: [176, 250],
};

function toMillimetres(value: number, unit: string): number {
  if (unit === 'cm') return value * 10;
  if (unit === 'in') return value * 25.4;
  return value;
}

/**
 * What the preamble says about the page.
 *
 * Only the parts a reading view can honour: how wide the text may be, which way
 * round the paper is, how big the base font is, and how tall table rows sit.
 * Everything else a document class does — floats, headers, sectioning depth,
 * the line breaking itself — is out of reach, and pretending otherwise would be
 * the sort of half-measure that misleads rather than helps.
 */
function readPage(preamble: string): PageShape {
  const shape: PageShape = {
    width: null,
    landscape: false,
    base: null,
    margin: null,
    arraystretch: null,
  };

  const options = /\\documentclass\s*\[([^\]]*)\]/.exec(preamble)?.[1] ?? '';
  const geometry = /\\usepackage\s*\[([^\]]*)\]\s*\{geometry\}/.exec(preamble)?.[1] ?? '';
  const all = options + ',' + geometry;

  shape.landscape = /\blandscape\b/.test(all);

  for (const name of Object.keys(PAPER)) {
    if (new RegExp('\\b' + name + '\\b').test(all)) {
      const size = PAPER[name];
      shape.width = shape.landscape ? size[1] : size[0];
      break;
    }
  }

  const paperwidth = /paperwidth\s*=\s*([\d.]+)\s*(mm|cm|in)/.exec(all);
  if (paperwidth) shape.width = toMillimetres(Number(paperwidth[1]), paperwidth[2]);

  const base = /\b(9|10|11|12|14|17|20)pt\b/.exec(options);
  if (base) shape.base = Number(base[1]);

  const margin = /\bmargin\s*=\s*([\d.]+)\s*(mm|cm|in)/.exec(all);
  if (margin) shape.margin = toMillimetres(Number(margin[1]), margin[2]) + 'mm';

  const stretch = /\\renewcommand\s*\{?\\arraystretch\}?\s*\{([\d.]+)\}/.exec(preamble);
  if (stretch) shape.arraystretch = Number(stretch[1]);

  return shape;
}

/** The marker character pair. Control characters cannot occur in source text. */
const MARK = '\u0001';

export const mathMarker = (index: number) => `${MARK}${index}${MARK}`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Pull `\command{...}` off the front of a string, balancing braces.
 *
 * A regular expression cannot do this: `\textbf{a {b} c}` has a nested group,
 * and `\{[^}]*\}` stops at the first inner brace, which silently truncates the
 * argument and leaves the rest of the document inside a bold run.
 */
function readGroup(source: string, from: number): { body: string; end: number } | null {
  if (source[from] !== '{') return null;

  let depth = 0;

  for (let i = from; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') {
      i++;
      continue;
    }
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return { body: source.slice(from + 1, i), end: i + 1 };
    }
  }

  return null;
}

/** Every `\command{...}` in the source, with its argument. */
function findCommand(source: string, name: string): string | null {
  const at = source.indexOf(`\\${name}`);
  if (at === -1) return null;
  const group = readGroup(source, at + name.length + 1);
  return group?.body.trim() ?? null;
}

/**
 * Strip comments.
 *
 * `%` starts one and runs to the end of the line; `\%` is a literal percent and
 * must survive, which is why this cannot be a single `s/%.*$//`. A stray
 * uncommented `%` in a table alignment line is a real thing that happens, and
 * eating the rest of that line takes the table with it.
 */
function stripComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      let out = '';
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\') {
          out += line.slice(i, i + 2);
          i++;
          continue;
        }
        if (line[i] === '%') break;
        out += line[i];
      }
      return out;
    })
    .join('\n');
}

/**
 * Lift the mathematics out before anything else touches the text.
 *
 * Maths is the one part of a LaTeX file where the characters mean what they
 * say — `_`, `^`, `\\`, `{` and `}` are all operators — so every later pass
 * would corrupt it. Replacing each span with a marker first is what lets the
 * rest of this file treat the document as prose without qualification.
 *
 * Verbatim goes the same way and for the same reason, one step earlier: the
 * whole point of `\begin{verbatim}` is that nothing inside it is a command.
 */
/**
 * Lift verbatim blocks out, before anything at all has looked at the text.
 *
 * Earlier even than the comment stripper, which is the whole reason this is
 * its own function rather than the first few lines of `extractSpans`. A `%` in
 * a verbatim block is a percent sign — it is a shell script, or a printf
 * format, or a literal `100%` — and stripping comments first silently ate the
 * rest of every such line. The bug looked like a truncated code sample, which
 * is exactly the sort of thing you read past without noticing.
 */
function extractVerbatim(source: string, verbatim: string[]): string {
  return source.replace(
    /\\begin\{(verbatim|lstlisting|minted)\}[^\n]*\n([\s\S]*?)\\end\{\1\}/g,
    (_match, _env, body: string) => {
      verbatim.push(body.replace(/\n$/, ''));
      return `\n\n${MARK}v${verbatim.length - 1}${MARK}\n\n`;
    },
  );
}

function extractSpans(source: string, math: MathSpan[]): string {
  let out = source;

  const push = (tex: string, display: boolean) => {
    math.push({ tex: tex.trim(), display });
    return display
      ? `\n\n${mathMarker(math.length - 1)}\n\n`
      : mathMarker(math.length - 1);
  };

  // Display first, or `$$…$$` is read as two empty inline spans.
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_m, tex: string) => push(tex, true));
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_m, tex: string) => push(tex, true));
  out = out.replace(
    /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|displaymath)\}([\s\S]*?)\\end\{\1\}/g,
    (_m, env: string, tex: string) =>
      // `align` and friends are environments *inside* the maths, not around it:
      // dropping them would turn a two-column alignment into one long line.
      push(env === 'displaymath' ? tex : `\\begin{${env}}${tex}\\end{${env}}`, true),
  );

  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_m, tex: string) => push(tex, false));
  // A single `$` that is escaped is currency, not maths.
  out = out.replace(/(^|[^\\])\$([^$\n]+?)\$/g, (_m, before: string, tex: string) =>
    before + push(tex, false),
  );

  return out;
}

/** Text-mode escapes and the ligatures TeX turns into punctuation. */
function inlineText(source: string): string {
  let out = escapeHtml(source);

  // Order matters: the three-dash form contains the two-dash form.
  out = out
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '“')
    .replace(/''/g, '”')
    .replace(/~/g, ' ');

  // `\%` and friends, once the ligature passes are done with them.
  out = out.replace(/\\([%&_#$@{}])/g, '$1');
  out = out.replace(/\\(ldots|dots)\b\{?\}?/g, '…');
  out = out.replace(/\\(LaTeX|TeX)\b\{?\}?/g, (_m, which: string) => which);
  out = out.replace(/\\\\(\[[^\]]*\])?/g, '<br />');

  return out;
}

/** `\command{argument}` pairs that become one HTML element. */
const WRAPPERS: Record<string, [string, string]> = {
  textbf: ['<strong>', '</strong>'],
  bf: ['<strong>', '</strong>'],
  textit: ['<em>', '</em>'],
  emph: ['<em>', '</em>'],
  it: ['<em>', '</em>'],
  texttt: ['<code>', '</code>'],
  textsc: ['<span style="font-variant:small-caps">', '</span>'],
  underline: ['<u>', '</u>'],
  uline: ['<u>', '</u>'],
  footnote: ['<span class="footnote"> (', ')</span>'],
};

/** Commands whose whole point is machinery the reading view has no use for. */
const DROPPED = new Set([
  'label',
  'usepackage',
  'documentclass',
  'bibliographystyle',
  'bibliography',
  'centering',
  'noindent',
  /*
   * The `booktabs` rules stay listed for the case of one written outside a
   * table, where there is nothing to draw it on. Inside one they are no longer
   * dropped: `renderTabular` reads them off each row and turns them into
   * borders, which is most of what makes a real document's table legible.
   */
  'hline',
  'toprule',
  'midrule',
  'bottomrule',
  'maketitle',
  'tableofcontents',
  'newpage',
  'clearpage',
  'vspace',
  'hspace',
  'includegraphics',
]);

/**
 * Inline commands, resolved left to right with balanced arguments.
 *
 * A loop rather than a pile of regular expressions, because the arguments
 * nest: `\textbf{a \emph{b} c}` has to come out with both runs intact, and a
 * pass-per-command over the whole string gets the nesting wrong in a way that
 * only shows up on real documents.
 */
function inlineCommands(source: string): string {
  let out = '';
  let i = 0;

  while (i < source.length) {
    const char = source[i];

    if (char !== '\\') {
      out += char;
      i++;
      continue;
    }

    const name = /^\\([a-zA-Z]+)\*?/.exec(source.slice(i));
    if (!name) {
      out += char;
      i++;
      continue;
    }

    const after = i + name[0].length;

    if (name[1] === 'href') {
      const url = readGroup(source, after);
      const text = url ? readGroup(source, url.end) : null;
      if (url && text) {
        out += `<a href="${escapeHtml(url.body)}" rel="noreferrer">${inlineCommands(text.body)}</a>`;
        i = text.end;
        continue;
      }
    }

    if (name[1] === 'url') {
      const url = readGroup(source, after);
      if (url) {
        out += `<a href="${escapeHtml(url.body)}" rel="noreferrer">${escapeHtml(url.body)}</a>`;
        i = url.end;
        continue;
      }
    }

    if (name[1] === 'cite' || name[1] === 'ref' || name[1] === 'eqref') {
      const key = readGroup(source, after);
      if (key) {
        out += `<span class="ref">[${escapeHtml(key.body)}]</span>`;
        i = key.end;
        continue;
      }
    }

    const wrapper = WRAPPERS[name[1]];
    if (wrapper) {
      const body = readGroup(source, after);
      if (body) {
        out += wrapper[0] + inlineCommands(body.body) + wrapper[1];
        i = body.end;
        continue;
      }
    }

    if (DROPPED.has(name[1])) {
      // Optional argument first (`\vspace[2em]`), then the mandatory one.
      let end = after;
      if (source[end] === '[') {
        const close = source.indexOf(']', end);
        if (close !== -1) end = close + 1;
      }
      const body = readGroup(source, end);
      i = body ? body.end : end;
      continue;
    }

    // Anything else keeps its argument and loses its name — an unknown command
    // is still carrying text the reader wants.
    const body = readGroup(source, after);
    if (body) {
      out += inlineCommands(body.body);
      i = body.end;
      continue;
    }

    i = after;
  }

  return out;
}

/**
 * Block structure, walked line by line.
 *
 * Line-based rather than a parser because the blocks that matter are announced
 * on lines of their own: `\section`, `\begin{itemize}`, `\item`, a blank line.
 * The inline pass above is where the nesting lives.
 */
function blocks(source: string, palette: Palette): string {
  const lines = source.split('\n');
  const out: string[] = [];

  /** Open list environments, innermost last. */
  const lists: string[] = [];
  let paragraph: string[] = [];
  let quoting = false;

  /*
   * Emptiness is judged *after* rendering, not before.
   *
   * A line like `\maketitle` or `\centering` is not blank and becomes nothing,
   * and testing the source instead put an empty paragraph into the document
   * for every one of them — a run of blank lines down a reading view, with no
   * way to tell from the output where they came from.
   */
  const flush = () => {
    const text = paragraph.join('\n').trim();
    paragraph = [];
    if (!text) return;
    const rendered = inlineCommands(inlineText(text)).trim();
    if (!rendered) return;
    out.push(`<p>${rendered}</p>`);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      flush();
      continue;
    }

    const heading =
      /^\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(\{)/.exec(
        trimmed,
      );
    if (heading) {
      flush();
      const group = readGroup(trimmed, trimmed.indexOf('{'));
      const level =
        { chapter: 1, section: 2, subsection: 3, subsubsection: 4 }[heading[1]] ?? 5;
      out.push(
        `<h${level}>${inlineCommands(inlineText(group?.body ?? ''))}</h${level}>`,
      );
      continue;
    }

    const begin = /^\\begin\{([a-zA-Z*]+)\}(.*)$/.exec(trimmed);
    if (begin) {
      flush();
      const env = begin[1];

      if (env === 'itemize' || env === 'enumerate' || env === 'description') {
        const tag = env === 'enumerate' ? 'ol' : 'ul';
        lists.push(tag);
        out.push(`<${tag}>`);
        continue;
      }

      if (env === 'quote' || env === 'quotation' || env === 'abstract') {
        quoting = true;
        out.push(env === 'abstract' ? '<blockquote class="abstract">' : '<blockquote>');
        continue;
      }

      if (env === 'tabular' || env === 'tabularx' || env === 'longtable') {
        /*
         * The column specification is an argument, and it is not throwaway:
         * alignment per column and `>{\columncolor{...}}` both live in it, so
         * it is read rather than skipped. `tabularx` puts a width in front of
         * it, which is a measurement this view cannot honour and drops.
         */
        let rest = begin[2];
        if (env === 'tabularx') rest = rest.replace(/^\s*\{[^}]*\}/, '');

        const spec = readGroup(rest, rest.indexOf('{'));
        let body = spec ? rest.slice(spec.end) : rest.replace(/^\s*\{[^}]*\}/, '');

        while (++i < lines.length && !/\\end\{tabular/.test(lines[i])) {
          body += '\n' + lines[i];
        }

        out.push(renderTabular(body, spec?.body ?? '', palette, (text) =>
          inlineCommands(inlineText(text)),
        ));
        continue;
      }

      if (env === 'figure' || env === 'table' || env === 'center') continue;

      if (env === 'document') continue;

      continue;
    }

    const end = /^\\end\{([a-zA-Z*]+)\}$/.exec(trimmed);
    if (end) {
      flush();
      const env = end[1];

      if (env === 'itemize' || env === 'enumerate' || env === 'description') {
        const tag = lists.pop();
        if (tag) out.push(`</${tag}>`);
        continue;
      }

      if (env === 'quote' || env === 'quotation' || env === 'abstract') {
        quoting = false;
        out.push('</blockquote>');
        continue;
      }

      continue;
    }

    if (/^\\item\b/.test(trimmed)) {
      flush();
      const rest = trimmed.replace(/^\\item\s*/, '').replace(/^\[([^\]]*)\]\s*/, (_m, term: string) => `<strong>${escapeHtml(term)}</strong> `);
      out.push(`<li>${inlineCommands(inlineText(rest))}</li>`);
      continue;
    }

    // A display-maths or verbatim marker sits on its own line by construction.
    if (new RegExp(`^${MARK}v?\\d+${MARK}$`).test(trimmed)) {
      flush();
      out.push(trimmed);
      continue;
    }

    paragraph.push(line);
  }

  flush();
  while (lists.length > 0) out.push(`</${lists.pop()}>`);
  if (quoting) out.push('</blockquote>');

  return out.join('\n');
}

/**
 * Read a `.tex` file into HTML plus the maths it contains.
 *
 * The maths comes back separately rather than already rendered because the
 * converter is a 120 KB dependency that only the preview pane ever needs — the
 * caller imports it dynamically and fills the markers in. Which also keeps this
 * file free of anything asynchronous.
 */
export function readLatex(source: string): LatexDocument {
  const verbatim: string[] = [];
  const clean = stripComments(extractVerbatim(source, verbatim));

  const title = findCommand(clean, 'title');
  const author = findCommand(clean, 'author');
  const date = findCommand(clean, 'date');

  // Only what is between `\begin{document}` and `\end{document}`, when the file
  // has a preamble at all. A fragment without one is a whole document here —
  // notes are written that way far more often than they are wrapped.
  const preamble =
    clean.indexOf('\\begin{document}') === -1
      ? ''
      : clean.slice(0, clean.indexOf('\\begin{document}'));

  const page = readPage(preamble);
  const palette = readPalette(preamble);

  const opened = clean.indexOf('\\begin{document}');
  const closed = clean.lastIndexOf('\\end{document}');
  const body =
    opened === -1
      ? clean
      : clean.slice(opened + '\\begin{document}'.length, closed === -1 ? undefined : closed);

  const math: MathSpan[] = [];

  let html = blocks(extractSpans(body, math), palette);

  html = html.replace(
    new RegExp(`${MARK}v(\\d+)${MARK}`, 'g'),
    (_m, index: string) =>
      `<pre class="scroll"><code>${escapeHtml(verbatim[Number(index)] ?? '')}</code></pre>`,
  );

  return {
    html,
    math,
    title: title ? inlineCommands(inlineText(title)) : null,
    author: author ? inlineCommands(inlineText(author)) : null,
    date: date ? inlineCommands(inlineText(date)) : null,
    page,
  };
}
