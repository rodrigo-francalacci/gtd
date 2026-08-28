import { mathMarker, readLatex, type MathSpan } from './latex-html';

/**
 * The text formats the preview pane can read *and* write.
 *
 * Distinct from the types the pane can merely display. A PDF, a photograph and
 * a spreadsheet are all previewable and none of them is editable here — you
 * change a PDF somewhere else and a Google Sheet in Google's own editor. These
 * four are the ones where the file *is* the text: what you see in the source
 * tab is the whole of what is stored, so an editor over it is complete rather
 * than a lossy view of something richer.
 */
export type TextFormat = 'markdown' | 'latex' | 'html' | 'plain';

export const MARKDOWN_MIME = 'text/markdown';
export const LATEX_MIME = 'text/x-tex';
export const HTML_MIME = 'text/html';
export const PLAIN_MIME = 'text/plain';

/** What a new file of each kind is called, and what it starts out saying. */
export const FORMAT_META: Record<
  TextFormat,
  { label: string; extension: string; mime: string; starter: string }
> = {
  markdown: {
    label: 'Markdown',
    extension: 'md',
    mime: MARKDOWN_MIME,
    starter: '# Untitled\n\n',
  },
  latex: {
    label: 'LaTeX',
    extension: 'tex',
    mime: LATEX_MIME,
    starter:
      '\\documentclass{article}\n\n\\title{Untitled}\n\n\\begin{document}\n\\maketitle\n\n\\section{}\n\n\\end{document}\n',
  },
  html: {
    label: 'HTML',
    extension: 'html',
    mime: HTML_MIME,
    starter: '<h1>Untitled</h1>\n\n<p></p>\n',
  },
  plain: { label: 'Text', extension: 'txt', mime: PLAIN_MIME, starter: '' },
};

/**
 * The same table, keyed by mime type.
 *
 * For the create path, which is handed a type and has to know whether it is one
 * of ours — a `text/x-tex` becomes a real file with bytes and starter text, an
 * `application/vnd.google-apps.document` becomes a Google Doc, and the two are
 * different API calls. Derived from `FORMAT_META` rather than written out
 * again, so a format cannot exist in one direction and not the other.
 */
export const FORMAT_BY_MIME: Record<string, (typeof FORMAT_META)[TextFormat]> =
  Object.fromEntries(Object.values(FORMAT_META).map((meta) => [meta.mime, meta]));

/**
 * Which format a file is, from its type and failing that its name.
 *
 * Both, because neither is reliable on its own. Drive types a `.md` upload as
 * `text/markdown` sometimes and `text/plain` or `application/octet-stream`
 * other times depending on what the browser said when it went up, and a file
 * created by this app carries the type we chose. The extension is the thing
 * the author actually decided, so it wins where the two disagree — a file
 * called `notes.tex` is LaTeX whatever a header claims.
 *
 * Null means "not text this pane can edit", which is most files.
 */
export function formatOf(mimeType: string | null, name: string): TextFormat | null {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();

  if (extension === 'md' || extension === 'markdown' || extension === 'mdown') {
    return 'markdown';
  }
  if (extension === 'tex' || extension === 'latex' || extension === 'ltx') return 'latex';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'txt' || extension === 'text') return 'plain';

  const type = (mimeType ?? '').split(';')[0].trim().toLowerCase();

  if (type === MARKDOWN_MIME || type === 'text/x-markdown') return 'markdown';
  if (type === LATEX_MIME || type === 'application/x-tex' || type === 'application/x-latex') {
    return 'latex';
  }
  if (type === HTML_MIME) return 'html';
  if (type === PLAIN_MIME) return 'plain';

  return null;
}

/** Whether a rendered view is worth offering, or the source is the only view. */
export function hasRenderedView(format: TextFormat): boolean {
  return format !== 'plain';
}

/**
 * Render maths to MathML.
 *
 * MathML rather than a picture built out of positioned spans: every browser
 * this app runs in renders it natively now, it needs no font shipped alongside
 * it, and it stays text — so a printed PDF has selectable equations and a
 * screen reader can say them.
 *
 * Imported dynamically. It is the largest thing in this file's dependency tree
 * and only one pane in the app ever opens a document with equations in it;
 * loading it with the shell would put it in front of every navigation.
 */
async function renderMath(spans: MathSpan[]): Promise<string[]> {
  if (spans.length === 0) return [];

  const Temml = (await import('temml')).default;

  return spans.map((span) => {
    try {
      return Temml.renderToString(span.tex, {
        displayMode: span.display,
        // Return the error as markup instead of throwing: one equation with a
        // typo in it should show as one broken equation, not as a document
        // that would not open.
        throwOnError: false,
      });
    } catch {
      return `<code class="broken">${escapeHtml(span.tex)}</code>`;
    }
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const MARK = '\u0001';

/**
 * Markdown, with the maths lifted out first.
 *
 * `$…$` is not markdown and every renderer that supports it does this same
 * two-step, for a reason worth writing down: markdown's emphasis rules will
 * happily read the `_i_` in `$x_i \cdot y_i$` as italics and eat the
 * underscores, and its escaping will turn `<` in `$a < b$` into an entity that
 * the maths converter then cannot parse. Taking the spans out before the
 * markdown parser sees them is the only order that works.
 *
 * Code comes out first for the same reason in reverse: a dollar sign inside a
 * fenced block is a dollar sign, and lifting maths first would turn a shell
 * prompt into an equation.
 */
async function renderMarkdown(source: string): Promise<string> {
  const { marked } = await import('marked');

  const code: string[] = [];
  let text = source.replace(
    /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g,
    (block) => {
      code.push(block);
      return `${MARK}c${code.length - 1}${MARK}`;
    },
  );

  const math: MathSpan[] = [];
  const push = (tex: string, display: boolean) => {
    math.push({ tex: tex.trim(), display });
    return display
      ? `\n\n${mathMarker(math.length - 1)}\n\n`
      : mathMarker(math.length - 1);
  };

  text = text
    .replace(/\$\$([\s\S]*?)\$\$/g, (_m, tex: string) => push(tex, true))
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, tex: string) => push(tex, true))
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, tex: string) => push(tex, false))
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_m, before: string, tex: string) =>
      before + push(tex, false),
    );

  text = text.replace(
    new RegExp(`${MARK}c(\\d+)${MARK}`, 'g'),
    (_m, index: string) => code[Number(index)] ?? '',
  );

  let html = await marked.parse(text, { async: true, gfm: true, breaks: false });

  const rendered = await renderMath(math);

  // A display equation given a paragraph of its own by the parser: unwrap it,
  // or a block-level `<math>` ends up inside a `<p>` that cannot legally hold
  // it, and the browser re-parents it out of sequence.
  html = html.replace(
    new RegExp(`<p>\\s*${MARK}(\\d+)${MARK}\\s*</p>`, 'g'),
    (_m, index: string) => rendered[Number(index)] ?? '',
  );
  html = html.replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
    (_m, index: string) => rendered[Number(index)] ?? '',
  );

  return html;
}

/** LaTeX, read for structure and handed its maths back. */
async function renderLatex(source: string): Promise<string> {
  const document = readLatex(source);
  const rendered = await renderMath(document.math);

  let html = document.html.replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
    (_m, index: string) => rendered[Number(index)] ?? '',
  );

  // `\maketitle` is dropped with the rest of the machinery, so the title block
  // is rebuilt here from what the preamble declared. A document that never
  // called it still gets one: in a reading view the title is wanted whether or
  // not the author asked for it to be typeset.
  if (document.title || document.author || document.date) {
    html =
      `<header class="titleblock">` +
      (document.title ? `<h1>${document.title}</h1>` : '') +
      (document.author ? `<p class="author">${document.author}</p>` : '') +
      (document.date ? `<p class="date">${document.date}</p>` : '') +
      `</header>` +
      html;
  }

  return html;
}

/**
 * The page the preview pane puts in its frame.
 *
 * A whole document rather than a fragment, and the frame is sandboxed with no
 * permissions at all — which is what makes rendering an arbitrary `.html` file
 * safe without sanitising it. `sandbox=""` gives the frame an opaque origin and
 * denies scripts, forms, popups and top-level navigation, so a hostile file can
 * do nothing except look like itself. Sanitising instead would mean deciding
 * which of the author's own tags to throw away, and being wrong about it
 * quietly.
 *
 * Everything it needs is inlined for the same reason: an opaque origin cannot
 * fetch our stylesheet, and a font requested from one would fail CORS. The
 * cost is a stylesheet written twice; the alternative is a preview that renders
 * unstyled the first time someone opens it from a phone.
 *
 * `dark` is passed in rather than read from a media query inside the frame,
 * because the app's theme is a choice stored in the database and the frame can
 * only see the operating system's.
 */
function shell(body: string, dark: boolean, format: TextFormat): string {
  const ink = dark ? '#e6e6e4' : '#1a1a1a';
  const paper = dark ? '#17181a' : '#ffffff';
  const faint = dark ? '#94969d' : '#7a7a7a';
  const rule = dark ? '#34353a' : '#e2e2e2';
  const wash = dark ? '#232427' : '#f4f4f4';
  const link = dark ? '#7aa2f7' : '#1d4ed8';

  /*
   * A measure, centred, exactly as the detail pane sets one. A rendered
   * document is prose and prose has a width beyond which it stops being
   * readable, whatever the window does — and this frame can be dragged very
   * wide indeed, since the preview takes all the space the other panes give up.
   */
  const css = `
    :root { color-scheme: ${dark ? 'dark' : 'light'}; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 1.75rem 1.5rem 4rem;
      background: ${paper};
      color: ${ink};
      font: 15px/1.65 ui-serif, Georgia, "Times New Roman", serif;
      -webkit-text-size-adjust: 100%;
    }
    main { max-width: 42rem; margin: 0 auto; }
    h1, h2, h3, h4, h5, h6 {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      line-height: 1.25;
      text-wrap: balance;
      margin: 1.6em 0 0.5em;
    }
    h1 { font-size: 1.7em; margin-top: 0; }
    h2 { font-size: 1.32em; }
    h3 { font-size: 1.12em; }
    h4, h5, h6 { font-size: 1em; }
    p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
    li { margin: 0.2em 0; }
    a { color: ${link}; }
    code, pre, kbd { font-family: ui-monospace, "Cascadia Mono", Menlo, monospace; }
    code { font-size: 0.88em; background: ${wash}; padding: 0.1em 0.3em; border-radius: 3px; }
    pre { background: ${wash}; padding: 0.75rem 0.9rem; border-radius: 4px; font-size: 0.82em; line-height: 1.5; }
    pre code { background: none; padding: 0; font-size: 1em; }
    blockquote {
      border-left: 3px solid ${rule};
      padding-left: 1rem;
      margin-left: 0;
      color: ${faint};
    }
    blockquote.abstract { font-size: 0.94em; }
    hr { border: 0; border-top: 1px solid ${rule}; margin: 2em 0; }
    table { border-collapse: collapse; font-size: 0.92em; }
    th, td { border: 1px solid ${rule}; padding: 0.35em 0.6em; text-align: left; }
    th { background: ${wash}; font-weight: 600; }
    img { max-width: 100%; height: auto; }
    /* Wide things scroll inside themselves; the page never scrolls sideways. */
    .scroll { overflow-x: auto; max-width: 100%; }
    table { display: block; overflow-x: auto; max-width: 100%; }
    math { font-size: 1.05em; }
    math[display="block"] { display: block; margin: 1.1em 0; overflow-x: auto; }
    .titleblock { text-align: center; margin-bottom: 2.5em; }
    .titleblock h1 { margin-bottom: 0.3em; }
    .titleblock .author, .titleblock .date { margin: 0.1em 0; color: ${faint}; font-size: 0.95em; }
    .ref, .footnote { color: ${faint}; font-size: 0.92em; }
    .broken { color: #b3261e; }
    @media print {
      body { padding: 0; background: #fff; color: #000; }
      main { max-width: none; }
      a { color: inherit; text-decoration: underline; }
    }
  `;

  // An `.html` file is its own document and gets the frame to itself. Wrapping
  // it in our measure and our typography would be editing it.
  if (format === 'html') {
    return body.includes('<html') || body.includes('<!DOCTYPE') || body.includes('<!doctype')
      ? body
      : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main>${body}</main></body></html>`;
}

/**
 * The same page, in a frame that will print itself.
 *
 * Printing is how a PDF gets made here — the browser's own dialogue has "Save
 * as PDF" on every platform this app runs on, and it is a better PDF engine
 * than anything worth writing. Getting to it turns out to be the hard part.
 *
 * The reading frame is `sandbox=""`, which denies scripts and gives the frame
 * an opaque origin, and that is what makes showing an arbitrary `.html` file as
 * itself safe. It also makes printing it impossible twice over: `print` is not
 * on the short list of properties a cross-origin `Window` exposes, so asking
 * the frame to print from out here throws, and `sandbox=""` denies modals,
 * which is what a print dialogue is. The button could never have worked.
 *
 * So printing happens in a *second*, throwaway frame that prints itself on
 * load. It needs `allow-scripts` to do that, and the document being printed may
 * be an arbitrary HTML file with scripts of its own — so a nonce is the whole
 * design: `script-src 'nonce-…'` runs the one script injected here and refuses
 * every script that came with the file. The sandbox is still the guarantee
 * underneath it, opaque origin and all; the policy is the belt to its braces,
 * and neither is trusted alone.
 *
 * Injected as early as the document allows, because a policy only governs what
 * the parser meets after it.
 */
export function printableDocument(html: string): string {
  const nonce = crypto.randomUUID().replace(/-/g, '');

  const inject =
    `<meta http-equiv="Content-Security-Policy" ` +
    `content="script-src 'nonce-${nonce}'; object-src 'none'; base-uri 'none'">` +
    `<script nonce="${nonce}">addEventListener('load', function () { print(); })</script>`;

  // After `<head>` where there is one, then after the doctype, then the top —
  // an `.html` file is its own document and may have any of the three.
  const head = /<head[^>]*>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  if (!head) return inject + html;

  const at = head.index + head[0].length;
  return html.slice(0, at) + inject + html.slice(at);
}

/**
 * Turn a source file into the page the preview frame shows.
 *
 * Async because both the markdown parser and the maths converter are loaded on
 * demand: between them they are most of a quarter of a megabyte, and they are
 * needed by one pane, only when a document of the right kind is opened in it.
 */
export async function renderDocument(
  format: TextFormat,
  source: string,
  dark: boolean,
): Promise<string> {
  if (format === 'html') return shell(source, dark, 'html');
  if (format === 'markdown') return shell(await renderMarkdown(source), dark, format);
  if (format === 'latex') return shell(await renderLatex(source), dark, format);

  return shell(`<pre class="scroll">${escapeHtml(source)}</pre>`, dark, format);
}
