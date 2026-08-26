import 'server-only';

import { revalidatePath } from 'next/cache';
import { apiSession } from '@/lib/auth/session';
import { GoogleAuthError } from '@/lib/auth/token';
import { GoogleApiError } from './client';
import { MAX_TEXT_BYTES, TextSaveError } from './text-files';

/**
 * The half of a text save that is the same on both sides of the app.
 *
 * `PUT …/file` writes the bytes that `GET …/file` reads, on an attachment and
 * on a Big Box document alike — the same symmetry `/transcript` already has
 * beside it. Everything except *which table holds the id* is identical, so it
 * lives here and the two route files are a lookup and a call.
 *
 * The body is the text itself rather than JSON wrapping it. `GET` hands back a
 * file; `PUT` takes one. Wrapping it would mean escaping a whole document into
 * a string to send it and unescaping it on arrival, for no gain.
 */
export async function saveTextRoute(
  request: Request,
  save: (text: string) => Promise<{ name: string; bytes: number } | null>,
  missing: string,
): Promise<Response> {
  const denied = await apiSession();
  if (denied) return denied;

  const text = await request.text();

  if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    return Response.json(
      {
        error: `That document is over ${Math.round(MAX_TEXT_BYTES / 1024 / 1024)} MB, which is more text than this can save in one request.`,
      },
      { status: 413 },
    );
  }

  try {
    const saved = await save(text);
    if (!saved) return Response.json({ error: missing }, { status: 404 });

    /*
     * The size shown beside the file has changed, and so has what search can
     * find inside it. Both are rendered by panes several route segments away
     * from here, and neither would refresh on its own.
     */
    revalidatePath('/', 'layout');

    return Response.json({ ok: true, bytes: saved.bytes });
  } catch (error) {
    /*
     * Three failures with three remedies, so they get three sentences. A
     * withdrawn Google grant is fixed on one page and is not the file's fault;
     * a file this app did not create is refused by the narrow scope and never
     * will not be; anything else is worth reporting as itself rather than as a
     * blank five hundred, because the person seeing it is holding unsaved work.
     */
    if (error instanceof GoogleAuthError) {
      return Response.json(
        {
          error:
            'Google has disconnected. Reconnect it on the Google page, then save again — your text is still in the editor.',
          reconnect: true,
        },
        { status: 401 },
      );
    }

    if (error instanceof TextSaveError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof GoogleApiError) {
      return Response.json(
        {
          error:
            error.status === 404
              ? 'Drive has no such file. It may have been deleted there.'
              : `Drive refused the save (${error.status}).`,
        },
        { status: 502 },
      );
    }

    throw error;
  }
}
