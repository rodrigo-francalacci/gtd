import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import type { AttachmentParentType } from '@gtd/db';
import { apiSession } from '@/lib/auth/session';
import { AttachmentError, completeUpload } from '@/lib/google/attachments';
import type { MediaFacts } from '@/lib/media-facts';
import { PARENT_TYPES } from '@/lib/upload';

export const dynamic = 'force-dynamic';

/**
 * What the browser says the picture is, taken by name and by type.
 *
 * Every field is optional and every field is checked, because this arrives as
 * JSON from a page: a latitude of "north-ish" or a width of a million must not
 * reach the column. Nothing here is a security boundary — the numbers only
 * caption a picture you are already looking at — but a row that cannot be
 * rendered is still a row that breaks a pane.
 */
function readFacts(raw: unknown): MediaFacts | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const source = raw as Record<string, unknown>;
  const facts: MediaFacts = {};

  const pixels = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 200_000
      ? value
      : undefined;

  facts.width = pixels(source.width);
  facts.height = pixels(source.height);

  if (typeof source.takenAt === 'string') {
    const when = new Date(source.takenAt);
    // A camera with a flat clock reports 1970, and a mis-parsed tag can report
    // the year 40,000. Neither is a date worth showing under a photograph.
    const year = when.getFullYear();
    if (!Number.isNaN(when.getTime()) && year > 1900 && year < 2200) {
      facts.takenAt = when.toISOString();
    }
  }

  const degrees = (value: unknown, limit: number) =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
      ? value
      : undefined;

  const latitude = degrees(source.latitude, 90);
  const longitude = degrees(source.longitude, 180);

  // Both or neither: half a coordinate is not a place.
  if (latitude !== undefined && longitude !== undefined) {
    facts.latitude = latitude;
    facts.longitude = longitude;
  }

  return facts;
}

/**
 * Record a file the browser has finished uploading.
 *
 * Takes an id and nothing else worth trusting: the name, type and size are
 * read back from Drive, so the row cannot disagree with the file.
 */
export async function POST(request: Request) {
  const denied = await apiSession();
  if (denied) return denied;

  const { parentType, parentId, driveFileId, facts } = (await request
    .json()
    .catch(() => ({}))) as Partial<{
    parentType: string;
    parentId: string;
    driveFileId: string;
    facts: Record<string, unknown>;
  }>;

  if (
    !PARENT_TYPES.includes(parentType as AttachmentParentType) ||
    !parentId ||
    !driveFileId
  ) {
    return NextResponse.json({ error: 'Bad attachment target.' }, { status: 400 });
  }

  try {
    const attachment = await completeUpload(
      parentType as AttachmentParentType,
      parentId,
      driveFileId,
      readFacts(facts),
    );

    revalidatePath('/', 'layout');
    return NextResponse.json({ ok: true, ...attachment });
  } catch (error) {
    if (error instanceof AttachmentError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('could not record an uploaded attachment', error);
    return NextResponse.json(
      { error: 'The file uploaded but could not be recorded.' },
      { status: 502 },
    );
  }
}
