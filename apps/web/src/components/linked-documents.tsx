'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { AttachmentParentType } from '@gtd/db';
import { linkDocument, unlinkDocument } from '@/lib/actions';
import { driveFileUrl } from '@/lib/google/sync';
import { documentLabel, type LinkedDocumentRow } from '@/lib/queries.shared';
import type { SortChoice } from '@/lib/sort';
import { useFilePreview } from './file-preview';
import { FileMeta } from './file-meta';
import { GroupHeading } from './group-heading';
import { IconBox } from './icons';
import { SortControl } from './sort-control';

/**
 * Documents from the Big Box, cited here.
 *
 * A separate list from Attachments, and it says so. An attachment was uploaded
 * *to* this project and belongs to it — detaching one trashes the file. A
 * document was filed in a box and is only borrowed: unlinking leaves it
 * exactly where it was, which is what lets a parking notice be a project's
 * evidence for as long as the project lasts and a document forever.
 */
export function LinkedDocuments({
  parentType,
  parentId,
  rows,
  candidates,
  sort,
  sortKey,
  groups,
}: {
  parentType: AttachmentParentType;
  parentId: string;
  rows: LinkedDocumentRow[];
  /** Recent documents not yet linked here, for the picker. */
  candidates: LinkedDocumentRow[];
  /**
   * How this list is ordered. The rows arrive already sorted — that happens in
   * SQL — so this is only here so the control can show what was chosen.
   *
   * Its own choice, separate from the attachments above it: these are two
   * lists that happen to share a pane, and the one you borrowed from a box is
   * not ordered by the same instinct as the one you uploaded here.
   */
  sort?: SortChoice;
  sortKey?: string;
  /** Ids per heading, when the list is cut into groups. See `Attachments`. */
  groups?: { key: string; label: string; ids: string[] }[];
}) {
  const router = useRouter();
  const preview = useFilePreview();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  if (rows.length === 0 && candidates.length === 0) return null;

  // Headings threaded in as strings, exactly as the attachments list does it.
  const ordered: (LinkedDocumentRow | string)[] = !groups
    ? rows
    : (() => {
        const byId = new Map(rows.map((r) => [r.id, r]));
        return groups.flatMap((group) => {
          const found = group.ids
            .map((id) => byId.get(id))
            .filter((r): r is LinkedDocumentRow => r !== undefined);
          return found.length > 0 ? [group.label, ...found] : [];
        });
      })();

  return (
    <section className="mt-6 flex flex-col gap-2">
      {/* Wraps for the same reason the attachments header does — fewer
          controls here, so it only bites on a narrow pane with a long
          sort label, but the failure is the same one. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="text-[10px] uppercase tracking-wider text-grey-500">
          Documents
        </span>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {sort && sortKey && rows.length > 1 ? (
            <SortControl viewKey={sortKey} choice={sort} />
          ) : null}
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            {adding ? 'Cancel' : 'Link a document'}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-grey-500">
          Nothing from the Big Box is linked here yet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {ordered.map((row) =>
            typeof row === 'string' ? (
              <GroupHeading key={`h-${row}`} label={row} />
            ) : (
            <li
              key={row.id}
              className="group flex items-center gap-2 border-b border-grey-150 py-1.5 text-[12px] last:border-0"
            >
              <span className="shrink-0 text-grey-400">
                <IconBox />
              </span>

              {/* Plain click previews; a modified click opens Drive, the way
                  every other link on the machine behaves. An entry with no
                  file — a note, a place — has nothing to preview, so it is a
                  plain link back to where it sits in its box. */}
              {row.driveFileId ? (
                <a
                  href={driveFileUrl(row.driveFileId)}
                  target="_blank"
                  rel="noreferrer"
                  /* Counted on the way past by the shell's one listener. On
                     the anchor rather than the row, so Unlink beside it does
                     not register as having opened what it is about to drop. */
                  data-use={`box_item:${row.id}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    preview.open({
                      id: row.id,
                      name: documentLabel(row),
                      src: `/api/box/${row.id}/file`,
                      mimeType: row.mimeType,
                      driveFileId: row.driveFileId,
                      driveUrl: driveFileUrl(row.driveFileId!),
                    });
                  }}
                  className={[
                    'min-w-0 flex-1 truncate hover:underline',
                    preview.openId === row.id
                      ? 'font-medium text-grey-900'
                      : 'text-grey-700',
                  ].join(' ')}
                >
                  {documentLabel(row)}
                </a>
              ) : (
                <Link
                  href={`/box/${row.boxId}?doc=${row.id}`}
                  data-use={`box_item:${row.id}`}
                  className="min-w-0 flex-1 truncate text-grey-700 hover:underline"
                >
                  {documentLabel(row)}
                </Link>
              )}

              {/* The count is editable; the date is not. A linked document
                  is ordered by when it was cited here, which is a fact about
                  the link rather than about the document — and the
                  document's own arrival date is already editable in its box. */}
              {sort ? (
                <FileMeta
                  type="box_item"
                  id={row.id}
                  sort={sort.sort}
                  addedAt={row.capturedAt}
                  useCount={row.useCount}
                  editableDate={false}
                />
              ) : null}

              <Link
                href={`/box/${row.boxId}?doc=${row.id}`}
                className="shrink-0 text-[11px] text-grey-400 hover:text-grey-700"
              >
                {row.boxName}
              </Link>

              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await unlinkDocument(row.id, parentType, parentId);
                    router.refresh();
                  })
                }
                className="shrink-0 text-[11px] text-grey-400 opacity-0 underline underline-offset-2 group-hover:opacity-100 hover:text-grey-700"
              >
                Unlink
              </button>
            </li>
            ),
          )}
        </ul>
      )}

      {adding ? (
        <select
          autoFocus
          defaultValue=""
          disabled={pending}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            startTransition(async () => {
              await linkDocument(id, parentType, parentId);
              setAdding(false);
              router.refresh();
            });
          }}
          className="w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[12px] focus:border-grey-500 focus:outline-none"
        >
          <option value="">Recent documents…</option>
          {candidates.map((row) => (
            <option key={row.id} value={row.id}>
              {documentLabel(row)} — {row.boxName}
            </option>
          ))}
        </select>
      ) : null}
    </section>
  );
}
