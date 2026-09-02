import { attachments, boxItems, db } from '@gtd/db';
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { isFetchableUrl } from '@/lib/box/link';
import { GoogleAuthError } from '@/lib/auth/token';
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
/**
 * The Drive file of a gallery's first picture, or null while it is still empty.
 *
 * Its members are ordinary attachments parented on the gallery's id, so this is
 * the same ordering the album uses — `created_at` then id, because two files
 * uploaded in the same second still have to come back in a fixed order or the
 * cover would wander between requests.
 */
async function galleryCover(galleryId: string): Promise<string | null> {
  const [first] = await db
    .select({ driveFileId: attachments.driveFileId })
    .from(attachments)
    .where(and(eq(attachments.parentType, 'gallery'), eq(attachments.parentId, galleryId)))
    .orderBy(asc(attachments.createdAt), asc(attachments.id))
    .limit(1);

  return first?.driveFileId ?? null;
}

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
    .select({
      driveFileId: boxItems.driveFileId,
      imageUrl: boxItems.imageUrl,
      kind: boxItems.kind,
    })
    .from(boxItems)
    .where(eq(boxItems.id, id))
    .limit(1);

  /**
   * A gallery's picture is the first picture in it.
   *
   * Its own `drive_file_id` is a *folder*, and a folder has no thumbnail — so
   * without this a gallery is the one entry in a feed of pictures that shows
   * no picture, which is the wrong way round: it is the entry with the most of
   * them.
   *
   * The first rather than a montage, and the first *by arrival*, which is the
   * order the album reads in. It is the one you would describe the set by, and
   * it stays put as more are added — a cover that changed every time you added
   * a photograph would make the same row look like a different one each week.
   */
  const cover = row?.kind === 'gallery' ? await galleryCover(id) : null;

  if (row?.kind === 'gallery' && !cover) {
    return NextResponse.json({ error: 'Nothing in that gallery yet.' }, { status: 404 });
  }

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

  const sourceId = cover ?? row?.driveFileId;

  if (!sourceId) {
    return NextResponse.json({ error: 'No such document.' }, { status: 404 });
  }

  /*
   * A disconnected Google is answered the same way a missing thumbnail is.
   *
   * Uncaught, it was a bare 500 with an empty body — and a feed in gallery view
   * is a hundred of those at once, every card a broken image, with nothing on
   * the page saying why. The fallback this route already designed for is
   * exactly right for it: no picture, so show the icon. A whole box of icons
   * is a box you can still read.
   *
   * The reconnect message belongs where somebody can act on it — the file
   * route, and the Google page — not in an `<img>`, which can do nothing with
   * a sentence.
   */
  const file = await getFile(sourceId).catch((error) => {
    if (error instanceof GoogleAuthError) return null;
    throw error;
  });

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
