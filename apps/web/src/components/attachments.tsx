'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AttachmentParentType } from '@gtd/db';
import { createDocument, detachAttachment } from '@/lib/actions';
import { UploadError, uploadToDrive } from '@/lib/drive-upload';
import {
  GOOGLE_DOC,
  GOOGLE_SHEET,
  GOOGLE_SLIDES,
  driveFileUrl,
} from '@/lib/google/sync';
import type { AttachmentRow } from '@/lib/queries.shared';
import type { SortChoice } from '@/lib/sort';
import { AudioRecorder } from './audio-recorder';
import { AudioPlay } from './audio-play';
import { useFilePreview } from './file-preview';
import { FileMeta } from './file-meta';
import { GroupHeading } from './group-heading';
import { IconDocument, IconImage } from './icons';
import { SortControl } from './sort-control';

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
  sort,
  sortKey,
  groups,
}: {
  parentType: AttachmentParentType;
  parentId: string;
  rows: AttachmentRow[];
  label?: string;
  /**
   * How this list is ordered. The rows arrive already sorted — that happens in
   * SQL — so this is only here so the control can show what was chosen.
   */
  sort?: SortChoice;
  sortKey?: string;
  /**
   * Ids per heading, when the list is cut into groups.
   *
   * Ids rather than rows, because the grouping is worked out on the server and
   * a row would then exist twice — once here and once in `rows` — with
   * nothing keeping the copies in step. This says only where the cuts go.
   */
  groups?: { key: string; label: string; ids: string[] }[];
}) {
  const router = useRouter();
  const preview = useFilePreview();
  const input = useRef<HTMLInputElement>(null);

  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string[]>([]);
  /** Per-file 0–1, keyed by name. A book takes long enough to need a bar. */
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [, startTransition] = useTransition();

  /**
   * A new Doc or Sheet opens in the preview pane the moment it exists —
   * making a document and then leaving you to go and find it would be a
   * strange way round.
   */
  const create = async (mimeType: string, label: string) => {
    setErrors([]);
    setCreating(true);
    try {
      const row = await createDocument(
        parentType,
        parentId,
        mimeType,
        `${label} — ${new Date().toLocaleDateString('en-GB')}`,
      );
      preview.open({
        id: row.id,
        name: row.name,
        src: `/api/attachments/${row.id}/file`,
        mimeType,
        driveFileId: row.driveFileId,
        driveUrl: driveFileUrl(row.driveFileId),
      });
      router.refresh();
    } catch {
      setErrors([`Could not create that ${label.toLowerCase()}.`]);
    } finally {
      setCreating(false);
    }
  };

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0) return;

    setErrors([]);
    setBusy((b) => [...b, ...list.map((f) => f.name)]);

    // One upload per file, so a rejected file doesn't take the ones beside it
    // down with it. Each goes straight to Drive, which is what lets a 21 MB
    // book be attached at all — through our own function it would hit Vercel's
    // 4.5 MB body cap.
    await Promise.all(
      list.map(async (file) => {
        try {
          await uploadToDrive({ parentType, parentId }, file, (fraction) =>
            setProgress((p) => ({ ...p, [file.name]: fraction })),
          );
        } catch (error) {
          setErrors((e) => [
            ...e,
            error instanceof UploadError
              ? error.message
              : `${file.name} failed to upload.`,
          ]);
        } finally {
          setBusy((b) => b.filter((n) => n !== file.name));
          setProgress((p) => {
            const { [file.name]: _done, ...rest } = p;
            return rest;
          });
        }
      }),
    );

    router.refresh();
  };

  /**
   * The rows, with heading strings threaded in where the groups start.
   *
   * One flat list rather than a `<ul>` per group: the rows are separated by
   * `divide-y`, and nesting lists would restart that divider at every heading
   * and put a rule above each one. A string in the stream is a heading; an
   * object is a row.
   */
  const ordered: (AttachmentRow | string)[] = !groups
    ? rows
    : (() => {
        const byId = new Map(rows.map((r) => [r.id, r]));
        return groups.flatMap((group) => {
          const found = group.ids
            .map((id) => byId.get(id))
            .filter((r): r is AttachmentRow => r !== undefined);
          return found.length > 0 ? [group.label, ...found] : [];
        });
      })();

  return (
    <section className="mt-8 border-t border-grey-150 pt-5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          {label}
          {rows.length > 0 ? (
            <span className="ml-1.5 tabular-nums text-grey-400">{rows.length}</span>
          ) : null}
        </h2>
        <div className="flex shrink-0 items-center gap-3">
          {sort && sortKey && rows.length > 1 ? (
            // Only once there is an order to argue about. One file cannot be
            // sorted, and a menu offering to is noise on every pane that has
            // a single attachment.
            <SortControl viewKey={sortKey} choice={sort} />
          ) : null}
          <button
            type="button"
            disabled={creating}
            onClick={() => create(GOOGLE_DOC, 'Doc')}
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800 disabled:opacity-40"
          >
            New doc
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={() => create(GOOGLE_SHEET, 'Sheet')}
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800 disabled:opacity-40"
          >
            New sheet
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={() => create(GOOGLE_SLIDES, 'Slides')}
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800 disabled:opacity-40"
          >
            New slides
          </button>
          <button
            type="button"
            onClick={() => setRecording(true)}
            disabled={recording}
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800 disabled:opacity-40"
          >
            Record
          </button>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            Choose a file
          </button>
        </div>
      </div>

      {recording ? (
        <AudioRecorder
          onDone={(file) => {
            setRecording(false);
            void upload([file]);
          }}
          onCancel={() => setRecording(false)}
        />
      ) : null}

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
            ) : parentType === 'inbox_item' ? (
              // A capture has no project by definition — that is what
              // clarifying decides — so there is no "or" to offer here.
              <>
                Drop a file here — it goes into{' '}
                <span className="whitespace-nowrap">GTD/Inbox</span> until you
                clarify this capture.
              </>
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
            {ordered.map((row) =>
              typeof row === 'string' ? (
                <GroupHeading key={`h-${row}`} label={row} />
              ) : (
              <li
                key={row.id}
                className="group flex items-center gap-2 px-3 py-1.5 text-[12px]"
              >
                <Glyph row={row} />

                {/* The href is the real Drive URL, so ctrl/cmd-click and
                    middle-click still open it in a tab exactly as a link
                    should. A plain click is intercepted and shown in the
                    preview pane instead — the common case shouldn't cost you
                    the page you were on. */}
                <a
                  href={row.driveFileId ? driveFileUrl(row.driveFileId) : undefined}
                  target="_blank"
                  rel="noreferrer"
                  /* Counted on the way past by the shell's one listener. It
                     sits on the anchor rather than the row, so the Remove
                     button beside it doesn't register as having opened the
                     thing it is about to throw away. */
                  data-use={`attachment:${row.id}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    preview.open({
                      id: row.id,
                      name: row.name,
                      src: `/api/attachments/${row.id}/file`,
                      mimeType: row.mimeType,
                      driveFileId: row.driveFileId,
                      driveUrl: row.driveFileId
                        ? driveFileUrl(row.driveFileId)
                        : null,
                    });
                  }}
                  className={[
                    'min-w-0 flex-1 cursor-pointer truncate hover:underline',
                    preview.openId === row.id
                      ? 'font-medium text-grey-900'
                      : 'text-grey-800',
                  ].join(' ')}
                >
                  {row.name}
                </a>

                {/* Whichever fact explains this row's position, and the
                    place to correct it. Nothing under "By name" — the name is
                    already the whole row. */}
                {sort ? (
                  <FileMeta
                    type="attachment"
                    id={row.id}
                    sort={sort.sort}
                    addedAt={row.createdAt}
                    useCount={row.useCount}
                  />
                ) : null}

                <span className="shrink-0 tabular-nums text-[11px] text-grey-400">
                  {formatSize(row.sizeBytes)}
                </span>

                <button
                  type="button"
                  title="Remove — the file goes to Drive’s bin"
                  onClick={() =>
                    startTransition(async () => {
                      // Close the pane first if it's showing this very file —
                      // otherwise it sits there rendering a 404.
                      preview.closeIf(row.id);
                      await detachAttachment(row.id);
                    })
                  }
                  className="shrink-0 text-[11px] text-grey-400 opacity-0 underline underline-offset-2 transition-opacity hover:text-stale group-hover:opacity-100"
                >
                  Remove
                </button>
              </li>
              ),
            )}

            {busy.map((name) => (
              <li
                key={name}
                className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-grey-400"
              >
                <IconDocument className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {/* A percentage, because a large file otherwise looks
                    indistinguishable from a stalled one. */}
                <span className="shrink-0 tabular-nums text-[11px]">
                  {progress[name] === undefined
                    ? 'uploading…'
                    : `${Math.round(progress[name] * 100)}%`}
                </span>
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

/**
 * The mark at the head of a row — and, for a recording, the way to hear it.
 *
 * A voice note is the one attachment you cannot judge from its filename, and
 * the icon is already sitting there doing nothing. Making it the control costs
 * the row no width at all, which is the whole reason not to put a player in it.
 */
function Glyph({ row }: { row: AttachmentRow }) {
  const className = 'shrink-0 text-grey-400';

  if (row.kind === 'audio') {
    return <AudioPlay src={`/api/attachments/${row.id}/file`} name={row.name} />;
  }

  if (row.kind === 'image') return <IconImage className={className} />;
  return <IconDocument className={className} />;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
