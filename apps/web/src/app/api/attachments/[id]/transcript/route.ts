import { revalidatePath } from 'next/cache';
import { apiSession } from '@/lib/auth/session';
import {
  MAX_TRANSCRIPT_CHARS,
  readAttachmentTranscript,
  writeAttachmentTranscript,
} from '@/lib/transcripts';

export const dynamic = 'force-dynamic';

/**
 * An attachment's transcript: what you typed while listening to it.
 *
 * A route rather than a Server Action because the preview pane has to *read*
 * it. The pane is client state with no server component above it — the file it
 * shows was chosen by a click three panes away — so there is nowhere to render
 * the text from, and it has to be asked for.
 *
 * Fetching it on open is also what keeps transcripts out of every list
 * payload. They belong to the one file you are looking at; shipping them with
 * the rows would put an hour of speech into the props of a project pane that
 * only wanted a filename.
 *
 * `/transcript` beside `/file` on purpose: the bytes and the words about them
 * are two representations of one thing, addressed the same way on both sides
 * of the app.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await apiSession();
  if (denied) return denied;

  const { id } = await params;
  const text = await readAttachmentTranscript(id);

  if (text === null) {
    return Response.json({ error: 'No such attachment.' }, { status: 404 });
  }

  return Response.json({ text });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await apiSession();
  if (denied) return denied;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;

  if (typeof body?.text !== 'string') {
    return Response.json({ error: 'Expected { text: string }.' }, { status: 400 });
  }

  if (!(await writeAttachmentTranscript(id, body.text))) {
    return Response.json({ error: 'No such attachment.' }, { status: 404 });
  }

  // The transcript is in the search vector now, and a search page rendered
  // before this save would still be missing it.
  revalidatePath('/', 'layout');

  return Response.json({ ok: true, limit: MAX_TRANSCRIPT_CHARS });
}
