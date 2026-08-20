'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  deleteDocument,
  linkDocument,
  setDocumentArrivedAt,
  moveDocument,
  startFromDocument,
  toggleDocumentTag,
  unlinkDocument,
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
import { useFilePreview } from './file-preview';
import { IconAudio, IconDocument, IconLink, IconPlace } from './icons';

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
}: {
  item: BoxItemDetail;
  categories: BoxCategoryRow[];
  boxes: BoxRow[];
  projects: { id: string; title: string }[];
}) {
  const router = useRouter();
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
    (title !== (item.title ?? '') || description !== (item.description ?? ''));

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
  const readable = (isDocument && !isAudio) || item.kind === 'link';

  const open = () => {
    if (!file) return;
    preview.open({
      id: item.id,
      name: documentLabel(item),
      src: `/api/box/${item.id}/file`,
      mimeType: item.mimeType,
      driveFileId: file,
      driveUrl: driveFileUrl(file),
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-grey-500">
          {item.boxName} · {arrived.format(item.capturedAt)}
        </span>

        <input
          value={title}
          onChange={(e) => edit({ title: e.target.value })}
          placeholder={documentLabel(item)}
          className="w-full border-0 border-b border-transparent bg-transparent pb-1 text-[17px] font-medium text-grey-900 placeholder:text-grey-400 focus:border-grey-300 focus:outline-none"
        />
      </header>

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
        <textarea
          value={description}
          onChange={(e) => edit({ description: e.target.value })}
          rows={4}
          placeholder={
            isAudio
              ? 'Not transcribed — nothing here reads speech yet. Write what it was about and search will find it.'
              : isDocument
                ? 'Not summarised yet.'
                : 'Write something.'
          }
          className="w-full resize-y rounded-sm border border-grey-200 bg-paper px-2 py-1.5 text-[13px] leading-relaxed text-grey-800 placeholder:text-grey-400 focus:border-grey-400 focus:outline-none"
        />

        {dirty ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await updateDocument(item.id, title, description);
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

      {/* Dates, plural and deliberately so: a bill that arrives in August is
          dated July, and both facts are worth keeping. A note has only the one
          date, which is the moment you wrote it. */}
      <section className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px]">
        {/* Editable, because this is what decides where the entry sits in the
            feed, and it can be wrong in ordinary ways — a backlog imported
            under today, a scan made on Friday and filed on Monday. */}
        <label className="flex items-center gap-2 text-grey-500">
          Arrived
          <input
            type="datetime-local"
            defaultValue={localInput(item.capturedAt)}
            disabled={pending}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              startTransition(async () => {
                await setDocumentArrivedAt(item.id, new Date(value).toISOString());
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

      {categories.length > 0 ? (
        <section className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-grey-500">
            Tags
          </span>

          {categories.map((category) => (
            <div key={category.id} className="flex flex-wrap items-baseline gap-1">
              <span className="mr-1 w-24 shrink-0 text-[11px] text-grey-500">
                {category.name}
              </span>
              {category.tags.length === 0 ? (
                <span className="text-[11px] text-grey-400">no tags yet</span>
              ) : (
                category.tags.map((tag) => {
                  const on = applied.has(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          await toggleDocumentTag(item.id, tag.id);
                          router.refresh();
                        })
                      }
                      className={[
                        'rounded-sm px-1.5 py-px text-[11px] disabled:opacity-50',
                        on
                          ? 'bg-selected-bg font-medium text-selected'
                          : 'bg-grey-200 text-grey-600 hover:bg-grey-300',
                      ].join(' ')}
                    >
                      {tag.name}
                    </button>
                  );
                })
              )}
            </div>
          ))}
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
