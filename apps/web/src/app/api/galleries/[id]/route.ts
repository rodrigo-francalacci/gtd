import { NextResponse } from 'next/server';
import { apiSession } from '@/lib/auth/session';
import { getGalleryPictures } from '@/lib/google/galleries';

export const dynamic = 'force-dynamic';

/**
 * What is in a gallery.
 *
 * A route rather than props, for the reason transcripts are one: the preview
 * pane is client state with no server component above it — the thing it shows
 * was chosen by a click three panes away — so there is nowhere to render this
 * from and it has to be asked for.
 *
 * Asking on open is also what keeps forty photographs' worth of metadata out of
 * the props of every project pane that merely *has* a gallery on it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await apiSession();
  if (denied) return denied;

  const { id } = await params;
  const pictures = await getGalleryPictures(id);

  return NextResponse.json({
    pictures: pictures.map((picture) => ({
      id: picture.id,
      name: picture.name,
      mimeType: picture.mimeType,
      sizeBytes: picture.sizeBytes,
      width: picture.width,
      height: picture.height,
      takenAt: picture.takenAt?.toISOString() ?? null,
      latitude: picture.latitude,
      longitude: picture.longitude,
      addedAt: picture.createdAt.toISOString(),
    })),
  });
}
