'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AttachmentParentType } from '@gtd/db';
import { detachAttachment } from '@/lib/actions';
import { driveFileUrl } from '@/lib/google/sync';
import type { AttachmentRow } from '@/lib/queries.shared';
import { IconAudio, IconDocument, IconImage } from './icons';

/**
 * Files attached to a project, action or list item.
 *
 * Drop them here or pick them; either way the bytes go to that project's own
 * Drive folder and only the id comes back. The app can read them afterwards
 * because it created them — that is the whole reason the `drive.file` scope is
 * enough, and why an attachment made here behaves differently from a file you
 * drag into the same folder from your desktop.
 */
export function Attachments({
  parentType,
  parentId,
  rows,
  label = 'Attachments',
}: {
  parentType: AttachmentParentType;
  parentId: string;
  rows: AttachmentRow[];
  label?: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0) return;

    setErrors([]);
    setBusy((b) => [...b, ...list.map((f) => f.name)]);

    // One request per file, so a rejected 20 MB video doesn't take the two
    // small files beside it down with it.
    await Promise.all(
      list.map(async (file) => {
        const body = new FormData();
        body.set('parentType', parentType);
        body.set('parentId', parentId);
        body.set('file', file);

        try {
          const response = await fetch('/api/attachments', { method: 'POST', body });
          if (!response.ok) {
            const { error } = await response.json().catch(() => ({}));
            setErrors((e) => [...e, error ?? `${file.name} failed to upload.`]);
          }
        } catch {
          setErrors((e) => [...e, `${file.name} failed to upload.`]);
        } finally {
          setBusy((b) => b.filter((n) => n !== file.name));
        }
      }),
    );

    router.refresh();
  };

  return (
    <section className="mt-8 border-t border-grey-150 pt-5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          {label}
          {rows.length > 0 ? (
            <span className="ml-1.5 tabular-nums text-grey-400">{rows.length}</span>
          ) : null}
        </h2>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
        >
          Choose a file
        </button>
      </div>

      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = '';
        }}
      />

      <div
        onDragOver={(e) => {
          // Only an OS file drag. An action or project being dragged past this
          // pane is somebody else's business.
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          void upload(e.dataTransfer.files);
        }}
        className={[
          'rounded-sm border border-dashed transition-colors',
          over ? 'border-selected bg-selected-bg' : 'border-grey-300',
        ].join(' ')}
      >
        {rows.length === 0 && busy.length === 0 ? (
          <p className="px-3 py-4 text-center text-[12px] text-grey-500">
            {parentType === 'project' ? (
              <>Drop a file here — it goes into this project’s Drive folder.</>
            ) : (
              <>
                Drop a file here — it goes into the project’s Drive folder, or{' '}
                <span className="whitespace-nowrap">GTD/Inbox</span> if this{' '}
                {parentType === 'list_item' ? 'item' : 'action'} has no project.
              </>
            )}
          </p>
        ) : (
          <ul className="divide-y divide-grey-150">
            {rows.map((row) => (
              <li
                key={row.id}
                className="group flex items-center gap-2 px-3 py-1.5 text-[12px]"
              >
                <Glyph kind={row.kind} />

                {row.driveFileId ? (
                  <a
                    href={driveFileUrl(row.driveFileId)}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-grey-800 hover:underline"
                  >
                    {row.name}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-grey-800">
                    {row.name}
                  </span>
                )}

                <span className="shrink-0 tabular-nums text-[11px] text-grey-400">
                  {formatSize(row.sizeBytes)}
                </span>

                <button
                  type="button"
                  title="Remove — the file goes to Drive’s bin"
                  onClick={() =>
                    startTransition(async () => {
                      await detachAttachment(row.id);
                    })
                  }
                  className="shrink-0 text-[11px] text-grey-400 opacity-0 underline underline-offset-2 transition-opacity hover:text-stale group-hover:opacity-100"
                >
                  Remove
                </button>
              </li>
            ))}

            {busy.map((name) => (
              <li
                key={name}
                className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-grey-400"
              >
                <IconDocument className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="shrink-0 text-[11px]">uploading…</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {errors.map((error) => (
        <p key={error} className="mt-1.5 text-[11px] text-stale">
          {error}
        </p>
      ))}
    </section>
  );
}

function Glyph({ kind }: { kind: AttachmentRow['kind'] }) {
  const className = 'shrink-0 text-grey-400';
  if (kind === 'image') return <IconImage className={className} />;
  if (kind === 'audio') return <IconAudio className={className} />;
  return <IconDocument className={className} />;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
