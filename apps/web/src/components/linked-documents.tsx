'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { AttachmentParentType } from '@gtd/db';
import { linkDocument, moveLinkToProject, unlinkDocument } from '@/lib/actions';
import { driveFileUrl } from '@/lib/google/sync';
import { documentLabel, type LinkedDocumentRow } from '@/lib/queries.shared';
import type { SortChoice } from '@/lib/sort';
import { AskForEmail } from './ask-for-email';
import { useFilePreview, useOpenFile } from './file-preview';
import { FileMeta } from './file-meta';
import { GroupHeading } from './group-heading';
import { IconBox, IconEnvelope } from './icons';
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
  only = 'documents',
  candidates,
  sort,
  sortKey,
  groups,
  moveUpTo,
}: {
  parentType: AttachmentParentType;
  parentId: string;
  rows: LinkedDocumentRow[];
  /**
   * The project a citation could be moved up to, when the parent is an action
   * inside one. The name only — the destination is read on the server from the
   * action, so there is nothing here for a client to choose.
   */
  moveUpTo?: string | null;
  /**
   * Which half of the box this list is showing.
   *
   * Emails are separated from everything else because they are read for a
   * different reason. A document is evidence — the parking notice, the
   * quote, the receipt — and you open it to check something. A message is
   * correspondence: what was agreed, by whom, and when, and the next thing
   * you do with it is usually reply. Mixing the two produces a list where
   * neither question is easy to ask.
   *
   * One component and one query rather than two of each: the rows are the
   * same rows, joined the same way, differing only in `kind`.
   */
  only?: 'documents' | 'emails';
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
  const openFile = useOpenFile();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  const emails = only === 'emails';
  const mine = (row: LinkedDocumentRow) => (row.kind === 'email') === emails;

  const shown = rows.filter(mine);
  const offered = candidates.filter(mine);

  if (shown.length === 0 && offered.length === 0) return null;

  // Headings threaded in as strings, exactly as the attachments list does it.
  const ordered: (LinkedDocumentRow | string)[] = !groups
    ? shown
    : (() => {
        const byId = new Map(shown.map((r) => [r.id, r]));
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
          {emails ? 'Relevant emails' : 'Documents'}
        </span>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {sort && sortKey && !emails && shown.length > 1 ? (
            <SortControl viewKey={sortKey} choice={sort} />
          ) : null}
          {/* Two controls, and the pair is the point: cite one you already
              have, or go and get one. Only the first existed, which meant
              pasting a Gmail address into a box, waiting, and coming back
              here to find it. */}
          {emails ? <AskForEmail parentType={parentType} parentId={parentId} /> : null}

          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            {adding ? 'Cancel' : emails ? 'Link an email' : 'Link a document'}
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-[12px] text-grey-500">
          {emails
            ? 'No messages linked here. Label one in Gmail and it will arrive in a box.'
            : 'Nothing from the Big Box is linked here yet.'}
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
                {row.kind === 'email' ? <IconEnvelope /> : <IconBox />}
              </span>

              {/* Plain click previews; a modified click opens Drive, the way
                  every other link on the machine behaves. An entry with no
                  file — a note, a place — has nothing to preview, so it is a
                  plain link back to where it sits in its box. */}
              {row.driveFileId ? (
                <a
                  /*
                   * A modified click on a message goes to Gmail, not Drive.
                   * The copy in Drive is a rendering kept for reading and
                   * searching; the message is the thing you reply to, and
                   * opening the wrong one is the sort of mistake you only
                   * notice after typing an answer into it.
                   */
                  href={row.url ?? driveFileUrl(row.driveFileId)}
                  target="_blank"
                  rel="noreferrer"
                  /* Counted on the way past by the shell's one listener. On
                     the anchor rather than the row, so Unlink beside it does
                     not register as having opened what it is about to drop. */
                  data-use={`box_item:${row.id}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    openFile({
                      id: row.id,
                      name: documentLabel(row),
                      src: `/api/box/${row.id}/file`,
                      transcriptUrl: `/api/box/${row.id}/transcript`,
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

              {/* The link rewritten, not the document moved: it stays in
                  its box, as every citation does. */}
              {moveUpTo && parentType === 'action' ? (
                <button
                  type="button"
                  disabled={pending}
                  title={`Cite it on ${moveUpTo} instead`}
                  onClick={() =>
                    startTransition(async () => {
                      await moveLinkToProject(row.id, parentId);
                      router.refresh();
                    })
                  }
                  className="shrink-0 text-[11px] text-grey-400 opacity-0 underline underline-offset-2 group-hover:opacity-100 hover:text-grey-700"
                >
                  Move up
                </button>
              ) : null}

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
          <option value="">{emails ? 'Recent messages…' : 'Recent documents…'}</option>
          {offered.map((row) => (
            <option key={row.id} value={row.id}>
              {documentLabel(row)} — {row.boxName}
            </option>
          ))}
        </select>
      ) : null}
    </section>
  );
}
