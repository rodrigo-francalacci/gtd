'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LatexPdf } from './latex-pdf';
import { SourceToolbar } from './source-toolbar';
import { hasHighlighting, highlight } from '@/lib/source-highlight';
import {
  FORMAT_META,
  hasRenderedView,
  printableDocument,
  renderDocument,
  type TextFormat,
} from '@/lib/text-formats';

/**
 * The typography the two editor layers share.
 *
 * Declared once and used by both, because the coloured `pre` and the
 * transparent `textarea` on top of it have to wrap at exactly the same
 * character or the colours drift out from under the words. Two class lists that
 * happen to agree is a bug waiting for one of them to be tidied.
 *
 * 16px on a phone: iOS Safari zooms the page in when a smaller field takes
 * focus, and the editor is one of the few places in this app you type at length
 * on one.
 */
/*
 * One class string for both layers, and every property that can move a line
 * break has to be *stated* here rather than inherited.
 *
 * That is the trap this list exists to avoid, and it caught one: riso sets
 * `word-spacing: -0.12em` on the root for its bitmap-face look, the `<pre>`
 * inherits it and the `<textarea>` does not — browsers do not pass word
 * spacing into a form control. So the highlighted layer wrapped a word or two
 * earlier than the layer you type into, and the source view came out doubled
 * and offset, the two copies drifting further apart down the page.
 *
 * `normal` for both rather than matching the theme, because this is *code*: a
 * monospace grid with the spaces squeezed is wrong on its own terms, and
 * pinning it here makes the view immune to whatever typographic tuning any
 * future theme decides to do.
 *
 * `scrollbar-gutter: stable` is the second half of the same bug, and it was
 * there in every theme all along. The textarea scrolls and the layer behind it
 * does not, so the scrollbar took **fifteen pixels** of content width from one
 * and not the other — measured: 526 against 541 — and every line long enough to
 * reach that far wrapped a word earlier in front than behind. Reserving the
 * gutter on both makes the two content boxes the same width whether a scrollbar
 * is showing or not.
 */
const SOURCE_TEXT =
  'whitespace-pre-wrap break-words p-3 font-mono text-[16px] leading-relaxed md:text-[12.5px] ' +
  '[word-spacing:normal] [letter-spacing:normal] [scrollbar-gutter:stable]';

/**
 * Markdown, LaTeX and HTML, read and written in the preview pane.
 *
 * These are the files where the text *is* the document — nothing is lost by
 * showing you the source, because the source is all there is. That makes them
 * the one kind of file this pane can honestly edit. A PDF is a rendering and a
 * Google Doc has its own editor; here, an editor over the bytes is complete.
 *
 * Two views of one thing rather than two modes of the component. The rendered
 * view is what the file *means* and the source is what it *is*, and moving
 * between them is the whole activity of writing in these formats — so both are
 * one tap away at all times and neither is nested inside anything.
 *
 * The rendered view lives in a sandboxed frame. That is not caution about the
 * user's own files: it is what lets an arbitrary `.html` be shown as itself,
 * script tags and all, without either running them or quietly deleting them.
 */
export function TextDocument({
  src,
  format,
  name,
  roomy = false,
  onFullWidth,
}: {
  /** Where the bytes are — and, on `PUT`, where they go back to. */
  src: string;
  format: TextFormat;
  name: string;
  /**
   * Whether there is room for two columns — true only when the pane has been
   * given the whole window.
   *
   * Side by side is the point of the split view and it needs the width: in the
   * fourth column each half would be about a hundred and fifty pixels, which is
   * neither an editor nor a preview. So the button appears where the room is,
   * rather than everywhere with a media query doing the apologising.
   */
  roomy?: boolean;
  /**
   * Told when the split opens, so the pane can drop the reading measure.
   *
   * A paged format is capped at A4 plus a surround, which is right for reading
   * one page and far too narrow to hold a page *and* an editor. Called from the
   * click rather than from an effect — the button already knows the answer, and
   * a setState inside an effect is the pattern the compiler refuses.
   */
  onFullWidth?: (wide: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState<string | null>(null);

  const [view, setView] = useState<'read' | 'source' | 'split' | 'typeset'>(
    // Plain text has no rendered view worth the name, so it opens where it will
    // stay. Everything else opens rendered: you look at a document far more
    // often than you edit one.
    hasRenderedView(format) ? 'read' : 'source',
  );

  /**
   * The rendered page, and a number that changes every time it is rendered.
   *
   * The number is the whole reason this is an object. Writing a new `srcdoc`
   * onto an iframe that is already on screen does *not* reliably navigate it:
   * React sets the attribute, Chrome keeps the document it already has, and the
   * pane shows the previous rendering — or, from a first render that was still
   * empty, nothing at all. It looked exactly like a renderer that had produced
   * no output. The HTML was correct and sitting in the attribute the whole
   * time; re-setting the attribute by hand painted it instantly, which is what
   * gave it away.
   *
   * So the frame is keyed on this and a fresh element is mounted per rendering,
   * which always loads. The cost is the frame's scroll position, and it is paid
   * only when the document has actually changed.
   */
  const [page, setPage] = useState<{ html: string; seq: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const router = useRouter();
  const area = useRef<HTMLTextAreaElement>(null);

  const dirty = loaded !== null && draft !== loaded;

  // --- reading ------------------------------------------------------------

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? `That file would not load (${response.status}).`);
        }
        const text = await response.text();
        if (!live) return;
        setLoaded(text);
        setDraft(text);
      } catch (error) {
        if (live) setFailed(error instanceof Error ? error.message : 'It would not load.');
      }
    })();

    return () => {
      live = false;
    };
  }, [src]);

  // --- rendering ----------------------------------------------------------

  /**
   * Rendered from the *draft*, not from what was last saved.
   *
   * Which makes the read view a preview in the ordinary sense: type in the
   * source, switch across, and see what you typed. Rendering the saved copy
   * instead would mean the two views could disagree while you were looking at
   * them, and the one showing older text would be the one that looks
   * authoritative.
   */
  useEffect(() => {
    if ((view !== 'read' && view !== 'split') || loaded === null) return;

    let live = true;

    /*
     * Immediate when you have just switched to the reading view, debounced
     * while you are typing beside it.
     *
     * Rendering *remounts the frame* — that is what makes a new `srcdoc` load
     * at all — so doing it per keystroke would throw away the preview's scroll
     * position on every letter, which in a split view is the one thing that has
     * to stay still. A third of a second is about the gap between words.
     */
    const timer = setTimeout(() => {
      void (async () => {
      /*
       * The theme is read from the document rather than passed in. The pane
       * has no server component above it and no access to the preferences row,
       * and the frame itself can only see the operating system's preference —
       * which is the wrong answer whenever an explicit choice has been stored.
       * `data-theme` on `<html>` is where that choice already is.
       */
      const explicit = document.documentElement.getAttribute('data-theme');
      const dark =
        explicit === 'dark' ||
        (explicit === null &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);

      try {
        const html = await renderDocument(format, draft, dark);
        // A new sequence number every time, so the frame below is a new
        // element and is guaranteed to load what it is given.
        if (live) setPage((previous) => ({ html, seq: (previous?.seq ?? 0) + 1 }));
      } catch (error) {
        if (live) {
          setPage(null);
          setFailed(
            error instanceof Error
              ? `That document could not be rendered: ${error.message}`
              : 'That document could not be rendered.',
          );
        }
      }
      })();
    }, view === 'split' ? 350 : 0);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [view, draft, format, loaded]);

  // --- writing ------------------------------------------------------------

  const save = useCallback(async () => {
    if (loaded === null) return;

    setSaving(true);
    setSaveError(null);

    try {
      const response = await fetch(src, {
        method: 'PUT',
        // The body is the document. `GET` gives back a file; `PUT` takes one.
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: draft,
      });

      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) throw new Error(body?.error ?? `Save failed (${response.status}).`);

      // `loaded` is what "unchanged" is measured against, so it has to move to
      // what was actually written — not to the field's current value, which may
      // have gained a word while the request was in flight.
      setLoaded(draft);
      setSavedAt(Date.now());

      /*
       * The route revalidates, but a plain `fetch` is not a Server Action and
       * nothing re-renders on its own — so the file's size sat at "12 B" in the
       * list three feet to the left of a document I had just written a page
       * into. Asking for the refresh here is what makes the two panes agree.
       */
      router.refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'It would not save.');
    } finally {
      setSaving(false);
    }
    // `draft` is read through the closure at call time, which is what a save
    // button wants; the dependency list keeps it current.
  }, [draft, loaded, router, src]);

  /**
   * Ctrl/Cmd-S saves, because in a text editor it is the only shortcut that is
   * genuinely universal, and because the browser's own answer to it — offering
   * to write the whole page to disk — is never what was meant here.
   *
   * Bound to the window rather than the field: after a save you may well be
   * looking at the rendered view, and having the shortcut stop working there
   * would make it feel unreliable rather than modal.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 's' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      void save();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  /**
   * Leaving with unsaved text asks first.
   *
   * The same guard the capture screen uses while files are still going up, and
   * for the same reason: the only copy of this text is in a field in this tab.
   */
  useEffect(() => {
    if (!dirty) return;

    const onLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  /**
   * Print the rendered view, which is how a PDF gets made here.
   *
   * Printing the *document* rather than the page is what makes it print the
   * document instead of three panes of application chrome — but it cannot be
   * done by reaching into the frame on screen. That frame is `sandbox=""`, so
   * it has an opaque origin and `print` is not among the handful of properties
   * a cross-origin `Window` exposes; the call threw, silently, and the sandbox
   * denies modals in any case. Both are deliberate and neither is worth giving
   * up for a button.
   *
   * A second frame is mounted instead, off screen, holding the same rendering
   * with a script that prints it on load — see `printableDocument`, which is
   * also what stops the file's own scripts running in it. Keyed on a counter so
   * that pressing Print twice mounts a fresh element and prints again; the last
   * one stays mounted until the pane is closed, which costs one hidden copy of
   * a document you have just asked to print.
   */
  const [printing, setPrinting] = useState<{ html: string; seq: number } | null>(null);

  /** The coloured layer, scrolled in step with the textarea above it. */
  const colour = useRef<HTMLPreElement>(null);
  const coloured = hasHighlighting(format);

  const print = () => {
    if (!page) return;

    setPrinting((previous) => ({
      html: printableDocument(page.html),
      seq: (previous?.seq ?? 0) + 1,
    }));
  };

  /**
   * The two halves, as elements rather than branches.
   *
   * Pulled out so the split view can hold both without a second copy of
   * either — and each has a hard-won detail in it (the frame's key, so a new
   * `srcdoc` actually loads; the two layers that must lay out identically),
   * which is exactly the sort of thing that gets fixed in one copy and not the
   * other.
   */
  const reading = (
    <iframe
      /*
       * Named, not just numbered.
       *
       * This frame and the printing frame below it are siblings with a
       * sequence counter each, and the counters know nothing about one
       * another — so the first rendering and the first print both asked for
       * key `1` and React reported two children with the same key. The
       * consequence is worse than the warning sounds: keys are how React
       * tells siblings apart, so it is entitled to reuse one frame's
       * element for the other, and this one exists precisely *because* a
       * fresh element is the only reliable way to make an iframe take a new
       * `srcdoc`.
       *
       * A prefix costs nothing and makes the two namespaces separate for
       * good, rather than only while the two counters happen to differ.
       */
      key={`read-${page?.seq ?? 0}`}
      // `sandbox=""` — no permissions at all. Scripts, forms, popups and
      // top-level navigation are all denied and the frame gets an opaque
      // origin, which is what makes showing an arbitrary HTML file safe
      // without editing it first.
      sandbox=""
      srcDoc={page?.html ?? ''}
      title={name}
      className="min-h-0 w-full flex-1 border-0 bg-paper"
    />
  );

  const editor = (
    <>

      <SourceToolbar format={format} area={area} value={draft} onChange={setDraft} />

      {/*
        The editor is two layers: colour underneath, the real textarea on
        top with transparent text and a visible caret.

        There is no way to colour text *inside* a textarea — it renders one
        uniform run and always has. Every editor that does this in a browser
        stacks a highlighted copy behind a see-through input, and the whole
        trick is that the two must lay out identically: same font, same
        size, same line height, same padding, same wrapping. Anything that
        differs on either side and the colours slide out from under the
        words. Hence `SOURCE_TEXT`, which is one string used by both rather
        than two lists that agree today.
      */}
      <div className="relative min-h-0 w-full flex-1 overflow-hidden bg-paper">
        {coloured ? (
          <pre
            ref={colour}
            aria-hidden
            className={`pointer-events-none absolute inset-0 overflow-hidden ${SOURCE_TEXT}`}
            dangerouslySetInnerHTML={{ __html: highlight(draft, format) }}
          />
        ) : null}

        <textarea
          ref={area}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onScroll={(event) => {
            /*
             * The layer under it has to move with it, and this is the one
             * place the illusion can break: a textarea scrolls itself and
             * the `pre` behind it does not know. Set directly rather than
             * through state — a scroll handler that re-renders on every
             * pixel is how a smooth scroll becomes a stuttering one.
             */
            const layer = colour.current;
            if (!layer) return;
            layer.scrollTop = event.currentTarget.scrollTop;
            layer.scrollLeft = event.currentTarget.scrollLeft;
          }}
          spellCheck={format === 'markdown'}
          // Neither: source is code, and a machine guessing at the shape of
          // a LaTeX command or an HTML attribute gets it wrong every time.
          autoCorrect="off"
          autoCapitalize="off"
          className={[
            'absolute inset-0 resize-none bg-transparent focus:outline-none',
            SOURCE_TEXT,
            // Transparent text over the coloured copy, but a caret you can
            // still see — `caret-color` is what makes that possible at all.
            coloured ? 'text-transparent caret-grey-800' : 'text-grey-800',
          ].join(' ')}
        />
      </div>
        
    </>
  );

  if (failed) {
    return <p className="p-6 text-center text-[12px] text-stale">{failed}</p>;
  }

  if (loaded === null) {
    return <p className="p-6 text-center text-[12px] text-grey-400">Loading…</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-grey-200 bg-grey-50 px-3 py-1.5">
        {hasRenderedView(format) ? (
          <div className="flex shrink-0 overflow-hidden rounded-sm border border-grey-300">
            {/*
              Typeset is offered for LaTeX and nothing else, because it is the
              only format whose reading view is an approximation of something.
              Markdown and HTML have no separate truth to compare against — what
              the browser renders *is* the document.
            */}
            {(
              [
                'read',
                'source',
                /*
                 * Only where there is room. Two columns is the whole idea, and
                 * in the fourth column each half would be neither an editor nor
                 * a preview — offering it there and apologising with a media
                 * query would be worse than not offering it.
                 */
                ...(roomy ? (['split'] as const) : []),
                ...(format === 'latex' ? (['typeset'] as const) : []),
              ] as readonly ('read' | 'source' | 'split' | 'typeset')[]
            ).map((which) => (
              <button
                key={which}
                type="button"
                aria-pressed={view === which}
                onClick={() => {
                  setView(which);
                  // The pane caps a paged format at A4 plus a surround, which
                  // holds a page and cannot hold a page *and* an editor.
                  onFullWidth?.(which === 'split');
                }}
                className={[
                  'px-2 py-0.5 text-[11px]',
                  view === which
                    ? 'bg-grey-800 text-paper'
                    : 'bg-paper text-grey-600 hover:text-grey-900',
                ].join(' ')}
              >
                {which === 'read'
                  ? 'Reading'
                  : which === 'source'
                    ? 'Source'
                    : which === 'split'
                      ? 'Both'
                      : 'Typeset'}
              </button>
            ))}
          </div>
        ) : null}

        <span className="shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
          {FORMAT_META[format].label}
        </span>

        {/* The one thing about the LaTeX view a reader has to be told, said
            where they are looking rather than in a tooltip. */}
        {format === 'latex' && view === 'read' ? (
          <span className="text-[10px] text-grey-400">
            reading view —{' '}
            <button
              type="button"
              onClick={() => setView('typeset')}
              className="underline underline-offset-2 hover:text-grey-700"
            >
              Typeset
            </button>{' '}
            runs TeX
          </span>
        ) : null}

        <span className="min-w-0 flex-1" />

        {saveError ? (
          <span className="min-w-0 basis-full truncate text-[11px] text-stale" title={saveError}>
            {saveError}
          </span>
        ) : null}

        {view === 'read' ? (
          <button
            type="button"
            onClick={print}
            className="shrink-0 text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            Print / PDF
          </button>
        ) : null}

        <span className="shrink-0 text-[11px] tabular-nums text-grey-400">
          {saving
            ? 'Saving…'
            : dirty
              ? 'Unsaved'
              : savedAt
                ? 'Saved'
                : `${FORMAT_META[format].extension.toUpperCase()}`}
        </span>

        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="shrink-0 rounded-sm bg-grey-800 px-2 py-0.5 text-[11px] text-paper disabled:opacity-40"
        >
          Save
        </button>
      </div>

      {view === 'typeset' ? (
        /*
         * Mounted only while the tab is open, and given the *draft* — so what
         * is typeset is what you have written, saved or not, which is the whole
         * point of pressing it while editing.
         */
        <LatexPdf source={draft} src={src} />
      ) : view === 'read' ? (
        reading
      ) : view === 'split' ? (
        /*
         * Source on the left, the document on the right, each scrolling on its
         * own.
         *
         * The editor leads because that is the side you are working in and the
         * eye starts at the left — the preview is the answer, and an answer
         * belongs after the question. `min-w-0` on both, or one long unbroken
         * line in the source pushes its half wider and the two stop being
         * halves.
         */
        <div className="flex min-h-0 flex-1 divide-x divide-grey-200">
          <div className="flex min-h-0 w-1/2 min-w-0 flex-col">{editor}</div>
          <div className="flex min-h-0 w-1/2 min-w-0 flex-col">{reading}</div>
        </div>
      ) : (
        editor
      )}

      {printing ? (
        /*
         * The frame that does the printing, off screen rather than hidden.
         *
         * `display: none` would be the obvious way to keep it out of sight and
         * is the one thing that cannot work: a frame with no layout box has no
         * document to lay out, and printing it produces a blank page. So it is
         * given a real size — A4 at 96dpi, which is what the print engine will
         * be re-laying it out for anyway — and moved off the side.
         *
         * `allow-modals` is what permits the dialogue at all, and
         * `allow-scripts` is what lets it ask; the absence of
         * `allow-same-origin` is what keeps the origin opaque, so the file's
         * own markup still cannot reach anything of ours.
         */
        <iframe
          // Prefixed for the reason the reading frame above is: two sibling
          // counters that start in the same place will collide.
          key={`print-${printing.seq}`}
          sandbox="allow-modals allow-scripts"
          srcDoc={printing.html}
          title={`Printing ${name}`}
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed left-[-10000px] top-0 h-[1123px] w-[794px] border-0"
        />
      ) : null}
    </div>
  );
}
