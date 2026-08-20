import { boxItems, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { isFetchableUrl } from '@/lib/box/link';
import { getFile } from '@/lib/google/client';

export const dynamic = 'force-dynamic';

/**
 * Drive's own rendering of a document, for the gallery.
 *
 * Worth having because a scan is recognised by its shape — the letterhead, the
 * long thin till receipt, the two-column bill — long before its title is read.
 * Drive renders the first page of a PDF for us, which is not something this app
 * could do for itself without a PDF engine it has no other use for.
 *
 * Proxied rather than linked. `thumbnailLink` is a signed URL that expires
 * within hours, so it cannot be stored in a row or sent to a page that might
 * sit open; it is fetched fresh each time and the bytes come through us, on
 * our own origin, `private` like every other file this app serves.
 *
 * `size` is a hint, not a promise: Drive takes it as the longest edge and
 * returns what it has. Requesting one size for every card means the browser
 * caches one image per document rather than one per layout.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireSession();

  const { id } = await params;
  const requested = Number(new URL(request.url).searchParams.get('size'));
  const size = Number.isFinite(requested)
    ? Math.min(1600, Math.max(64, Math.round(requested)))
    : 400;

  const [row] = await db
    .select({ driveFileId: boxItems.driveFileId, imageUrl: boxItems.imageUrl })
    .from(boxItems)
    .where(eq(boxItems.id, id))
    .limit(1);

  /**
   * A link's preview comes from the page, and still comes through us.
   *
   * Pointing the browser straight at the remote image would tell that host who
   * is reading, and when, every time the feed is scrolled — and it would leak
   * through a page that is otherwise entirely first-party. Proxying costs a
   * round trip and buys that back.
   */
  if (row?.imageUrl) {
    if (!isFetchableUrl(row.imageUrl)) {
      return NextResponse.json({ error: 'No thumbnail.' }, { status: 404 });
    }

    const remote = await fetch(row.imageUrl, {
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);

    if (!remote?.ok || !(remote.headers.get('content-type') ?? '').startsWith('image/')) {
      return NextResponse.json({ error: 'No thumbnail.' }, { status: 404 });
    }

    const bytes = await remote.arrayBuffer();
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': remote.headers.get('content-type') ?? 'image/jpeg',
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, max-age=86400',
      },
    });
  }

  if (!row?.driveFileId) {
    return NextResponse.json({ error: 'No such document.' }, { status: 404 });
  }

  const file = await getFile(row.driveFileId);

  // Not every file has one — a plain text file, or a scan Drive hasn't got
  // round to rendering yet. 404 so the card falls back to its icon instead of
  // showing a broken image.
  if (!file?.thumbnailLink) {
    return NextResponse.json({ error: 'No thumbnail.' }, { status: 404 });
  }

  // Drive encodes the size in the URL's suffix rather than a query parameter.
  const url = file.thumbnailLink.replace(/=s\d+(-c)?$/, `=s${size}`);
  const upstream = await fetch(url);

  if (!upstream.ok) {
    return NextResponse.json({ error: 'No thumbnail.' }, { status: 404 });
  }

  const body = await upstream.arrayBuffer();

  return new NextResponse(body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/png',
      'Content-Length': String(body.byteLength),
      // A day is safe: the underlying document doesn't change — this app never
      // edits the bytes it filed — and re-rendering a scan on every scroll
      // would be a Drive round trip per card.
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
