'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FORMAT_META,
  hasRenderedView,
  printableDocument,
  renderDocument,
  type TextFormat,
} from '@/lib/text-formats';

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
}: {
  /** Where the bytes are — and, on `PUT`, where they go back to. */
  src: string;
  format: TextFormat;
  name: string;
}) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState<string | null>(null);

  const [view, setView] = useState<'read' | 'source'>(
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
    if (view !== 'read' || loaded === null) return;

    let live = true;

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

    return () => {
      live = false;
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

  const print = () => {
    if (!page) return;

    setPrinting((previous) => ({
      html: printableDocument(page.html),
      seq: (previous?.seq ?? 0) + 1,
    }));
  };

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
            {(['read', 'source'] as const).map((which) => (
              <button
                key={which}
                type="button"
                aria-pressed={view === which}
                onClick={() => setView(which)}
                className={[
                  'px-2 py-0.5 text-[11px]',
                  view === which
                    ? 'bg-grey-800 text-paper'
                    : 'bg-paper text-grey-600 hover:text-grey-900',
                ].join(' ')}
              >
                {which === 'read' ? 'Reading' : 'Source'}
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
            reading view · not TeX typesetting
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

      {view === 'read' ? (
        <iframe
          key={page?.seq ?? 0}
          // `sandbox=""` — no permissions at all. Scripts, forms, popups and
          // top-level navigation are all denied and the frame gets an opaque
          // origin, which is what makes showing an arbitrary HTML file safe
          // without editing it first.
          sandbox=""
          srcDoc={page?.html ?? ''}
          title={name}
          className="min-h-0 w-full flex-1 border-0 bg-paper"
        />
      ) : (
        <textarea
          ref={area}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={format === 'markdown'}
          // Neither: source is code, and a machine guessing at the shape of a
          // LaTeX command or an HTML attribute gets it wrong every time.
          autoCorrect="off"
          autoCapitalize="off"
          /* 16px, or iOS Safari zooms the page in when it takes focus. The
             editor is one of the few places in the app you type at length on a
             phone, so this is the case the rule was written for. */
          className="min-h-0 w-full flex-1 resize-none whitespace-pre bg-paper p-3 font-mono text-[16px] leading-relaxed text-grey-800 focus:outline-none md:text-[12.5px]"
        />
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
          key={printing.seq}
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
