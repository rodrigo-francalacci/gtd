import 'server-only';

import type { AttachmentParentType } from '@gtd/db';
import { getAttachments, getLinkedDocuments } from './queries';
import type { AttachmentRow, LinkedDocumentRow } from './queries.shared';
import { documentLabel } from './queries.shared';
import { groupRows, type SortChoice } from './sort';
import { getViewPref, viewKeys } from './view-prefs';

/**
 * Everything the sort control needs to draw itself, alongside the rows.
 *
 * Bundled rather than three loose props, because it is one decision: what the
 * order is, where to write a change to it, and where the headings fall. Three
 * separate props would be three chances to pass one of them and not the
 * others, on four detail panes each rendering two of these lists.
 */
export type ListOrder = {
  sort: SortChoice;
  viewKey: string;
  /** Where the headings fall, when the list is grouped. Ids, never rows. */
  groups?: { key: string; label: string; ids: string[] }[];
};

/**
 * The files uploaded to one project, action, list item or capture — in
 * whatever order was last chosen for that kind of pane.
 *
 * Read, sort and group in one call, because the three are not independent: the
 * ordering has to happen in SQL, and the grouping has to be cut from rows that
 * are already in that order or the headings come out interleaved.
 *
 * Keyed on the parent *type*, not the row. You want files ordered by use on
 * every project, not to make the decision again on each one — and it keeps
 * `view_prefs` a handful of rows rather than something that grows with the
 * data.
 */
export async function attachmentsFor(
  parentType: AttachmentParentType,
  parentId: string,
): Promise<{ rows: AttachmentRow[]; order: ListOrder }> {
  const viewKey = viewKeys.attachments(parentType);
  const sort = await getViewPref(viewKey);
  const rows = await getAttachments(parentType, parentId, sort);

  return {
    rows,
    order: { sort, viewKey, groups: cuts(rows, sort, (r) => r.name, (r) => r.createdAt) },
  };
}

/**
 * The box documents cited by one project, action or list item.
 *
 * Its own preference, separate from the attachments above it in the same pane.
 * They are two different lists that happen to share a heading area: one holds
 * files that belong to this thing, the other holds files borrowed from a box
 * and only pointed at from here.
 */
export async function documentsFor(
  parentType: AttachmentParentType,
  parentId: string,
): Promise<{ rows: LinkedDocumentRow[]; order: ListOrder }> {
  const viewKey = viewKeys.documents(parentType);
  const sort = await getViewPref(viewKey);
  const rows = await getLinkedDocuments(parentType, parentId, sort);

  return {
    rows,
    order: {
      sort,
      viewKey,
      // `capturedAt` is when the document reached its box, which is the only
      // date the row carries. The SQL sorted on when it was *linked* here —
      // the better fact, but it isn't selected, and adding a column to every
      // caller to label a heading that only shows under one sort is not worth
      // it. Under "oldest first" the two agree often enough to be unremarkable.
      groups: cuts(rows, sort, documentLabel, (r) => r.capturedAt),
    },
  };
}

/**
 * Where the headings fall — or nothing at all when the list isn't grouped.
 *
 * Ids rather than rows: the rows go down to the client once, as one flat
 * array, and a group carrying copies of them would be the same record in two
 * places with nothing keeping the two in step.
 */
function cuts<T extends { id: string }>(
  rows: T[],
  sort: SortChoice,
  title: (row: T) => string,
  date: (row: T) => Date,
): ListOrder['groups'] {
  if (!sort.grouped) return undefined;

  return groupRows(rows, sort, { date, title }).map((group) => ({
    key: group.key,
    label: group.label ?? '',
    ids: group.items.map((row) => row.id),
  }));
}
