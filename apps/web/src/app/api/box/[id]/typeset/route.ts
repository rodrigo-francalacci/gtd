import { boxItems, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { saveTypeset, serveTypeset } from '@/lib/google/typeset-route';

export const dynamic = 'force-dynamic';

/**
 * The PDF a Big Box document was last typeset into.
 *
 * The mirror of the attachment route beside it — one address shape on both
 * sides of the app, so the preview pane never has to know which table it is
 * looking at.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [row] = await db
    .select({ name: boxItems.name, title: boxItems.title })
    .from(boxItems)
    .where(eq(boxItems.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'No such document.' }, { status: 404 });
  }

  // The title if it has been read and titled, the filename otherwise — the
  // same order `driveNameFor` uses, so a saved PDF is called what the document
  // is called.
  return serveTypeset(request, 'box', id, row.title || row.name || 'document');
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return saveTypeset(request, 'box', id);
}
