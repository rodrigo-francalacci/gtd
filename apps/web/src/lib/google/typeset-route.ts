import 'server-only';

import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/session';
import { serveDriveFile } from './serve';
import { readTypeset, writeTypeset, type TypesetSide } from './typeset';

/**
 * `…/typeset` beside `…/file` and `…/transcript`.
 *
 * The third representation of one document: the bytes, the words in it, and the
 * thing TeX makes of it. Addressed the same way on both sides of the app, so
 * the preview pane stays ignorant of whether a file came from an attachment or
 * a Big Box document — it knows a URL ending in `/file` and can reach the rest
 * from there.
 *
 * A route rather than a Server Action for the reason `/transcript` is one: the
 * pane is client state with no server component above it, so there is nowhere
 * to render this from and it has to be asked for.
 *
 * One address answers two questions, and the query says which: `?meta` is "is
 * there a build, and how old", which is what a pane asks on open and must not
 * cost a PDF; without it you get the document.
 */

/** Big enough for any real document, small enough not to be a way in. */
const MAX_PDF_BYTES = 32 * 1024 * 1024;

export async function serveTypeset(
  request: Request,
  side: TypesetSide,
  id: string,
  name: string,
) {
  const denied = await apiSession();
  if (denied) return denied;

  const build = await readTypeset(side, id);

  if (!build) {
    return NextResponse.json({ error: 'This has never been typeset.' }, { status: 404 });
  }

  if (new URL(request.url).searchParams.has('meta')) {
    return NextResponse.json({ at: build.at.toISOString() });
  }

  const response = await serveDriveFile(
    {
      driveFileId: build.fileId,
      name: `${name.replace(/\.[a-z0-9]+$/i, '')}.pdf`,
      mimeType: 'application/pdf',
    },
    request,
  );

  // So a pane showing the document can also say when it was made, without
  // asking a second time for something it has just been given.
  response.headers.set('X-Typeset-At', build.at.toISOString());

  return response;
}

export async function saveTypeset(request: Request, side: TypesetSide, id: string) {
  const denied = await apiSession();
  if (denied) return denied;

  const bytes = await request.arrayBuffer();

  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: 'Expected a PDF.' }, { status: 400 });
  }

  if (bytes.byteLength > MAX_PDF_BYTES) {
    return NextResponse.json({ error: 'That PDF is too large.' }, { status: 413 });
  }

  /*
   * The four bytes every PDF starts with. Not a security control — the session
   * is that — but a guard against storing something that is not a document at
   * all, which would be discovered only on a phone, later, with no way to tell
   * whether the build or the storing had gone wrong.
   */
  const head = new TextDecoder().decode(bytes.slice(0, 5));

  if (!head.startsWith('%PDF-')) {
    return NextResponse.json({ error: 'That is not a PDF.' }, { status: 400 });
  }

  const build = await writeTypeset(side, id, bytes);

  if (!build) {
    return NextResponse.json(
      { error: 'There is nowhere to keep it — this document has no Drive file.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ at: build.at.toISOString() });
}
