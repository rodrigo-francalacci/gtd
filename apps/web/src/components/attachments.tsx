'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AttachmentParentType } from '@gtd/db';
import {
  createDocument,
  createGallery,
  detachAttachment,
  moveAttachmentToProject,
  renameAttachment,
} from '@/lib/actions';
import { UploadError, uploadToDrive } from '@/lib/drive-upload';
import { driveFileUrl } from '@/lib/google/sync';
import type { AttachmentRow } from '@/lib/queries.shared';
import type { SortChoice } from '@/lib/sort';
import { AudioRecorder } from './audio-recorder';
import { AudioPlay } from './audio-play';
import { imagesToPdf, isImage, pdfNameFor } from '@/lib/images-to-pdf';
import { mediaFacts } from '@/lib/media-facts';

/** The busy line's name for the whole operation, rather than for one file. */
const GALLERY = 'Making the gallery';

/**
 * What can go in a gallery: pictures, and film.
 *
 * Wider than what can be combined into a PDF, which is images only — a video
 * has no page. So several videos, or a mixture, offers the gallery and not the
 * PDF, and the prompt says so by which buttons it shows.
 */
const isGalleryable = (file: File) =>
  file.type.startsWith('image/') || file.type.startsWith('video/');

/** What to call it: today's date, which is what every filename here leads with. */
function galleryName(files: File[]): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${today} ${files.length} pictures`;
}
import { useFilePreview, useOpenFile } from './file-preview';
import { GalleryView } from './gallery-view';
import { FileMeta } from './file-meta';
import { GroupHeading } from './group-heading';
import { IconDocument, IconGallery, IconImage } from './icons';
import { NewDocumentMenu } from './new-document-menu';
import { RowMenu } from './row-menu';
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
  moveUpTo,
}: {
  parentType: AttachmentParentType;
  parentId: string;
  rows: AttachmentRow[];
  label?: string;
  /**
   * The project these files could be moved up to, when the parent is an action
   * inside one.
   *
   * A name rather than an id, because the id is read on the server from the
   * action itself — this is only what the button says it will do. Absent for a
   * project's own files and for a standalone action, where there is no "up".
   */
  moveUpTo?: string | null;
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
  const openFile = useOpenFile();
  const input = useRef<HTMLInputElement>(null);

  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string[]>([]);
  /** Per-file 0–1, keyed by name. A book takes long enough to need a bar. */
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [recording, setRecording] = useState(false);
  /**
   * Images held back while the list asks whether they are one document.
   *
   * Only ever set when several pictures arrive *together*, which is the one
   * moment the question means anything. It is not a staging tray: there is no
   * way to leave things sitting in it, because both answers act.
   */
  const [offer, setOffer] = useState<File[] | null>(null);
  /** The row being renamed, or null. One at a time — this is a list, not a form. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * A new document opens in the preview pane the moment it exists — making
   * one and then leaving you to go and find it would be a strange way round.
   *
   * Which editor opens is decided by the file, not here: a Google format
   * embeds Google’s editor and a markdown, LaTeX or HTML file gets the
   * pane’s own. The button is the same button either way.
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
      openFile({
        id: row.id,
        name: row.name,
        src: `/api/attachments/${row.id}/file`,
        transcriptUrl: `/api/attachments/${row.id}/transcript`,
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
   * What to do with files as they arrive.
   *
   * Every way in — the button, a drop, a recording — comes through here, so the
   * question gets asked once rather than three times. The case it exists for is
   * a letter or a contract photographed page by page and then attached to the
   * project it belongs to: eight rows to open in order, against one document
   * you scroll.
   *
   * Anything that is not several images at once goes straight up, as before.
   */
  const receive = (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0) return;

    if (list.length > 1 && list.every(isGalleryable)) {
      setErrors([]);
      setOffer(list);
      return;
    }

    void upload(list);
  };

  /**
   * The answer: a gallery.
   *
   * The folder is made first and the pictures go into it one at a time, which
   * is the same order every capture in this app follows: the container that can
   * be found again exists before the bytes that would otherwise be lost. A
   * failure part-way leaves a gallery holding four of the six rather than six
   * files nobody can reach.
   *
   * `mediaFacts` reads each one before it goes — dimensions, and the camera's
   * date and position where there is one. Here rather than on the server
   * because here is where the file is; a server would have to fetch every
   * photograph back out of Drive to measure it.
   */
  const makeGallery = async () => {
    const list = offer;
    if (!list) return;

    setOffer(null);
    setErrors([]);
    setBusy((b) => [...b, GALLERY]);

    try {
      const made = await createGallery(parentType, parentId, galleryName(list));

      if ('error' in made) {
        setErrors([made.error]);
        setOffer(list);
        return;
      }

      for (const file of list) {
        try {
          await uploadToDrive(
            { parentType: 'gallery', parentId: made.id },
            file,
            (fraction) => setProgress((p) => ({ ...p, [file.name]: fraction })),
            await mediaFacts(file),
          );
        } catch (error) {
          setErrors((e) => [
            ...e,
            error instanceof UploadError ? error.message : `${file.name} failed to upload.`,
          ]);
        } finally {
          setProgress((p) => {
            const { [file.name]: _done, ...rest } = p;
            return rest;
          });
        }
      }

      router.refresh();
    } finally {
      setBusy((b) => b.filter((n) => n !== GALLERY));
    }
  };

  /**
   * The answer: one document.
   *
   * Built in the browser and then handed to the ordinary upload path, so the
   * PDF goes to Drive the same way every other file does — and lands in the
   * project's folder, like everything else attached here.
   */
  const combine = async () => {
    const list = offer;
    if (!list) return;

    setOffer(null);
    setErrors([]);

    try {
      const pdf = await imagesToPdf(list, pdfNameFor(list.length, label));
      await upload([pdf]);
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : 'Those images would not combine.',
      ]);
      // Handed back rather than dropped: a failure here must not be the
      // difference between having the pictures and not.
      setOffer(list);
    }
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
      {/*
        Wraps, because these controls do not fit beside a heading on a phone.

        They used to be `shrink-0` in a row that could not wrap, which on a
        390px pane put 367px of buttons into 280px of space. The overflow was
        not the worst of it: a pane that overflows horizontally becomes a
        horizontal scroller — `overflow-y: auto` computes `overflow-x` to
        `auto` too — and a pane that scrolls sideways eats the swipe meant for
        the carousel. So a wide button row stopped the *navigation* working,
        several routes away from anything to do with attachments.

        `min-w-0` is what lets it narrow at all; without it the cluster keeps
        its max-content width and wrapping never happens. On a desktop pane
        (38rem) the heading and the controls still share one line exactly as
        before — there is room, so nothing wraps.
      */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          {label}
          {rows.length > 0 ? (
            <span className="ml-1.5 tabular-nums text-grey-400">{rows.length}</span>
          ) : null}
        </h2>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {sort && sortKey && rows.length > 1 ? (
            // Only once there is an order to argue about. One file cannot be
            // sorted, and a menu offering to is noise on every pane that has
            // a single attachment.
            <SortControl viewKey={sortKey} choice={sort} />
          ) : null}
          <NewDocumentMenu
            disabled={creating}
            onChoose={(kind) => void create(kind.mimeType, kind.label)}
          />
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

      {/*
        Asked only when it has an answer worth giving. Both buttons act — there
        is deliberately no dismiss, because dismissing would leave the pictures
        nowhere while the pane looked as though it had taken them.
      */}
      {offer ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-sm border border-grey-200 bg-grey-50 px-2 py-1.5 text-[11px] text-grey-600">
          <span className="min-w-0 flex-1 truncate">{offer.length} images</span>

          <button
            type="button"
            onClick={() => void makeGallery()}
            className="shrink-0 rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper"
          >
            Make a gallery
          </button>

          {/*
            Offered only when every one of them is a picture. A PDF page can
            hold an image and cannot hold a film, so a set with a video in it
            gets the gallery and no false promise beside it.
          */}
          {offer.every(isImage) ? (
            <button
              type="button"
              onClick={() => void combine()}
              className="shrink-0 rounded-sm border border-grey-300 px-2 py-1 text-[11px] text-grey-700 hover:bg-grey-200"
            >
              One PDF
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              const list = offer;
              setOffer(null);
              void upload(list);
            }}
            className="shrink-0 rounded-sm px-2 py-1 text-[11px] text-grey-600 underline hover:text-grey-800"
          >
            Keep separate
          </button>
        </div>
      ) : null}

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
          if (e.target.files) receive(e.target.files);
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
          receive(e.dataTransfer.files);
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
              renaming === row.id ? (
                <li key={row.id} className="px-3 py-1.5">
                  <RenameRow
                    name={row.name}
                    onDone={(next) => {
                      setRenaming(null);
                      if (next === null) return;
                      startTransition(async () => {
                        await renameAttachment(row.id, next);
                      });
                    }}
                  />
                </li>
              ) : (
              /*
               * The name gets the whole line on a phone, and shares one with
               * its facts from `md` up.
               *
               * Every other part of this row is `shrink-0` and the name is the
               * only thing that gives — so in a narrow pane the date, the byte
               * count and two buttons held their full width while the filename
               * was squeezed to about five characters. Measured at a 320px
               * pane: 51 pixels for the name. That is the space being spent on
               * precisely the wrong things, since the one fact you need to
               * recognise a file is what it is called.
               *
               * `flex-wrap` with the name at `basis-full` below `md` puts the
               * facts underneath instead, where they cost a line and take
               * nothing from the name.
               */
              /*
               * The row's own actions are hover-only, which is no action at all
               * on a phone: you could open a file and do nothing else to it.
               * `RowMenu` is the same right-click and press-and-hold every list
               * row already answers to, so the verbs are reachable by finger
               * without a second control taking width from the filename.
               *
               * It *is* the flex row rather than a wrapper around one, or the
               * layout would gain a level and the name would stop taking the
               * space the wrapping rules give it.
               */
              <li key={row.id}>
                <RowMenu
                  name={row.name}
                  onRename={(next) => renameAttachment(row.id, next)}
                  onDelete={async () => {
                    // Close the pane first if it is showing this very file,
                    // or it sits there rendering a 404.
                    preview.closeIf(row.id);
                    await detachAttachment(row.id);
                  }}
                  deleteLabel="Remove"
                  deleteNote="The file goes to Drive’s bin."
                  extra={
                    moveUpTo && parentType === 'action' && row.kind !== 'gallery'
                      ? [
                          {
                            label: `Move it up to ${moveUpTo}`,
                            run: () => moveAttachmentToProject(row.id),
                          },
                        ]
                      : undefined
                  }
                  className="group flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-[12px] md:flex-nowrap"
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
                  /*
                   * Double-click reads it full screen, the same gesture that
                   * opens a row. A single click still shows it in the pane, so
                   * the quick glance costs nothing and the long read is one
                   * more click rather than a different control.
                   *
                   * The anchor's own default is suppressed either way: this is
                   * a real Drive link so a modified click still opens Drive,
                   * which is the rule every attachment follows.
                   */
                  onDoubleClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    preview.expand();
                  }}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    openFile({
                      id: row.id,
                      name: row.name,
                      src: `/api/attachments/${row.id}/file`,
                      transcriptUrl: `/api/attachments/${row.id}/transcript`,
                      mimeType: row.mimeType,
                      driveFileId: row.driveFileId,
                      driveUrl: row.driveFileId
                        ? driveFileUrl(row.driveFileId)
                        : null,
                      /*
                       * A gallery has no bytes — `drive_file_id` is a folder —
                       * so it is handed over already rendered, through the same
                       * door the Drive tree uses. `src` is still filled in
                       * above and simply never read, because the pane checks
                       * `node` first: leaving it out would mean the one row
                       * type here that builds a different shape of object.
                       */
                      node:
                        row.kind === 'gallery' ? (
                          <GalleryView galleryId={row.id} name={row.name} />
                        ) : undefined,
                    });
                  }}
                  className={[
                    // `basis` rather than a width: the name takes the rest of
                    // the first line on a phone and shares the line from `md`.
                    'min-w-0 flex-1 basis-[calc(100%-2rem)] cursor-pointer truncate',
                    'hover:underline md:basis-auto',
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

                {/*
                  Only upwards, and only from an action. A file on a project is
                  already where things end up, and a list item's project is a
                  candidate rather than a commitment.
                */}
                {moveUpTo && parentType === 'action' && row.kind !== 'gallery' ? (
                  <button
                    type="button"
                    title={`Move it up to ${moveUpTo} — nothing moves in Drive`}
                    onClick={() =>
                      startTransition(async () => {
                        await moveAttachmentToProject(row.id);
                      })
                    }
                    className="shrink-0 text-[11px] text-grey-400 opacity-0 underline underline-offset-2 transition-opacity hover:text-grey-800 group-hover:opacity-100"
                  >
                    Move up
                  </button>
                ) : null}

                <button
                  type="button"
                  title="Rename — Drive follows on the next sync"
                  onClick={() => setRenaming(row.id)}
                  className="shrink-0 text-[11px] text-grey-400 opacity-0 underline underline-offset-2 transition-opacity hover:text-grey-800 group-hover:opacity-100"
                >
                  Rename
                </button>

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
                </RowMenu>
              </li>
              )
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
/**
 * The row, while it is being renamed.
 *
 * The extension is shown but not edited — it is kept whatever you type, so
 * putting it in the field would only invite deleting it by accident while
 * clearing the name. Enter commits, Escape abandons, and blur commits too:
 * clicking away from a field you have just typed into means the typing, not
 * the leaving.
 */
function RenameRow({
  name,
  onDone,
}: {
  name: string;
  onDone: (next: string | null) => void;
}) {
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0] ?? '';
  const [value, setValue] = useState(ext ? name.slice(0, -ext.length) : name);

  const commit = () => onDone(value.trim() === '' ? null : value);

  return (
    <div className="flex items-center gap-2 text-[12px]">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') onDone(null);
        }}
        onBlur={commit}
        aria-label="File name"
        className="min-w-0 flex-1 rounded-sm border border-grey-300 bg-paper px-1.5 py-0.5 text-grey-900 focus:border-selected focus:outline-none"
      />
      {ext ? <span className="shrink-0 text-[11px] text-grey-400">{ext}</span> : null}
    </div>
  );
}

function Glyph({ row }: { row: AttachmentRow }) {
  const className = 'shrink-0 text-grey-400';

  if (row.kind === 'audio') {
    return <AudioPlay src={`/api/attachments/${row.id}/file`} name={row.name} />;
  }

  if (row.kind === 'gallery') return <IconGallery className={className} />;
  if (row.kind === 'image') return <IconImage className={className} />;
  return <IconDocument className={className} />;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
