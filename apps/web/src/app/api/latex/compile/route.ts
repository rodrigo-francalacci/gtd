import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
/** A first compile installs packages on demand and can take a while. */
export const maxDuration = 120;

/**
 * Typeset a LaTeX document, properly.
 *
 * The reading view beside this answers *what does this file say*. This answers
 * *what does it look like*, and there is only one honest way to do that: run
 * TeX. Everything else was tried first and measured — the browser engines all
 * need a TeX Live tree, the smallest useful slice of one is about 120 MB, and
 * upstream ships it only as a single 498 MB tarball. A `multirow` in a document
 * pulls in the 326 MB "extra" set on its own.
 *
 * A local `pdflatex` has none of those problems and one of its own: it has to
 * exist. On a machine with MiKTeX or TeX Live this compiles the real thing,
 * fonts and packages and all, and installs what a document asks for. On Vercel
 * there is no TeX and there cannot be one, so this answers plainly instead of
 * failing in a way that looks like a bug.
 *
 * `LATEX_COMMAND` names the binary, so the same route serves `pdflatex`,
 * `latexmk` or a wrapper that shells into a container — whichever is to hand.
 */

const COMMAND = process.env.LATEX_COMMAND ?? 'pdflatex';

/**
 * Somewhere else that will typeset, for where there is no TeX.
 *
 * A deployed function cannot hold a TeX distribution — that is the whole reason
 * this runs locally — so the only way to typeset from a phone or from Vercel is
 * to send the document to a machine that can. That is a decision about *your
 * document leaving this app*, so it is opt-in and unset by default: nothing is
 * ever posted anywhere unless this names a destination.
 *
 * It can be a service, or your own desktop exposed to the network — the second
 * keeps the document on hardware you own, and is the reason this is a URL rather
 * than a provider.
 *
 * The contract is deliberately the same as this route's own: POST the source as
 * `text/plain`, get back `application/pdf` or an error. Local first, always;
 * this is the fallback, not the preference.
 */
const REMOTE = process.env.LATEX_REMOTE_URL?.trim();

/** Ask another machine to do it. */
async function typesetRemotely(source: string): Promise<Response> {
  const upstream = await fetch(REMOTE!, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: source,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const type = upstream.headers.get('content-type') ?? '';

  if (upstream.ok && type.includes('pdf')) {
    return new NextResponse(await upstream.arrayBuffer(), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="document.pdf"',
        'Cache-Control': 'private, no-store',
        'X-Latex-Status': '0',
        // So the pane can say where it was built, which matters when the answer
        // came from a machine that is not this one.
        'X-Latex-Where': 'remote',
      },
    });
  }

  return NextResponse.json(
    {
      error: `The typesetting service answered ${upstream.status}.`,
      log: (await upstream.text()).slice(0, 20_000),
    },
    { status: 502 },
  );
}

/** Long enough for a first run that fetches packages, short of a hung one. */
const TIMEOUT_MS = 90_000;

/** A document that is not a document. */
const MAX_SOURCE = 400_000;

/**
 * File-reading commands aimed outside the working directory.
 *
 * **This is a guard, not a sandbox, and the difference matters.**
 * `-no-shell-escape` genuinely stops a document running commands — measured:
 * a `\write18` asked to create a file created nothing. Reading is the weaker
 * half. TeX's own `openin_any=p` is set below and *MiKTeX ignores it* — also
 * measured, by compiling a document that reported `C:/Windows/win.ini` as
 * readable. So a document can otherwise open any file the server process can,
 * and put its contents in the PDF that comes back.
 *
 * For a single-user app compiling your own documents that is close to attacking
 * yourself. The case it is worth anything for is the other one: a `.tex` that
 * arrived — emailed, downloaded, filed in a box — and is typeset without being
 * read first.
 *
 * A string match is refusable rather than airtight: TeX has several ways to open
 * a file and macros can build a path a character at a time. It stops the obvious
 * attempt and it is honest about being a speed bump. The way to close it
 * properly is a machine setting — on MiKTeX, `AllowUnsafeInputFiles=false` — or
 * a container, and neither belongs in this route.
 */
/*
 * Longest names first, which is not cosmetic: alternation is ordered, so with
 * `include` ahead of `includegraphics` the shorter one matched and left
 * "graphics{C:/x.png}" as the path — which starts with a letter, looks
 * relative, and sailed through. Caught by testing the six shapes rather than
 * the one.
 */
const READS_A_FILE = new RegExp(
  String.raw`\\(?:InputIfFileExists|lstinputlisting|includegraphics|verbatiminput|IfFileExists|subimport|include|import|input|openin)\s*(?:\[[^\]]*\])?\s*\{?\s*([^}\s]+)`,
  'g',
);

function readsOutside(source: string): string | null {
  for (const match of source.matchAll(READS_A_FILE)) {
    const path = match[1];

    // An absolute path, a drive letter, a UNC share, or a climb upwards.
    if (
      /^[/\\]/.test(path) ||
      /^[a-zA-Z]:/.test(path) ||
      path.split(/[/\\]/).includes('..')
    ) {
      return path;
    }
  }

  return null;
}

type Run = { code: number | null; log: string; timedOut: boolean; missing: boolean };

function run(cwd: string): Promise<Run> {
  return new Promise((resolve) => {
    /*
     * `-no-shell-escape` is the one flag that is not optional. Without it a
     * document can run arbitrary commands through `\write18`, and this route
     * accepts a document from a browser. `openin_any=p` and `openout_any=p` are
     * the same argument for the filesystem: paranoid mode keeps TeX from
     * reading outside its working directory, so `\input{/etc/passwd}` gets
     * nothing.
     */
    const child = spawn(
      COMMAND,
      [
        '-interaction=nonstopmode',
        '-no-shell-escape',
        '-file-line-error',
        'main.tex',
      ],
      {
        cwd,
        env: { ...process.env, openin_any: 'p', openout_any: 'p', TEXMFOUTPUT: cwd },
        windowsHide: true,
      },
    );

    let log = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      // Bounded: a runaway document can produce megabytes of log, and none of
      // it past the first error is worth holding in memory.
      if (log.length < 500_000) log += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      if (log.length < 500_000) log += chunk.toString();
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: null, log: error.message, timedOut, missing: error.code === 'ENOENT' });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, log, timedOut, missing: false });
    });
  });
}

export async function POST(request: Request) {
  const unauthorised = await apiSession();
  if (unauthorised) return unauthorised;

  const source = await request.text();

  if (!source.trim()) {
    return NextResponse.json({ error: 'Nothing to typeset.' }, { status: 400 });
  }

  if (source.length > MAX_SOURCE) {
    return NextResponse.json(
      { error: 'That document is too large to typeset here.' },
      { status: 413 },
    );
  }

  const outside = readsOutside(source);
  if (outside) {
    return NextResponse.json(
      {
        error:
          `That document reads ${outside}, which is outside its own folder. ` +
          'Typesetting runs on the machine serving the app, so a document is ' +
          'only allowed to open files beside it.',
      },
      { status: 400 },
    );
  }

  const dir = await mkdtemp(join(tmpdir(), 'gtd-tex-'));

  try {
    await writeFile(join(dir, 'main.tex'), source, 'utf8');

    /*
     * Twice, when the first pass asks for it.
     *
     * A `\tableofcontents`, a `\ref` or a `\label` is only right on the second
     * run — the first writes the `.aux` the second reads. Running twice always
     * would double the wait for the documents that need it least, so the log is
     * asked: TeX says so itself.
     */
    let result = await run(dir);

    if (
      !result.missing &&
      !result.timedOut &&
      /Rerun to get|Label\(s\) may have changed/i.test(result.log)
    ) {
      result = await run(dir);
    }

    /*
     * No TeX here — so ask elsewhere, if elsewhere has been named.
     *
     * This is the deployed case. A Vercel function cannot hold a TeX
     * distribution, so the choice is a machine that can or nothing, and which
     * machine is the user's to pick rather than this route's to assume.
     */
    if (result.missing && REMOTE) {
      try {
        return await typesetRemotely(source);
      } catch (error) {
        return NextResponse.json(
          {
            error:
              'The typesetting service could not be reached. ' +
              (error instanceof Error ? error.message : ''),
          },
          { status: 502 },
        );
      }
    }

    if (result.missing) {
      return NextResponse.json(
        {
          error:
            `No LaTeX on this machine. Typesetting runs \`${COMMAND}\` where the ` +
            'app is served, so it works on a desktop with MiKTeX or TeX Live and ' +
            'not on a deployment, which cannot hold a TeX distribution. Either ' +
            'open this from the machine that has TeX, or set LATEX_REMOTE_URL to ' +
            'a service that will typeset for you — bearing in mind the document ' +
            'then leaves this app.',
          missing: true,
        },
        { status: 501 },
      );
    }

    if (result.timedOut) {
      return NextResponse.json(
        { error: 'That took too long and was stopped.', log: result.log },
        { status: 504 },
      );
    }

    let pdf: Buffer | null = null;
    try {
      pdf = await readFile(join(dir, 'main.pdf'));
    } catch {
      pdf = null;
    }

    /*
     * A PDF *and* a non-zero exit is the ordinary case for a document with a
     * recoverable complaint in it, and the PDF is what you asked for — so it is
     * returned, and the log goes in a header for the pane to mention. Only a
     * missing PDF is a failure.
     */
    if (!pdf || pdf.length === 0) {
      return NextResponse.json(
        { error: 'pdfTeX produced no document.', log: result.log },
        { status: 422 },
      );
    }

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="document.pdf"',
        // One person's document behind one person's session must never sit in a
        // shared cache — the same rule the attachment proxy follows.
        'Cache-Control': 'private, no-store',
        'X-Latex-Status': String(result.code ?? 0),
      },
    });
  } finally {
    // The directory holds the document; it goes whatever happened.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
