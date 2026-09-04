'use client';

import Link from 'next/link';
import { TagEditor, TagEditorButton } from './tag-editor';
import { useSidebarSlot } from './sidebar-slot';
import { EmojiPicker } from './emoji-picker';
import { NoteEditor } from './note-editor';
import type { LinkTarget } from './editor-toolbar';
import { docFromText } from '@/lib/tiptap';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  deleteDocument,
  linkDocument,
  moveDocument,
  setBoxItemListed,
  setDocumentArrivedAt,
  setDocumentExpiry,
  startFromDocument,
  toggleDocumentTag,
  unlinkDocument,
  updateBoxItemNotes,
  updateDocument,
} from '@/lib/actions';
import { readDocument } from '@/lib/read-document';
import { driveFileUrl } from '@/lib/google/sync';
import {
  documentLabel,
  mapUrl,
  type BoxCategoryRow,
  type BoxItemDetail,
  type BoxRow,
} from '@/lib/queries.shared';
import { useFilePreview, type PreviewFile } from './file-preview';
import { GalleryView } from './gallery-view';
import {
  IconAudio,
  IconDocument,
  IconEnvelope,
  IconLink,
  IconPlace,
} from './icons';

const arrived = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const printed = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * What `datetime-local` wants: `YYYY-MM-DDTHH:mm`, in local time and with no
 * zone. `toISOString` is UTC and would shift the value every time the pane
 * rendered, so the parts are read off the date itself.
 */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * One document, and everything the app knows about it.
 *
 * The title and summary are the model's and are editable, because it is
 * occasionally wrong and a wrong title on a document you'll look for in three
 * years is worse than no title. The transcription underneath is not editable:
 * it is what the document *says*, not what we think of it.
 */
export function DocumentDetail({
  item,
  categories,
  boxes,
  projects,
  linkTargets,
  openBase,
  hideNotes,
}: {
  /**
   * Leave the note out, because something else is showing it.
   *
   * The focus view puts the note in a column of its own with everything else
   * beside it, which is a *layout* this pane cannot express — so rather than
   * teaching the component a second shape, it drops the one block the modal
   * renders itself. One boolean instead of a rewrite, and the pane is unchanged
   * when nobody passes it.
   */
  hideNotes?: boolean;
  item: BoxItemDetail;
  categories: BoxCategoryRow[];
  boxes: BoxRow[];
  projects: { id: string; title: string }[];
  /** Projects and actions this note can point at, offered by name. */
  linkTargets?: LinkTarget[];
  /**
   * The address an internal link opens on. The box passes its own, so following
   * one fills pane three without leaving the feed or dropping its filters.
   */
  openBase?: string;
}) {
  const router = useRouter();
  const slot = useSidebarSlot();
  const preview = useFilePreview();
  const [pending, startTransition] = useTransition();

  /**
   * The edit in progress, or null while there isn't one.
   *
   * Not two `useState`s seeded from the row, which is what this was and which
   * was quietly destructive. Reading a document changes the row *under* a
   * mounted pane — the header and the list update from the new props, but a
   * seeded `useState` keeps whatever it was initialised with, because
   * initialisers only run on mount. The pane then compared its stale empty
   * string against the model's new title, decided that was an unsaved edit,
   * offered Save, and wrote the empty string over the title.
   *
   * Holding the draft as one nullable value fixes it by construction: with
   * nothing typed there is no copy to go stale, so the fields always show the
   * current row, and Save cannot appear — let alone write — until you have
   * actually edited something.
   */
  const [draft, setDraft] = useState<{ title: string; description: string } | null>(
    null,
  );

  const title = draft?.title ?? item.title ?? '';
  const description = draft?.description ?? item.description ?? '';

  const edit = (patch: Partial<{ title: string; description: string }>) =>
    setDraft({ title, description, ...patch });
  const [showText, setShowText] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  /**
   * Read it, here and now.
   *
   * The queue's real driver is the cron, which on a Hobby account runs daily —
   * so queueing and hoping made a button labelled "now" mean "tomorrow". This
   * waits for the answer and says what happened.
   */
  const readNow = async () => {
    setReading(true);
    setReadError(null);

    try {
      const result = await readDocument(item.id);
      if (result.error) setReadError(result.error);
      router.refresh();
    } catch {
      setReadError('Could not reach the app to read it.');
    } finally {
      setReading(false);
    }
  };

  const dirty =
    draft !== null &&
    title !== (item.title ?? '');

  const applied = new Set(item.tags.map((t) => t.id));

  // Only a document has a file, and so only a document has anything to read,
  // preview, or open in Drive. A note is already in its final form.
  const file = item.driveFileId;
  const isDocument = item.kind === 'document';

  /**
   * Nothing here transcribes speech, so a recording is filed and played, never
   * read. Offering "read it now" on one is offering a button that can only
   * fail — which is what it did, until the queue started refusing the job.
   */
  const isAudio = item.mimeType?.startsWith('audio/') ?? false;
  /*
   * An email is readable too, and leaving it out cost it its tags.
   *
   * A message is filed `ready` and never queued — everything a document is read
   * to discover, a message already states — but tags are the one thing it
   * misses, and the whole plan was that they are one press of "Read it again"
   * away. That press was never offered: this asked for `kind === 'document'`,
   * and an email's kind is `email`. So the button the design leant on did not
   * exist, and every filed message sat there untagged and without an emoji.
   * The body is stored as `text/html`, which `canClassify` has always accepted.
   */
  const readable =
    ((isDocument || item.kind === 'email') && !isAudio) || item.kind === 'link';

  const asPreview = (): PreviewFile | null =>
    file
      ? {
          id: item.id,
          name: documentLabel(item),
          src: `/api/box/${item.id}/file`,
          transcriptUrl: `/api/box/${item.id}/transcript`,
          mimeType: item.mimeType,
          driveFileId: file,
          driveUrl: driveFileUrl(file),
          /*
           * A gallery's `drive_file_id` is a folder, which has no bytes — so it
           * is handed over already rendered, through the same door the Drive
           * tree uses. Everything above stays filled in and simply goes unread,
           * because the pane checks `node` first; branching earlier would make
           * this the one entry kind that builds a different shape of object.
           */
          node:
            item.kind === 'gallery' ? (
              <GalleryView galleryId={item.id} name={documentLabel(item)} />
            ) : undefined,
        }
      : null;

  const open = () => {
    const next = asPreview();
    if (next) preview.open(next);
  };

  /**
   * Selecting a document loads its file, without going to it.
   *
   * A box entry has exactly one file behind it, so there was never a choice to
   * make — clicking the filename only told the app what it could already work
   * out. Loading it on selection means the pane is ready before you swipe to
   * it, and on a desktop the document simply appears beside the entry the way
   * it would if you had asked.
   *
   * `preload`, not `open`: the carousel must not travel to it. You asked to
   * read the entry; the scan is the thing next to it.
   */
  const { preload } = preview;
  useEffect(() => {
    // Including the null case: an entry with no file — a note, a place —
    // clears the pane rather than leaving the last scan in it.
    preload(asPreview());
    // Keyed on the document rather than on the object, which is rebuilt every
    // render. `preload` ignores a repeat of the file already showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, file, preload]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-grey-500">
          {item.boxName} · {arrived.format(item.capturedAt)}
        </span>

        <div className="flex items-center gap-2">
          {/* This one stands in for the type icon in the feed, so correcting it
              is correcting what the row looks like — worth having beside the
              title rather than buried below. */}
          <EmojiPicker
            target="box"
            id={item.id}
            emoji={item.emoji ?? null}
            label="emoji"
          />
          <input
            value={title}
            onChange={(e) => edit({ title: e.target.value })}
            placeholder={documentLabel(item)}
            className="min-w-0 flex-1 border-0 border-b border-transparent bg-transparent pb-1 text-[17px] font-medium text-grey-900 placeholder:text-grey-500 focus:border-grey-300 focus:outline-none"
          />
        </div>
      </header>

      {/*
        Back to the message itself.
        
        What is stored here is a rendering, kept so the words are searchable
        and readable in a pane. It is not the message: you cannot reply to it,
        the thread has moved on since, and anything that arrived after it is
        not in it. So the pane says plainly where the real one is, and the link
        goes to Gmail rather than to the copy in Drive.
      */}
      {item.kind === 'email' && item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-sm border border-grey-200 px-3 py-2 text-[12px] text-grey-700 hover:bg-grey-100"
        >
          <IconEnvelope />
          <span className="min-w-0 flex-1 truncate">
            Open the original in Gmail
          </span>
          <span className="shrink-0 text-[11px] text-grey-400">↗</span>
        </a>
      ) : null}

      {item.kind === 'link' && item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="flex items-center gap-2 rounded-sm border border-grey-200 px-3 py-2 text-[12px] text-grey-700 hover:bg-grey-100"
        >
          <IconLink />
          <span className="min-w-0 flex-1 truncate">{item.url}</span>
          <span className="shrink-0 text-[11px] text-grey-400">Open ↗</span>
        </a>
      ) : null}

      {/* Where you were, for a place. Google Maps takes a bare coordinate
          pair, so this needs no geocoding service and no key. */}
      {item.kind === 'location' && item.lat !== null && item.lng !== null ? (
        <a
          href={mapUrl(item.lat, item.lng)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-sm border border-grey-200 px-3 py-2 text-[12px] text-grey-700 hover:bg-grey-100"
        >
          <IconPlace />
          <span className="min-w-0 flex-1 truncate tabular-nums">
            {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
          </span>
          <span className="shrink-0 text-[11px] text-grey-400">Map ↗</span>
        </a>
      ) : null}

      {/* The file itself, first: it is the thing, and everything else is a
          description of it. A plain click previews; a modified click opens
          Drive, the way every other link on the machine behaves. */}
      {file ? (
      <a
        href={driveFileUrl(file)}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          open();
        }}
        className={[
          'flex items-center gap-2 rounded-sm border px-3 py-2 text-[12px]',
          preview.openId === item.id
            ? 'border-selected bg-selected-bg text-selected'
            : 'border-grey-200 text-grey-700 hover:bg-grey-100',
        ].join(' ')}
      >
        {isAudio ? <IconAudio /> : <IconDocument />}
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        {item.sizeBytes ? (
          <span className="shrink-0 text-[11px] text-grey-400">
            {Math.max(1, Math.round(item.sizeBytes / 1024))} KB
          </span>
        ) : null}
      </a>
      ) : null}

      {readable && item.status !== 'ready' ? (
        <div className="rounded-sm border border-grey-200 bg-grey-50 px-3 py-2 text-[12px] text-grey-600">
          <p>
            {item.status === 'pending'
              ? item.kind === 'link'
                ? 'Not read yet. The page will be fetched for its title, summary and picture on the next run.'
                : 'Not read yet. It will be named, summarised and tagged on the next run.'
              : 'This one could not be read.'}
          </p>
          {item.lastError ? (
            <p className="mt-1 font-mono text-[11px] text-grey-500">{item.lastError}</p>
          ) : null}
          <button
            type="button"
            disabled={reading}
            onClick={readNow}
            className="mt-2 rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-50"
          >
            {reading ? 'Reading…' : 'Read it now'}
          </button>

          {readError ? (
            <p className="mt-1.5 text-[11px] text-stale">{readError}</p>
          ) : null}
        </div>
      ) : null}

{hideNotes ? null : (
        <section className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-grey-500">
            {isAudio
              ? 'About this recording'
              : item.kind === 'link'
                ? 'What this page is'
                : isDocument
                  ? 'What this is'
                  : 'Note'}
          </label>
          {/*
            Already resizable; now it stays where you put it. `rows` is dropped,
            because a height and a row count are two answers to one question and
            the row count would win on first paint before the variable applied.
          */}
          {/*
            The same editor every other note in the app uses.

            It seeds from `description` when there is no rich document yet, which
            is every entry filed before this and every summary a model wrote — so
            nothing had to be migrated, and an AI summary is simply the first
            draft of a note you can then format.

            It saves itself, like notes everywhere else here, which is why the
            Save and Discard below now belong to the title alone. A rich editor
            owns its content; a manual save over the top is two sources of truth
            for one field.
          */}
          <NoteEditor
            key={item.id}
            surface="box_item"
            id={item.id}
            targets={linkTargets}
            openBase={openBase}
            height={item.noteHeight ?? null}
            dense={item.noteDense ?? null}
            initialContent={item.notes ?? docFromText(item.description ?? '')}
            onSave={async (doc) => {
              await updateBoxItemNotes(item.id, doc);
            }}
            placeholder={
              isAudio
                ? 'Not transcribed — nothing here reads speech yet. Write what it was about and search will find it.'
                : isDocument
                  ? 'Not summarised yet.'
                  : 'Write something.'
            }
          />

          {dirty ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await updateDocument(item.id, title, item.description ?? '');
                    // Back to showing the row itself, which is now what we sent.
                    setDraft(null);
                    router.refresh();
                  })
                }
                className="self-start rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="text-[11px] text-grey-500 underline underline-offset-2"
              >
                Discard
              </button>
            </div>
          ) : null}
        </section>
      )}

      {/* Dates, plural and deliberately so: a bill that arrives in August is
          dated July, and both facts are worth keeping. A note has only the one
          date, which is the moment you wrote it. */}
      <section className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px]">
        {/* Editable, because this is what decides where the entry sits in the
            feed, and it can be wrong in ordinary ways — a backlog imported
            under today, a scan made on Friday and filed on Monday. */}
        <label className="flex items-center gap-2 text-grey-500">
          Arrived
          {/*
            Saved when you have finished, never on every change.
            
            `onChange` fires on each segment a native picker touches — choose a
            month and it fires — and saving there re-dated the entry, which
            *reorders the feed*, which re-rendered the list and closed the
            picker underneath the cursor. You got exactly one click before it
            shut, so navigating to another year and setting a time was
            impossible. The one control in the app whose own save destroys the
            thing you are using to set it.

            Blur is the moment the picker is done with. Enter blurs by hand,
            because a native date field does not.
          */}
          <input
            type="datetime-local"
            defaultValue={localInput(item.capturedAt)}
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const value = e.target.value;
              // Unchanged, or half-typed and not a date yet: a refresh here
              // would reorder the feed for nothing.
              if (!value || value === localInput(item.capturedAt)) return;

              const when = new Date(value);
              if (Number.isNaN(when.getTime())) return;

              startTransition(async () => {
                await setDocumentArrivedAt(item.id, when.toISOString());
                router.refresh();
              });
            }}
            className="rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-grey-700 hover:border-grey-300 focus:border-grey-400 focus:outline-none"
          />
        </label>
        {item.docDate ? (
          <span className="text-grey-500">
            Dated{' '}
            <span className="text-grey-700">
              {printed.format(new Date(item.docDate))}
            </span>
          </span>
        ) : null}
      </section>

      {/*
        How long this is worth keeping.

        Decided on arrival, which is the only moment it is easy: the receipt
        proving a card bill was paid is worth three months and you know that
        while you are looking at it, not while reviewing a thousand documents
        two years later. Default is forever, because that is what a box is for
        — this is the exception you opt into.
      */}
      <Lifetime
        itemId={item.id}
        expiresAt={item.expiresAt}
        capturedAt={item.capturedAt}
        disabled={pending}
        onDone={() => router.refresh()}
      />

      {categories.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-grey-500">
              Tags
            </span>
            <TagEditorButton itemId={item.id} />
          </div>

          {/*
            What this document *is* tagged, and nothing else.

            The whole vocabulary used to be drawn here, every category and every
            tag whether it was on this document or not. That works for a box
            with nine tags and falls apart at two hundred: a detail pane is a
            column of fixed width, and a wall of chips in it pushes everything
            the document actually says off the bottom of the screen. The
            question moved to the sidebar; this is the answer.
          */}
          {applied.size === 0 ? (
            <p className="text-[12px] text-grey-500">
              No tags yet.{' '}
              <button
                type="button"
                onClick={() => slot.claim(`tag-editor:${item.id}`)}
                className="underline underline-offset-2 hover:text-grey-800"
              >
                Add some
              </button>
              .
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {categories.flatMap((category) =>
                category.tags
                  .filter((tag) => applied.has(tag.id))
                  .map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      disabled={pending}
                      /* Clicking a tag here takes it off, which is the only
                         thing you can want from a tag that is already on. */
                      title={`Remove ${tag.name}`}
                      onClick={() =>
                        startTransition(async () => {
                          await toggleDocumentTag(item.id, tag.id);
                          router.refresh();
                        })
                      }
                      className="rounded-sm bg-selected-bg px-1.5 py-px text-[11px] font-medium text-selected hover:line-through disabled:opacity-50"
                    >
                      {tag.name}
                    </button>
                  )),
              )}
            </div>
          )}

          <TagEditor
            itemId={item.id}
            boxId={item.boxId}
            itemName={documentLabel(item)}
            categories={categories}
            applied={[...applied]}
          />
        </section>
      ) : null}

      {/* The GTD side, reached from here and never merged with it. */}
      <section className="flex flex-col gap-2 border-t border-grey-200 pt-4">
        <span className="text-[10px] uppercase tracking-wider text-grey-500">
          Used by
        </span>

        {item.links.length === 0 ? (
          <p className="text-[12px] text-grey-500">
            Not linked to anything. A document can be a project’s evidence
            without leaving this box.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {item.links.map((link) => (
              <li
                key={`${link.parentType}:${link.parentId}`}
                className="group flex items-center gap-2 text-[12px]"
              >
                <span className="shrink-0 text-grey-400">
                  <IconLink />
                </span>
                {link.parentType === 'project' ? (
                  <Link
                    href={`/projects/${link.parentId}`}
                    className="min-w-0 flex-1 truncate text-grey-700 hover:underline"
                  >
                    {link.title ?? 'Untitled project'}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-grey-700">
                    {link.title ?? 'Untitled'}
                    <span className="ml-1 text-grey-400">
                      {link.parentType === 'action' ? 'action' : 'list item'}
                    </span>
                  </span>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await unlinkDocument(item.id, link.parentType, link.parentId);
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

        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <button
            type="button"
            onClick={() => setLinking((v) => !v)}
            className="text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            {linking ? 'Cancel' : 'Link to a project'}
          </button>

          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const created = await startFromDocument(item.id, 'project', '');
                if (created) router.push(`/projects/${created.id}`);
              })
            }
            className="text-grey-500 underline underline-offset-2 hover:text-grey-800 disabled:opacity-50"
          >
            Start a project from this
          </button>

          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await startFromDocument(item.id, 'action', '');
                router.refresh();
              })
            }
            className="text-grey-500 underline underline-offset-2 hover:text-grey-800 disabled:opacity-50"
          >
            Start an action
          </button>
        </div>

        {linking ? (
          <select
            autoFocus
            defaultValue=""
            disabled={pending}
            onChange={(e) => {
              const projectId = e.target.value;
              if (!projectId) return;
              startTransition(async () => {
                await linkDocument(item.id, 'project', projectId);
                setLinking(false);
                router.refresh();
              });
            }}
            className="w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[12px] focus:border-grey-500 focus:outline-none"
          >
            <option value="">Choose a project…</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        ) : null}
      </section>

      <section className="flex flex-wrap items-center gap-3 border-t border-grey-200 pt-4 text-[11px]">
        {/* Always shown, even with nowhere to move to.
            
            This used to render only when a second box existed, which is
            logical and hides the fact that moving is possible at all — you
            cannot look for a control that isn't there, and the answer to
            "can I move this?" became "apparently not". With one box it says
            where the entry lives and how to get somewhere to move it. */}
        {boxes.length > 1 ? (
          <label className="flex items-center gap-2 text-grey-500">
            Box
            <select
              value={item.boxId}
              disabled={pending}
              onChange={(e) =>
                startTransition(async () => {
                  await moveDocument(item.id, e.target.value);
                  router.push(`/box/${e.target.value}?doc=${item.id}`);
                })
              }
              className="rounded-sm border border-grey-300 bg-paper px-1.5 py-0.5 text-[11px] focus:border-grey-500 focus:outline-none"
            >
              {boxes.map((box) => (
                <option key={box.id} value={box.id}>
                  {box.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="flex items-center gap-2 text-grey-500">
            Box <span className="text-grey-700">{item.boxName}</span>
            {/*
              Whether it is in the feed, said where the box is named.

              Only ever shown when the answer is currently no, which is the rare
              case: everything else is in its box because that is what putting it
              in a box meant. A control offering to hide things would be an
              invitation to tidy a box, and a box is not for tidying.
            */}
            {item.listed ? null : (
              <>
                <span className="text-grey-400">· not in the feed</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await setBoxItemListed(item.id, true);
                      router.refresh();
                    })
                  }
                  className="text-grey-500 underline underline-offset-2 hover:text-grey-800 disabled:opacity-50"
                >
                  Add it to {item.boxName}
                </button>
              </>
            )}
            <Link
              href="/box"
              className="underline underline-offset-2 hover:text-grey-800"
            >
              Add another to move things between
            </Link>
          </span>
        )}

        {readable && item.status === 'ready' ? (
          <button
            type="button"
            disabled={reading}
            onClick={readNow}
            className="text-grey-500 underline underline-offset-2 hover:text-grey-800 disabled:opacity-50"
          >
            {reading ? 'Reading…' : 'Read it again'}
          </button>
        ) : null}

        {item.text ? (
          <button
            type="button"
            onClick={() => setShowText((v) => !v)}
            className="text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            {showText ? 'Hide what it says' : 'Show what it says'}
          </button>
        ) : null}

        {/* Rare on purpose — a box is for keeping things. But a blank page or
            a duplicate scan is real, and a box you can't take rubbish out of
            stops being one you trust. */}
        {confirming ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteDocument(item.id);
                  router.push(`/box/${item.boxId}`);
                  router.refresh();
                })
              }
              className="rounded-sm bg-stale px-2 py-0.5 text-paper disabled:opacity-50"
            >
              Throw it away
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-grey-500 underline underline-offset-2"
            >
              Cancel
            </button>
            <span className="text-grey-400">The file goes to Drive’s bin.</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-grey-500 underline underline-offset-2 hover:text-stale"
          >
            Throw away
          </button>
        )}
      </section>

      {showText && item.text ? (
        // What the document says, verbatim — the thing search matches on.
        // Read-only: correcting a transcription would make it disagree with
        // the page it came from, which is the one thing it must not do.
        <pre className="whitespace-pre-wrap rounded-sm bg-grey-100 p-3 font-mono text-[11px] leading-relaxed text-grey-700">
          {item.text}
        </pre>
      ) : null}
    </div>
  );
}

/**
 * A shelf life, in the words you would actually use.
 *
 * Presets rather than a date picker as the primary control, because the
 * thought is "three months", not "the 22nd of November". The exact date is
 * shown beside it so the choice is never vague, and a date field is there for
 * the case where the paper itself names one.
 *
 * "Keep forever" is not merely the default but the way back: a box exists to
 * keep things, so removing an expiry has to be as easy as setting one.
 */
function Lifetime({
  itemId,
  expiresAt,
  capturedAt,
  disabled,
  onDone,
}: {
  itemId: string;
  expiresAt: string | null;
  capturedAt: Date;
  disabled?: boolean;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const set = (value: string | null) =>
    startTransition(async () => {
      await setDocumentExpiry(itemId, value);
      onDone();
    });

  /*
   * Counted from arrival, not from today. "Three months" said about a document
   * means three months of *its* life — set on a receipt imported from last
   * year, counting from now would keep it fifteen months.
   */
  const after = (months: number) => {
    const date = new Date(capturedAt);
    date.setMonth(date.getMonth() + months);
    return date.toISOString().slice(0, 10);
  };

  const todayISO = new Date().toISOString().slice(0, 10);

  const options: { label: string; months: number }[] = [
    { label: '3 months', months: 3 },
    { label: '6 months', months: 6 },
    { label: '1 year', months: 12 },
    { label: '7 years', months: 84 },
  ];

  const due = expiresAt ? new Date(`${expiresAt}T00:00:00`) : null;

  /*
   * Whole days between two local midnights, rather than a difference of
   * timestamps. "Tomorrow" should read as one day away all day, not as two in
   * the morning and one after lunch — and it keeps the countdown agreeing with
   * the date beside it.
   */
  const days = due
    ? Math.round(
        (due.getTime() - new Date(`${todayISO}T00:00:00`).getTime()) / 86_400_000,
      )
    : null;

  return (
    <section
      className={[
        'flex flex-col gap-1.5 text-[12px]',
        pending || disabled ? 'opacity-60' : '',
      ].join(' ')}
    >
      <span className="text-[10px] uppercase tracking-wider text-grey-500">
        Keep it
      </span>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={pending || disabled}
          onClick={() => set(null)}
          className={[
            'rounded-sm border px-1.5 py-px text-[11px]',
            expiresAt === null
              ? 'border-grey-700 bg-grey-700 text-paper'
              : 'border-grey-300 text-grey-600 hover:border-grey-500',
          ].join(' ')}
        >
          Forever
        </button>

        {options.map((o) => {
          const value = after(o.months);
          /*
           * A lifetime schedules a *future* deletion. On a document imported
           * with an old arrival date, arrival + three months is already behind
           * us, and one click would have thrown it away on the next sweep with
           * a line of small print as the only warning.
           *
           * Offered as unavailable rather than silently counted from today,
           * because "three months" means three months of the document's life
           * and quietly reinterpreting it would be the app deciding something
           * else was meant. If a document really is finished with, Throw away
           * is right there and says what it does.
           */
          const past = value <= todayISO;

          return (
            <button
              key={o.label}
              type="button"
              disabled={pending || disabled || past}
              title={
                past
                  ? `That would be ${printed.format(new Date(`${value}T00:00:00`))}, already past — use Throw away instead.`
                  : `Delete on ${printed.format(new Date(`${value}T00:00:00`))}`
              }
              onClick={() => set(value)}
              className={[
                'rounded-sm border px-1.5 py-px text-[11px]',
                expiresAt === value
                  ? 'border-grey-700 bg-grey-700 text-paper'
                  : 'border-grey-300 text-grey-600 hover:border-grey-500',
                past ? 'opacity-40' : '',
              ].join(' ')}
            >
              {o.label}
            </button>
          );
        })}

        <input
          type="date"
          value={expiresAt ?? ''}
          // Same rule, enforced by the field: a date already gone is not a
          // lifetime, it is a deletion, and there is a button for that.
          min={todayISO}
          disabled={pending || disabled}
          onChange={(e) => set(e.target.value || null)}
          aria-label="Delete on"
          className="rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-grey-600 hover:border-grey-300 focus:border-grey-400 focus:outline-none"
        />
      </div>

      {due ? (
        <p className="text-[11px] text-stale">
          {days !== null && days <= 0
            ? 'Due to be thrown away on the next sync.'
            : `Thrown away on ${printed.format(due)}${days !== null && days <= 30 ? ` — ${days} day${days === 1 ? '' : 's'} away` : ''}. The file goes to Drive’s bin.`}
        </p>
      ) : null}
    </section>
  );
}
