'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { AttachmentParentType } from '@gtd/db';
import { linkDocument, unlinkDocument } from '@/lib/actions';
import { driveFileUrl } from '@/lib/google/sync';
import { documentLabel, type LinkedDocumentRow } from '@/lib/queries.shared';
import { useFilePreview } from './file-preview';
import { IconBox } from './icons';

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
}: {
  parentType: AttachmentParentType;
  parentId: string;
  rows: LinkedDocumentRow[];
  /** Recent documents not yet linked here, for the picker. */
  candidates: LinkedDocumentRow[];
}) {
  const router = useRouter();
  const preview = useFilePreview();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  if (rows.length === 0 && candidates.length === 0) return null;

  return (
    <section className="mt-6 flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-grey-500">
          Documents
        </span>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
        >
          {adding ? 'Cancel' : 'Link a document'}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-grey-500">
          Nothing from the Big Box is linked here yet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
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
                  className="min-w-0 flex-1 truncate text-grey-700 hover:underline"
                >
                  {documentLabel(row)}
                </Link>
              )}

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
          ))}
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
