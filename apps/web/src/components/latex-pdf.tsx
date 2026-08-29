'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The document as TeX makes it: pages, Computer Modern, the real thing.
 *
 * This is the answer to "the reading view is not Overleaf", and the only honest
 * one — Overleaf runs TeX, so this runs TeX. What comes back is a genuine PDF
 * with the page size, margins, fonts and packages the document asks for, shown
 * in the browser's own viewer.
 *
 * **It typesets when you ask, not as you type.** A compile is a second or two,
 * and the first one on a machine may install packages. Doing that on every
 * keystroke would be a worse editor and a great deal of wasted work.
 *
 * **Every build is kept, and that is what makes this work away from the desk.**
 * TeX runs on the machine serving the app, and a serverless host will never
 * have one — the distribution alone is hundreds of megabytes against a function
 * limit of 250. So rather than the feature simply being absent everywhere else,
 * the PDF is stored beside its source in Drive and any device can open it: the
 * phone gets the real document, built by real TeX, and is told when. What it
 * cannot do is make a new one, which is a much smaller thing to be told.
 *
 * A failed compile shows the log, because that is what you would read in
 * Overleaf too: TeX's own complaint about line 24 is nearly always more useful
 * than anything a wrapper could say about it. The errors are lifted to the top
 * and the whole log kept underneath.
 */

/** The lines worth reading first, out of a log that is mostly font loading. */
function complaints(log: string): string[] {
  const out: string[] = [];

  for (const line of log.split('\n')) {
    const trimmed = line.trimEnd();
    // `-file-line-error` puts the file and line in front, which is the half of
    // an error message that tells you where to look.
    if (/^[^\s:]+:\d+:/.test(trimmed) || trimmed.startsWith('!')) out.push(trimmed);
    else if (/^(LaTeX|Package|Class)\s+.*(Warning|Error)/.test(trimmed)) out.push(trimmed);

    if (out.length >= 12) break;
  }

  return out;
}

/**
 * Where a document's kept build lives, from where its bytes live.
 *
 * `…/file` and `…/typeset` are the same address with a different last segment,
 * on both sides of the app — which is the whole reason this component needs to
 * know nothing about attachments or boxes.
 */
function typesetUrl(src: string): string | null {
  return src.endsWith('/file') ? `${src.slice(0, -'/file'.length)}/typeset` : null;
}

/** When it was built, said the way a person would say it. */
function when(iso: string): string {
  const at = new Date(iso);
  const today = new Date().toDateString() === at.toDateString();

  return at.toLocaleString('en-GB', {
    day: today ? undefined : 'numeric',
    month: today ? undefined : 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type State =
  | { phase: 'idle' | 'working' }
  | { phase: 'done'; url: string; status: string | null; where: string | null }
  | { phase: 'failed'; error: string; log: string; missing: boolean };

export function LatexPdf({ source, src }: { source: string; src?: string }) {
  const [state, setState] = useState<State>({ phase: 'idle' });

  /** The build already stored for this document, if there is one. */
  const [kept, setKept] = useState<string | null>(null);

  /** What happened to *this* build on its way into Drive. */
  const [keeping, setKeeping] = useState<'saving' | 'failed' | null>(null);

  const url = useRef<string | null>(null);
  const store = src ? typesetUrl(src) : null;

  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  /*
   * Ask on open whether there is a build to offer. `?meta` rather than the PDF
   * itself: this runs whenever the tab is opened, and the answer is usually
   * "yes, from Tuesday" — which must not cost a document to find out.
   */
  useEffect(() => {
    if (!store) return;

    let live = true;

    void fetch(`${store}?meta`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { at?: string } | null) => {
        if (live && body?.at) setKept(body.at);
      })
      .catch(() => {
        // No build, or no answer. Either way there is nothing to offer, which
        // is the state this started in.
      });

    return () => {
      live = false;
    };
  }, [store]);

  /**
   * Keep this build, so the other devices can read it.
   *
   * Not awaited by the thing that shows the PDF: the document is already on
   * screen and this is about *later*. A failure is reported quietly beside the
   * date rather than as an error over the document, because the typesetting
   * worked — what failed is the copy for the phone.
   */
  const keep = async (pdf: Blob) => {
    if (!store) return;

    setKeeping('saving');

    try {
      const response = await fetch(store, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: pdf,
      });

      const body = (await response.json().catch(() => null)) as { at?: string } | null;

      if (!response.ok || !body?.at) {
        setKeeping('failed');
        return;
      }

      setKept(body.at);
      setKeeping(null);
    } catch {
      setKeeping('failed');
    }
  };

  /** Show the stored build. The endpoint is the source — no blob to revoke. */
  const showKept = () => {
    if (!store) return;

    if (url.current) {
      URL.revokeObjectURL(url.current);
      url.current = null;
    }

    setState({ phase: 'done', url: store, status: null, where: 'kept' });
  };

  const run = async () => {
    setState({ phase: 'working' });
    setKeeping(null);

    try {
      const response = await fetch('/api/latex/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: source,
      });

      if (url.current) {
        URL.revokeObjectURL(url.current);
        url.current = null;
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          log?: string;
          missing?: boolean;
        } | null;

        setState({
          phase: 'failed',
          error: body?.error ?? `The compile failed (${response.status}).`,
          log: body?.log ?? '',
          missing: Boolean(body?.missing),
        });
        return;
      }

      const pdf = await response.blob();
      const next = URL.createObjectURL(pdf);
      url.current = next;

      setState({
        phase: 'done',
        url: next,
        status: response.headers.get('X-Latex-Status'),
        where: response.headers.get('X-Latex-Where'),
      });

      void keep(pdf);
    } catch {
      setState({
        phase: 'failed',
        error: 'Could not reach the app.',
        log: '',
        missing: false,
      });
    }
  };

  /** The one control that is worth offering when TeX is not here. */
  const keptButton =
    kept && state.phase !== 'working' ? (
      <button
        type="button"
        onClick={showKept}
        className="rounded-sm border border-grey-300 px-2 py-0.5 text-[11px] text-grey-700 hover:bg-grey-200"
      >
        Open the last build · {when(kept)}
      </button>
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-grey-100">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-grey-200 bg-grey-50 px-3 py-1.5">
        <button
          type="button"
          onClick={() => void run()}
          disabled={state.phase === 'working'}
          className="rounded-sm bg-grey-800 px-2 py-0.5 text-[11px] text-paper disabled:opacity-40"
        >
          {state.phase === 'working'
            ? 'Typesetting…'
            : state.phase === 'idle'
              ? 'Typeset'
              : 'Typeset again'}
        </button>

        {keptButton}

        {state.phase === 'done' ? (
          <>
            <a
              href={state.url}
              download="document.pdf"
              className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
            >
              Save the PDF
            </a>
            {/* A non-zero exit with a PDF is the ordinary case for a document
                with a recoverable complaint — worth saying, not worth alarm. */}
            {state.status && state.status !== '0' ? (
              <span className="text-[10px] text-grey-400">
                TeX had complaints, but produced the document
              </span>
            ) : null}
            {/* Said plainly, because it means the document left this app. */}
            {state.where === 'remote' ? (
              <span className="text-[10px] text-grey-400">
                typeset by the service you configured
              </span>
            ) : null}
            {/* And said plainly here too, because what is on screen is not
                necessarily what the editor beside it now says. */}
            {state.where === 'kept' && kept ? (
              <span className="text-[10px] text-grey-400">
                built {when(kept)}, not from what is in the editor now
              </span>
            ) : null}
            {keeping === 'saving' ? (
              <span className="text-[10px] text-grey-400">keeping it…</span>
            ) : keeping === 'failed' ? (
              <span className="text-[10px] text-stale">
                kept nowhere — this build won&rsquo;t reach your other devices
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {state.phase === 'done' ? (
          /*
           * The browser's own PDF viewer, which already has pages, zoom, search
           * and printing. `object` rather than `iframe`, so a browser without
           * one falls through to the message instead of a blank rectangle.
           */
          <object data={state.url} type="application/pdf" className="h-full w-full">
            <p className="p-4 text-[12px] text-grey-500">
              This browser will not show a PDF inline.{' '}
              <a href={state.url} download="document.pdf" className="underline">
                Save it
              </a>{' '}
              instead.
            </p>
          </object>
        ) : state.phase === 'failed' ? (
          <div className="p-3">
            <p
              className={[
                'max-w-prose text-[12px] leading-relaxed',
                state.missing ? 'text-grey-600' : 'font-medium text-stale',
              ].join(' ')}
            >
              {state.error}
            </p>

            {/*
              The whole point of keeping builds. "No TeX here" is a dead end on
              a phone; "no TeX here, and here is the one from Tuesday" is the
              document, which is what you opened this for.
            */}
            {state.missing && kept ? (
              <p className="mt-2 max-w-prose text-[12px] leading-relaxed text-grey-600">
                The last build is still here, from {when(kept)} — open it above.
                It was made by TeX on the machine that has it, so it is the real
                document rather than an approximation.
              </p>
            ) : null}

            {complaints(state.log).length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {complaints(state.log).map((line, i) => (
                  <li
                    key={i}
                    className="whitespace-pre-wrap break-words font-mono text-[11px] text-grey-800"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}

            {state.log ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-grey-500">
                  The whole log
                </summary>
                <pre className="mt-1 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-paper p-2 font-mono text-[10.5px] leading-relaxed text-grey-600">
                  {state.log}
                </pre>
              </details>
            ) : null}
          </div>
        ) : (
          <div className="p-4">
            <p className="max-w-prose text-[12px] leading-relaxed text-grey-600">
              {state.phase === 'working'
                ? 'Running TeX. A first compile may install the packages your document asks for, which takes a moment longer.'
                : 'This runs TeX itself, so the page size, margins, fonts and packages are whatever your document says — not an approximation of them.'}
            </p>

            {state.phase === 'idle' ? (
              <p className="mt-2 max-w-prose text-[11px] leading-relaxed text-grey-500">
                It compiles on the machine serving the app, so it works wherever
                TeX is installed — and every build is kept, so the last one can
                be opened from anywhere. Reading view is always there and needs
                nothing.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
