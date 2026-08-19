'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  createBox,
  createBoxCategory,
  createBoxTag,
  deleteBox,
  deleteBoxCategory,
  deleteBoxTag,
  renameBoxTag,
  updateBox,
  updateBoxCategory,
} from '@/lib/actions';
import { driveFolderUrl } from '@/lib/google/sync';
import type { BoxCategoryRow, BoxRow } from '@/lib/queries.shared';

/**
 * A box's settings: what it's for, and the vocabulary it may be tagged with.
 *
 * The instruction is worth more than it looks. It goes to the model ahead of
 * the tag lists, and "fuel receipts, for a tax return" tells it which tags to
 * reach for better than the tag names ever will.
 */
export function BoxManager({
  box,
  categories,
}: {
  box: BoxRow;
  categories: BoxCategoryRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(box.name);
  const [instruction, setInstruction] = useState(box.instruction);
  const [confirming, setConfirming] = useState(false);

  const dirty = name !== box.name || instruction !== box.instruction;
  const documents = box.itemCount;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border-0 border-b border-transparent bg-transparent pb-1 text-[17px] font-medium text-grey-900 focus:border-grey-300 focus:outline-none"
        />
        <span className="text-[11px] text-grey-500">
          {documents} document{documents === 1 ? '' : 's'}
          {box.driveFolderId ? (
            <>
              {' · '}
              <a
                href={driveFolderUrl(box.driveFolderId)}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-grey-800"
              >
                Drive folder ↗
              </a>
            </>
          ) : (
            ' · no Drive folder yet — one is made when the first document arrives'
          )}
        </span>
      </header>

      <section className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider text-grey-500">
          What goes in here
        </label>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          placeholder="e.g. Fuel receipts, kept for a tax return."
          className="w-full resize-y rounded-sm border border-grey-200 bg-paper px-2 py-1.5 text-[13px] leading-relaxed text-grey-800 placeholder:text-grey-400 focus:border-grey-400 focus:outline-none"
        />
        <p className="text-[11px] text-grey-500">
          Read by the model before it tags anything filed here.
        </p>

        {dirty ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await updateBox(box.id, name, instruction);
                router.refresh();
              })
            }
            className="mt-1 self-start rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-50"
          >
            Save
          </button>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-grey-200 pt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-grey-500">
            Tag categories
          </span>
          <Link
            href={`/box/${box.id}`}
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            Open the box
          </Link>
        </div>

        {categories.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-grey-500">
            No categories yet. A category is one axis you’d want to sort by
            later — who sent it, what kind of thing it is, which part of life it
            belongs to.
          </p>
        ) : null}

        {categories.map((category) => (
          <CategoryEditor key={category.id} category={category} />
        ))}

        <NewCategoryForm boxId={box.id} />
      </section>

      {!box.isDefault ? (
        <section className="flex flex-col gap-2 border-t border-grey-200 pt-4">
          {confirming ? (
            <div className="flex flex-col gap-2 text-[12px]">
              <p className="leading-relaxed text-grey-700">
                Delete “{box.name}”? Its {documents} document
                {documents === 1 ? '' : 's'} move to the Feed and keep their
                files, names and summaries. The tags defined here go with the
                box.
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await deleteBox(box.id);
                      router.push('/box');
                      router.refresh();
                    })
                  }
                  className="rounded-sm bg-stale px-2 py-1 text-[11px] text-paper disabled:opacity-50"
                >
                  Delete the box
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-[11px] text-grey-500 underline underline-offset-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="self-start text-[11px] text-grey-500 underline underline-offset-2 hover:text-stale"
            >
              Delete this box
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}

/**
 * One category and its allowed tags.
 *
 * The usage count sits beside every tag for the same reason it does on
 * contexts: deleting one takes it off every document that carried it, and
 * that's a thing to know before rather than after.
 */
function CategoryEditor({ category }: { category: BoxCategoryRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tag, setTag] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <div className="rounded-sm border border-grey-200 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-grey-800">
          {category.name}
        </span>

        <div className="flex items-center gap-3 text-[11px]">
          <label className="flex items-center gap-1 text-grey-500">
            <input
              type="checkbox"
              checked={category.allowNewTags}
              disabled={pending}
              onChange={(e) =>
                startTransition(async () => {
                  await updateBoxCategory(
                    category.id,
                    category.name,
                    e.target.checked,
                  );
                  router.refresh();
                })
              }
            />
            may invent
          </label>

          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await deleteBoxCategory(category.id);
                router.refresh();
              })
            }
            className="text-grey-400 underline underline-offset-2 hover:text-stale"
          >
            Remove
          </button>
        </div>
      </div>

      {category.allowNewTags ? (
        <p className="mt-1 text-[11px] leading-relaxed text-grey-500">
          The model may add values here when none fit — for a list that can’t be
          written in advance, like a town. Leave it off everywhere else, or a
          controlled vocabulary turns into free text one plausible tag at a time.
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {category.tags.map((t) =>
          editing === t.id ? (
            <input
              key={t.id}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setEditing(null)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(null);
                if (e.key !== 'Enter') return;
                const value = draft.trim();
                if (!value) return;
                startTransition(async () => {
                  await renameBoxTag(t.id, value);
                  setEditing(null);
                  router.refresh();
                });
              }}
              className="w-28 rounded-sm border border-grey-400 bg-paper px-1 py-px text-[11px] focus:outline-none"
            />
          ) : (
            <span
              key={t.id}
              className="group flex items-center gap-1 rounded-sm bg-grey-200 px-1.5 py-px text-[11px] text-grey-700"
            >
              <button
                type="button"
                onDoubleClick={() => {
                  setEditing(t.id);
                  setDraft(t.name);
                }}
                title={`${t.usageCount} document${t.usageCount === 1 ? '' : 's'} — double-click to rename`}
              >
                {t.name}
              </button>
              <span className="tabular-nums text-grey-400">{t.usageCount}</span>
              <button
                type="button"
                aria-label={`Delete ${t.name}`}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteBoxTag(t.id);
                    router.refresh();
                  })
                }
                className="text-grey-400 opacity-0 group-hover:opacity-100 hover:text-stale"
              >
                ×
              </button>
            </span>
          ),
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = tag.trim();
          if (!value) return;
          startTransition(async () => {
            await createBoxTag(category.id, value);
            setTag('');
            router.refresh();
          });
        }}
        className="mt-2"
      >
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="Add a tag…"
          className="w-full rounded-sm border border-grey-200 bg-paper px-2 py-1 text-[11px] placeholder:text-grey-400 focus:border-grey-400 focus:outline-none"
        />
      </form>
    </div>
  );
}

function NewCategoryForm({ boxId }: { boxId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = name.trim();
        if (!value) return;
        startTransition(async () => {
          await createBoxCategory(boxId, value, false);
          setName('');
          router.refresh();
        });
      }}
    >
      <input
        value={name}
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
        placeholder="New category — e.g. Issued by"
        className="w-full rounded-sm border border-grey-200 bg-paper px-2 py-1.5 text-[12px] placeholder:text-grey-400 focus:border-grey-400 focus:outline-none"
      />
    </form>
  );
}

/** Add a box. Its Drive folder is made when the first document arrives. */
export function NewBoxForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = name.trim();
        if (!value) return;
        startTransition(async () => {
          const id = await createBox(value, '');
          setName('');
          if (id) router.push(`/box?box=${id}`);
          router.refresh();
        });
      }}
      className="border-b border-grey-150 px-4 py-2"
    >
      <input
        value={name}
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
        placeholder="New box…"
        className="w-full rounded-sm border border-grey-200 bg-paper px-2 py-1 text-[12px] placeholder:text-grey-400 focus:border-grey-400 focus:outline-none"
      />
    </form>
  );
}
