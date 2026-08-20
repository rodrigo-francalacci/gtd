import type {
  ActionStatus,
  AttachmentKind,
  AttachmentParentType,
  BoxItemKind,
  BoxItemStatus,
  ProjectStatus,
} from '@gtd/db';

/**
 * Types and pure helpers shared by server queries and client components.
 * Kept out of `queries.ts` because that module is `server-only` — importing it
 * from a Client Component would be a build error.
 */

export type ActionRow = {
  id: string;
  title: string;
  status: ActionStatus;
  waitingSince: string | null;
  /** Who or what you're waiting on — null when unrecorded. */
  waitingOn: string | null;
  projectId: string | null;
  projectTitle: string | null;
  position: number | null;
  contexts: { id: string; name: string; dimension: string }[];
};

/** Days after which a waiting-for item is considered stale. */
export const WAITING_STALE_DAYS = 14;

export function daysSince(date: string | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 864e5);
}

export function isStale(waitingSince: string | null): boolean {
  const days = daysSince(waitingSince);
  return days !== null && days >= WAITING_STALE_DAYS;
}

export type ProjectRow = {
  id: string;
  title: string;
  status: ProjectStatus;
  standbyReason: string | null;
  areaId: string | null;
  goalId: string | null;
  areaName: string | null;
  lastReviewedAt: Date | null;
  nextActionCount: number;
  waitingCount: number;
};

/**
 * An active project with no next action is stalled. Derived, never stored, so
 * it cannot drift out of sync with the actions themselves.
 */
export function isStalled(p: Pick<ProjectRow, 'status' | 'nextActionCount'>): boolean {
  return p.status === 'active' && p.nextActionCount === 0;
}

export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  'active',
  'standby',
  'someday',
  'completed',
  'dropped',
];

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type PurchaseImpact = 'blocks' | 'improves' | 'nice_to_have';
export type PurchaseWhere = 'online' | 'in_town';

export type PurchaseFields = {
  cost?: number;
  impact?: PurchaseImpact;
  where?: PurchaseWhere;
};

export const IMPACT_LABELS: Record<PurchaseImpact, string> = {
  blocks: 'Blocks a project',
  improves: 'Improves things',
  nice_to_have: 'Nice to have',
};

export const IMPACT_SHORT: Record<PurchaseImpact, string> = {
  blocks: 'blocks',
  improves: 'improves',
  nice_to_have: 'nice to have',
};

export const WHERE_LABELS: Record<PurchaseWhere, string> = {
  online: 'Online',
  in_town: 'In town',
};

/**
 * Where a list item sits on the candidate → commitment path.
 *
 * The three are disjoint by construction, which is what stops the budget
 * double-counting: an item is in exactly one bucket at any moment.
 *
 *  - `candidate` — never promoted. Proposed spend.
 *  - `committed` — promoted and the resulting action is still open. The brief's
 *    case is an item that has been ordered and now lives in Waiting For.
 *  - `settled`   — the promoted action is done. Money already spent.
 */
export type ItemStage = 'candidate' | 'committed' | 'settled';

export type ListItemRow = {
  id: string;
  listId: string;
  title: string;
  fields: PurchaseFields | null;
  projectId: string | null;
  projectTitle: string | null;
  promotedActionId: string | null;
  promotedActionStatus: ActionStatus | null;
  position: number | null;
  stage: ItemStage;
  /**
   * Only the detail pane needs the body, so the list query leaves it out —
   * `getListItem` fills it and `getListItems` sets it null rather than
   * shipping a document per row to render a title.
   */
  notes: unknown;
};

export function stageOf(
  promotedActionId: string | null,
  promotedActionStatus: ActionStatus | null,
): ItemStage {
  if (!promotedActionId) return 'candidate';
  return promotedActionStatus === 'done' ? 'settled' : 'committed';
}

export type ListRow = {
  id: string;
  name: string;
  type: 'someday_maybe' | 'purchases' | 'reference' | 'checklist';
  itemCount: number;
  candidateCount: number;
};

export const LIST_TYPE_LABELS: Record<ListRow['type'], string> = {
  someday_maybe: 'Someday / Maybe',
  purchases: 'Purchases',
  reference: 'Reference',
  checklist: 'Checklist',
};

/**
 * Single place to change the currency. Cost is stored as a plain number, so
 * this only affects display.
 */
export const CURRENCY = 'GBP';

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: CURRENCY,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  standby: 'Standby',
  someday: 'Someday',
  completed: 'Completed',
  dropped: 'Dropped',
};

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export type AttachmentRow = {
  id: string;
  name: string;
  kind: AttachmentKind;
  mimeType: string | null;
  sizeBytes: number | null;
  driveFileId: string | null;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------

/** The parts of an inbox row a list needs. Kept structural so both the desktop
 *  queue and the phone's "just captured" list satisfy it. */
export type CaptureLike = { rawText: string | null; rawType: string };

/**
 * What a capture's row says: the first line and nothing else.
 *
 * The note lives below it in the same `raw_text`, and letting it spill into a
 * list turns a queue you scan into a wall of prose. A photo or a voice note is
 * a complete capture on its own, so there is often no text at all — "Photo"
 * beside a timestamp is enough to tell which one it is until it's clarified.
 *
 * Here rather than in either list because it was written twice already, and
 * the two copies disagreed about what an empty capture is called.
 */
export function captureLabel(item: CaptureLike): string {
  const first = item.rawText?.split('\n')[0].trim();
  if (first) return first;
  if (item.rawType === 'photo') return 'Photo';
  if (item.rawType === 'audio') return 'Voice note';
  return 'Untitled capture';
}

/** Whether anything follows the first line — i.e. the capture carries a note. */
export function captureHasNote(item: Pick<CaptureLike, 'rawText'>): boolean {
  return (item.rawText ?? '').split('\n').slice(1).join('\n').trim().length > 0;
}

// ---------------------------------------------------------------------------
// The Big Box
// ---------------------------------------------------------------------------

export type BoxRow = {
  id: string;
  name: string;
  instruction: string;
  /** How to write a title and summary for documents filed here. */
  rules: string;
  isDefault: boolean;
  driveFolderId: string | null;
  position: number | null;
  itemCount: number;
  /** Documents that haven't been read yet. */
  pendingCount: number;
};

export type BoxTagRow = { id: string; name: string; usageCount: number };

export type BoxCategoryRow = {
  id: string;
  name: string;
  allowNewTags: boolean;
  tags: BoxTagRow[];
};

/** A tag as it hangs off a document: enough to render, not enough to edit. */
export type AppliedTag = { id: string; name: string; category: string };

export type BoxItemRow = {
  id: string;
  boxId: string;
  kind: BoxItemKind;
  /** Null for a note or a place — there is no file. */
  driveFileId: string | null;
  name: string;
  lat: number | null;
  lng: number | null;
  /** Where a `link` points, and the picture the page advertises. */
  url: string | null;
  imageUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  title: string | null;
  description: string | null;
  docDate: string | null;
  status: BoxItemStatus;
  capturedAt: Date;
  tags: AppliedTag[];
  linkCount: number;
};

export type BoxLinkRow = {
  parentType: AttachmentParentType;
  parentId: string;
  title: string | null;
};

export type BoxItemDetail = BoxItemRow & {
  boxName: string;
  text: string | null;
  lastError: string | null;
  links: BoxLinkRow[];
};

export type LinkedDocumentRow = {
  id: string;
  boxId: string;
  boxName: string;
  name: string;
  title: string | null;
  description: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  driveFileId: string | null;
  capturedAt: Date;
};

/**
 * What sort of thing an entry is, for filtering.
 *
 * Coarser than a mime type on purpose. "application/vnd.openxmlformats-
 * officedocument.wordprocessingml.document" is not a thing anyone wants to
 * pick off a list; "a document" is. The kinds that aren't files — a note, a
 * place, a link — sit in the same list, because from the point of view of
 * finding something they are the same question: what am I looking for?
 */
export type EntryType =
  | 'note'
  | 'link'
  | 'location'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'document'
  | 'sheet'
  | 'text'
  | 'archive'
  | 'other';

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  note: 'Notes',
  link: 'Links',
  location: 'Places',
  image: 'Images',
  audio: 'Audio',
  video: 'Video',
  pdf: 'PDFs',
  document: 'Documents',
  sheet: 'Spreadsheets',
  text: 'Text',
  archive: 'Archives',
  other: 'Other',
};

/** The order they read in: what you made, then what you were sent. */
export const ENTRY_TYPE_ORDER: EntryType[] = [
  'note',
  'link',
  'location',
  'pdf',
  'image',
  'audio',
  'video',
  'document',
  'sheet',
  'text',
  'archive',
  'other',
];

export function entryTypeOf(item: {
  kind: BoxItemKind;
  mimeType: string | null;
}): EntryType {
  if (item.kind !== 'document') return item.kind;

  const mime = item.mimeType ?? '';

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';

  if (
    mime === 'application/vnd.google-apps.spreadsheet' ||
    mime.includes('spreadsheet') ||
    mime === 'text/csv' ||
    mime === 'application/vnd.ms-excel'
  ) {
    return 'sheet';
  }

  if (
    mime === 'application/vnd.google-apps.document' ||
    mime.includes('wordprocessing') ||
    mime === 'application/msword' ||
    mime === 'application/rtf'
  ) {
    return 'document';
  }

  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
    return 'text';
  }

  if (/zip|tar|gzip|rar|7z-compressed/.test(mime)) return 'archive';

  return 'other';
}

/**
 * What a document is called on screen.
 *
 * The Drive name carries a date prefix so the folder sorts usefully when
 * opened in Drive itself, and that prefix is filing machinery rather than
 * something to read. Until the model has read the document there is no title,
 * and the filename — minus the prefix — is the best we have.
 */
export function documentLabel(item: {
  title: string | null;
  name: string;
  kind?: BoxItemKind;
  description?: string | null;
  url?: string | null;
}): string {
  const title = item.title?.trim();
  if (title) return title;

  // A note has no title and no filename: it is its own first line, the way a
  // message in a chat is. Titling it would be inventing something.
  if (item.kind && item.kind !== 'document') {
    const first = (item.description ?? '').split('\n')[0].trim();
    if (first) return first;
    if (item.kind === 'location') return 'A place';
    if (item.kind === 'link') return item.url ?? 'A link';
    return 'A note';
  }

  return item.name.replace(/^\d{4}-\d{2}-\d{2}[ _-]*/, '') || item.name;
}

/** Where a place points. Google Maps takes a bare coordinate pair. */
export function mapUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
