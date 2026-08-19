'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  deleteDocument,
  linkDocument,
  moveDocument,
  rereadDocument,
  startFromDocument,
  toggleDocumentTag,
  unlinkDocument,
  updateDocument,
} from '@/lib/actions';
import { driveFileUrl } from '@/lib/google/sync';
import {
  documentLabel,
  type BoxCategoryRow,
  type BoxItemDetail,
  type BoxRow,
} from '@/lib/queries.shared';
import { useFilePreview } from './file-preview';
import { IconDocument, IconLink } from './icons';

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

  const [title, setTitle] = useState(item.title ?? '');
  const [description, setDescription] = useState(item.description ?? '');
  const [showText, setShowText] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const dirty =
    title !== (item.title ?? '') || description !== (item.description ?? '');

  const applied = new Set(item.tags.map((t) => t.id));

  const open = () =>
    preview.open({
      id: item.id,
      name: documentLabel(item),
      src: `/api/box/${item.id}/file`,
      mimeType: item.mimeType,
      driveFileId: item.driveFileId,
      driveUrl: driveFileUrl(item.driveFileId),
    });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-grey-500">
          {item.boxName} · {arrived.format(item.capturedAt)}
        </span>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={documentLabel(item)}
          className="w-full border-0 border-b border-transparent bg-transparent pb-1 text-[17px] font-medium text-grey-900 placeholder:text-grey-400 focus:border-grey-300 focus:outline-none"
        />
      </header>

      {/* The file itself, first: it is the thing, and everything else is a
          description of it. A plain click previews; a modified click opens
          Drive, the way every other link on the machine behaves. */}
      <a
        href={driveFileUrl(item.driveFileId)}
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
        <IconDocument />
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        {item.sizeBytes ? (
          <span className="shrink-0 text-[11px] text-grey-400">
            {Math.max(1, Math.round(item.sizeBytes / 1024))} KB
          </span>
        ) : null}
      </a>

      {item.status !== 'ready' ? (
        <div className="rounded-sm border border-grey-200 bg-grey-50 px-3 py-2 text-[12px] text-grey-600">
          <p>
            {item.status === 'pending'
              ? 'Not read yet. It will be named, summarised and tagged on the next run.'
              : 'This one could not be read.'}
          </p>
          {item.lastError ? (
            <p className="mt-1 font-mono text-[11px] text-grey-500">{item.lastError}</p>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await rereadDocument(item.id);
                router.refresh();
              })
            }
            className="mt-2 rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-50"
          >
            Read it now
          </button>
        </div>
      ) : null}

      <section className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider text-grey-500">
          What this is
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Not summarised yet."
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
                  router.refresh();
                })
              }
              className="self-start rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setTitle(item.title ?? '');
                setDescription(item.description ?? '');
              }}
              className="text-[11px] text-grey-500 underline underline-offset-2"
            >
              Discard
            </button>
          </div>
        ) : null}
      </section>

      {/* Dates, plural and deliberately so: a bill that arrives in August is
          dated July, and both facts are worth keeping. */}
      <section className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
        <span className="text-grey-500">
          Arrived{' '}
          <span className="text-grey-700">{arrived.format(item.capturedAt)}</span>
        </span>
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
        ) : null}

        {item.status === 'ready' ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await rereadDocument(item.id);
                router.refresh();
              })
            }
            className="text-grey-500 underline underline-offset-2 hover:text-grey-800 disabled:opacity-50"
          >
            Read it again
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
