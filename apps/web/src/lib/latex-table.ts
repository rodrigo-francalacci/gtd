/**
 * A LaTeX `tabular` as a table you would recognise.
 *
 * Split out of `latex-html.ts` because a table is where the reading view was
 * furthest from the truth and where nearly all the machinery lives. The old one
 * split on `\\` and `&`, threw away every rule, and called the first row a
 * header — which for a document whose whole content is one wide table meant a
 * grid of cells in the wrong places with none of the lines that made it legible.
 *
 * What this handles is what real documents use: `booktabs` rules, spans in both
 * directions, and the column colours that come with `\columncolor`. It is still
 * not TeX — nothing here measures anything, and column widths are the browser's
 * decision — but the *structure* is now right, and structure is what a table is.
 */

/** A colour by name, from `\definecolor` and the handful everyone assumes. */
export type Palette = Record<string, string>;

const BUILT_IN: Palette = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  yellow: '#ffff00',
  gray: '#808080',
  grey: '#808080',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  darkgray: '#a9a9a9',
  orange: '#ff8000',
  violet: '#8000ff',
  purple: '#800080',
  brown: '#804000',
  pink: '#ffc0cb',
  olive: '#808000',
  teal: '#008080',
  lime: '#bfff00',
};

/**
 * `\definecolor{name}{model}{values}`, for the three models people actually
 * write.
 *
 * `HTML` is a hex string; `rgb` is three fractions; `gray` is one. Anything else
 * — cmyk, named model, an expression like `red!20` — is left out rather than
 * guessed at: a wrong colour is worse than the default, because it looks
 * deliberate.
 */
export function readPalette(preamble: string): Palette {
  const palette: Palette = { ...BUILT_IN };

  for (const m of preamble.matchAll(
    /\\definecolor\{([^}]*)\}\{([^}]*)\}\{([^}]*)\}/g,
  )) {
    const [, name, model, value] = m;
    const spec = value.trim();

    if (/^HTML$/i.test(model) && /^[0-9a-f]{6}$/i.test(spec)) {
      palette[name.trim()] = `#${spec}`;
      continue;
    }

    if (/^rgb$/i.test(model)) {
      const parts = spec.split(',').map((n) => Number(n.trim()));
      if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
        palette[name.trim()] = `rgb(${parts.map((n) => Math.round(n * 255)).join(',')})`;
      }
      continue;
    }

    if (/^gray$/i.test(model)) {
      const level = Number(spec);
      if (Number.isFinite(level)) {
        const v = Math.round(level * 255);
        palette[name.trim()] = `rgb(${v},${v},${v})`;
      }
    }
  }

  return palette;
}

/** `lightcol` or `blue!20` — the second is a mix, and only the base is used. */
function colour(name: string, palette: Palette): string | null {
  const base = name.trim().split('!')[0];
  return palette[base] ?? null;
}

type Column = { align: 'left' | 'center' | 'right'; background: string | null };

/**
 * The column specification: `@{}l >{\columncolor{x}}c r@{}`.
 *
 * Read character by character rather than by regular expression, because `>{}`
 * and `p{}` carry braced arguments that can hold anything, `@{}` is spacing
 * with no column behind it, and `*{3}{c}` repeats. Getting this wrong shifts
 * every colour and alignment one column sideways, which looks like a styling
 * bug and is really a parsing one.
 */
export function readColumns(spec: string, palette: Palette): Column[] {
  const columns: Column[] = [];
  let pending: string | null = null;
  let i = 0;

  const group = (): string => {
    if (spec[i] !== '{') return '';
    let depth = 0;
    const from = i;
    while (i < spec.length) {
      if (spec[i] === '{') depth++;
      else if (spec[i] === '}' && --depth === 0) {
        i++;
        return spec.slice(from + 1, i - 1);
      }
      i++;
    }
    return spec.slice(from + 1);
  };

  while (i < spec.length) {
    const ch = spec[i];

    if (ch === ' ' || ch === '|' || ch === '!') {
      i++;
      continue;
    }

    // `@{...}` is inter-column material, not a column.
    if (ch === '@') {
      i++;
      group();
      continue;
    }

    // `>{...}` decorates the *next* column; `<{...}` decorates the previous.
    if (ch === '>' || ch === '<') {
      i++;
      const body = group();
      const found = /\\(?:columncolor|cellcolor)\{([^}]*)\}/.exec(body);
      if (found && ch === '>') pending = found[1];
      continue;
    }

    if (ch === 'l' || ch === 'c' || ch === 'r') {
      columns.push({
        align: ch === 'l' ? 'left' : ch === 'c' ? 'center' : 'right',
        background: pending ? colour(pending, palette) : null,
      });
      pending = null;
      i++;
      continue;
    }

    // A paragraph column: `p{3cm}`, and `m`/`b` behave the same to a reader.
    if (ch === 'p' || ch === 'm' || ch === 'b' || ch === 'X') {
      i++;
      if (spec[i] === '{') group();
      columns.push({ align: 'left', background: pending ? colour(pending, palette) : null });
      pending = null;
      continue;
    }

    // `*{n}{spec}` — repeat, which is common in wide tables.
    if (ch === '*') {
      i++;
      const count = Number(group().trim());
      const inner = group();
      if (Number.isFinite(count) && count > 0 && count < 200) {
        for (let n = 0; n < count; n++) columns.push(...readColumns(inner, palette));
      }
      continue;
    }

    i++;
  }

  return columns;
}

/** Split on a delimiter, ignoring any inside braces. */
function splitTop(source: string, delimiter: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    // An escaped brace is a character, not nesting.
    if (ch === '\\' && (source[i + 1] === '{' || source[i + 1] === '}')) {
      i++;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0 && source.startsWith(delimiter, i)) {
      out.push(source.slice(start, i));
      i += delimiter.length - 1;
      start = i + 1;
    }
  }

  out.push(source.slice(start));
  return out;
}

/** A braced argument starting at `from`, and where it ends. */
function argAt(source: string, from: number): { body: string; end: number } | null {
  if (source[from] !== '{') return null;

  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) {
      return { body: source.slice(from + 1, i), end: i + 1 };
    }
  }

  return null;
}

/** The rules `booktabs` draws, and where. */
type Rule = { kind: 'full' } | { kind: 'partial'; from: number; to: number };

function readRules(row: string): { rules: Rule[]; rest: string } {
  const rules: Rule[] = [];
  let rest = row;

  rest = rest.replace(/\\(?:top|mid|bottom)rule(?:\[[^\]]*\])?/g, () => {
    rules.push({ kind: 'full' });
    return '';
  });

  rest = rest.replace(/\\hline/g, () => {
    rules.push({ kind: 'full' });
    return '';
  });

  // `\cmidrule(lr){2-4}` — the parenthesised trim is presentation and ignored;
  // the range is not, and is the whole point of using one.
  rest = rest.replace(/\\cmidrule\s*(?:\([^)]*\))?\s*\{(\d+)\s*-\s*(\d+)\}/g, (_m, a, b) => {
    rules.push({ kind: 'partial', from: Number(a), to: Number(b) });
    return '';
  });

  rest = rest.replace(/\\cline\s*\{(\d+)\s*-\s*(\d+)\}/g, (_m, a, b) => {
    rules.push({ kind: 'partial', from: Number(a), to: Number(b) });
    return '';
  });

  return { rules, rest };
}

type Cell = {
  content: string;
  colspan: number;
  rowspan: number;
  align: 'left' | 'center' | 'right' | null;
  background: string | null;
};

/**
 * One cell, after the spanning commands have been read off it.
 *
 * `\multicolumn{2}{>{\columncolor{x}}c}{text}` carries all three of the things
 * a cell can override — how far it reaches, how it is aligned, what colour it
 * is — which is why they are read here rather than left to the inline pass.
 */
function readCell(raw: string, palette: Palette): Cell {
  let content = raw.trim();
  const cell: Cell = { content, colspan: 1, rowspan: 1, align: null, background: null };

  const multicol = /\\multicolumn\s*/.exec(content);
  if (multicol && multicol.index === 0) {
    let at = multicol.index + multicol[0].length;
    const span = argAt(content, at);

    if (span) {
      at = span.end;
      const spec = argAt(content, at);

      if (spec) {
        at = spec.end;
        const body = argAt(content, at);

        cell.colspan = Math.max(1, Math.min(Number(span.body.trim()) || 1, 100));

        const inner = readColumns(spec.body, palette)[0];
        if (inner) {
          cell.align = inner.align;
          cell.background = inner.background;
        }

        content = body ? body.body : content.slice(at);
      }
    }
  }

  const multirow = /\\multirow\s*/.exec(content);
  if (multirow && multirow.index === 0) {
    let at = multirow.index + multirow[0].length;
    const span = argAt(content, at);

    if (span) {
      at = span.end;
      // The width argument, usually `*`, which means "as wide as it needs".
      const width = argAt(content, at);
      if (width) at = width.end;

      // An optional vertical adjustment nobody reads.
      if (content[at] === '[') {
        const close = content.indexOf(']', at);
        if (close > -1) at = close + 1;
      }

      const body = argAt(content, at);
      cell.rowspan = Math.max(1, Math.min(Number(span.body.trim()) || 1, 100));
      content = body ? body.body : content.slice(at);
    }
  }

  // Whole-row and whole-cell colours, which sit in front of the content.
  const rowColour = /\\(?:rowcolor|cellcolor)\s*(?:\[[^\]]*\])?\{([^}]*)\}/.exec(content);
  if (rowColour) {
    cell.background = colour(rowColour[1], palette) ?? cell.background;
    content = content.replace(rowColour[0], '');
  }

  cell.content = content.trim();
  return cell;
}

/**
 * A `tabular` body, as an HTML table.
 *
 * `inline` renders a cell's text — passed in rather than imported, because the
 * inline pass lives in `latex-html.ts` and importing it back would be a cycle.
 */
export function renderTabular(
  body: string,
  spec: string,
  palette: Palette,
  inline: (text: string) => string,
): string {
  const columns = readColumns(spec, palette);

  const rows = splitTop(body, '\\\\')
    .map((row) => readRules(row))
    .filter((row) => row.rest.trim() !== '' || row.rules.length > 0);

  /*
   * Rules belong to the boundary between two rows, and a row carries the ones
   * written before it. The last row's trailing `\bottomrule` has no row after
   * it, so it is held and applied as that row's bottom border.
   */
  const drawn: string[] = [];

  /**
   * How many more rows each column is still covered for by a `\multirow` above
   * it. Without this the cells after a spanning one shift left, which is the
   * single most visible way a table can be wrong.
   */
  const covered: number[] = [];

  let trailing: Rule[] = [];

  for (let r = 0; r < rows.length; r++) {
    const { rules, rest } = rows[r];
    if (rest.trim() === '') {
      // A line of nothing but rules: hand them to the row below.
      trailing = [...trailing, ...rules];
      continue;
    }

    const above = [...trailing, ...rules];
    trailing = [];

    const raw = splitTop(rest, '&');
    const cells: string[] = [];

    let column = 0;
    let taken = 0;

    while (column < Math.max(columns.length, raw.length + taken)) {
      if ((covered[column] ?? 0) > 0) {
        covered[column] -= 1;
        column += 1;

        /*
         * Spanned from above: no cell is written, but the source almost
         * certainly still has an `&` for it.
         *
         * `\multirow` does not remove the cell from the rows below — it draws
         * over them — so LaTeX still wants the column's separator and the
         * convention is to leave it empty. Not consuming that empty field
         * shifts every remaining cell in the row one column right, which is the
         * mirror of the bug this covered-tracking exists to prevent.
         *
         * Only when it *is* empty. Some authors leave the ampersand out
         * entirely, and eating a real cell would be the worse mistake of the
         * two — a value silently in the wrong column reads as data rather than
         * as a rendering fault.
         */
        if (taken < raw.length && raw[taken].trim() === '') taken += 1;
        continue;
      }

      if (taken >= raw.length) break;

      const cell = readCell(raw[taken], palette);
      taken += 1;

      const spec_ = columns[column];
      const align = cell.align ?? spec_?.align ?? 'left';
      const background = cell.background ?? spec_?.background ?? null;

      const borders: string[] = [];

      // A full rule spans everything; a partial one only its own columns, which
      // is what `\cmidrule{2-4}` is for and why they are not interchangeable.
      const oneIndexed = column + 1;
      for (const rule of above) {
        if (rule.kind === 'full') borders.push('border-top:1px solid currentColor');
        else if (oneIndexed >= rule.from && oneIndexed <= rule.to) {
          borders.push('border-top:1px solid currentColor');
        }
      }

      if (r === rows.length - 1) {
        for (const rule of trailing) void rule;
      }

      const style = [
        `text-align:${align}`,
        background ? `background:${background}` : '',
        ...borders,
      ]
        .filter(Boolean)
        .join(';');

      if (cell.rowspan > 1) {
        for (let c = column; c < column + cell.colspan; c++) {
          covered[c] = cell.rowspan - 1;
        }
      }

      cells.push(
        `<td${cell.colspan > 1 ? ` colspan="${cell.colspan}"` : ''}` +
          `${cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : ''}` +
          `${style ? ` style="${style}"` : ''}>${inline(cell.content)}</td>`,
      );

      column += cell.colspan;
    }

    drawn.push(`<tr>${cells.join('')}</tr>`);
  }

  // Anything left over after the last row is that row's bottom border.
  const closing = trailing.length > 0 ? ' class="ruled-bottom"' : '';

  return `<div class="scroll"><table${closing}><tbody>${drawn.join('')}</tbody></table></div>`;
}
