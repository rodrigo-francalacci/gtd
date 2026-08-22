import { revalidatePath } from 'next/cache';
import { apiSession } from '@/lib/auth/session';
import {
  MAX_TRANSCRIPT_CHARS,
  readBoxTranscript,
  writeBoxTranscript,
} from '@/lib/transcripts';

export const dynamic = 'force-dynamic';

/**
 * A Big Box entry's transcript. Same contract and same reasoning as an
 * attachment's — only the table differs, exactly as with the file route beside
 * it.
 *
 * This is the side that makes a spoken note worth keeping. A recording filed
 * in a box is written straight to `ready` because nothing can read it, so
 * until now it was the one entry with no title, no summary and nothing for
 * search to match — findable only by remembering roughly when you said it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await apiSession();
  if (denied) return denied;

  const { id } = await params;
  const text = await readBoxTranscript(id);

  if (text === null) {
    return Response.json({ error: 'No such document.' }, { status: 404 });
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

  if (!(await writeBoxTranscript(id, body.text))) {
    return Response.json({ error: 'No such document.' }, { status: 404 });
  }

  revalidatePath('/', 'layout');

  return Response.json({ ok: true, limit: MAX_TRANSCRIPT_CHARS });
}
