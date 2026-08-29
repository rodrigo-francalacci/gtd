import { attachments, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { saveTypeset, serveTypeset } from '@/lib/google/typeset-route';

export const dynamic = 'force-dynamic';

/**
 * The PDF an attachment was last typeset into.
 *
 * See `lib/google/typeset.ts` for why this is kept at all: TeX runs on the
 * machine serving the app and a serverless host will never have one, so the
 * build is stored and every other device reads it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [row] = await db
    .select({ name: attachments.name })
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'No such attachment.' }, { status: 404 });
  }

  return serveTypeset(request, 'attachment', id, row.name);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return saveTypeset(request, 'attachment', id);
}
