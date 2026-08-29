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

type State =
  | { phase: 'idle' | 'working' }
  | { phase: 'done'; url: string; status: string | null }
  | { phase: 'failed'; error: string; log: string; missing: boolean };

export function LatexPdf({ source }: { source: string }) {
  const [state, setState] = useState<State>({ phase: 'idle' });
  const url = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  const run = async () => {
    setState({ phase: 'working' });

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

      const next = URL.createObjectURL(await response.blob());
      url.current = next;
      setState({ phase: 'done', url: next, status: response.headers.get('X-Latex-Status') });
    } catch {
      setState({
        phase: 'failed',
        error: 'Could not reach the app.',
        log: '',
        missing: false,
      });
    }
  };

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
                TeX is installed. Reading view is always there and needs nothing.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
