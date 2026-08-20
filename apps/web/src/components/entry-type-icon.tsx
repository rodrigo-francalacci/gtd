'use client';

import { ENTRY_TYPE_LABELS, entryTypeOf, type EntryType } from '@/lib/queries.shared';
import type { BoxItemKind } from '@gtd/db';
import {
  IconArchive2,
  IconAudio,
  IconDocument,
  IconImage,
  IconLink,
  IconNote,
  IconPlace,
  IconSheet,
  IconVideo,
} from './icons';

const GLYPHS: Record<EntryType, typeof IconDocument> = {
  note: IconNote,
  link: IconLink,
  location: IconPlace,
  image: IconImage,
  audio: IconAudio,
  video: IconVideo,
  pdf: IconDocument,
  document: IconDocument,
  sheet: IconSheet,
  text: IconNote,
  archive: IconArchive2,
  other: IconDocument,
};

/**
 * What sort of thing this is, in one glyph.
 *
 * The titles-only view drops everything a row can say except its name, which
 * is the point — but a name alone cannot tell you a recording from a receipt,
 * and those are read completely differently. One monochrome mark restores that
 * without bringing the metadata back.
 *
 * A PDF and a Word file share a glyph deliberately: at 14px the difference
 * would be noise, and both are "a document" as far as deciding whether to open
 * one goes. The `title` says which, for when it matters.
 */
export function EntryTypeIcon({
  item,
}: {
  item: { kind: BoxItemKind; mimeType: string | null };
}) {
  const type = entryTypeOf(item);
  const Glyph = GLYPHS[type];

  return (
    <span
      className="shrink-0 text-grey-400"
      title={ENTRY_TYPE_LABELS[type]}
      aria-label={ENTRY_TYPE_LABELS[type]}
    >
      <Glyph />
    </span>
  );
}
