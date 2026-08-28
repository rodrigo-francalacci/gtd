'use client';

import { useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { toggleDocumentTag } from '@/lib/actions';
import type { BoxCategoryRow } from '@/lib/queries.shared';
import { useSidebarSlot } from './sidebar-slot';

/**
 * Putting tags *on* a document, in the sidebar's place.
 *
 * The detail pane used to carry the whole vocabulary — every category, every
 * tag, all of them drawn whether they were on this document or not. That is
 * fine for a box with nine tags and unreadable for one with two hundred: a
 * third pane is a column of a fixed width, and a wall of chips in it pushes
 * everything the document actually says off the bottom of the screen.
 *
 * So the pane keeps the answer — the tags this document *has* — and the
 * question moves here, which is the same trade `TagBrowser` already makes for
 * filtering and for the same reasons. The sidebar is navigation you are not
 * using while you tag something, it is already the right shape for a long
 * grouped list, and on a phone it is already a drawer, so this is a modal there
 * and a column here without either being written twice.
 *
 * Choosing does not close it. Tagging a document is rarely one tag, and each
 * one lands visibly in the pane behind — which is also why the panel does not
 * need to show what is applied twice over, though it does, because a list of
 * two hundred tags you are choosing from has to say which are already on.
 */
export function TagEditor({
  itemId,
  itemName,
  categories,
  applied,
}: {
  itemId: string;
  /** What is being tagged, so the panel says what it is acting on. */
  itemName: string;
  categories: BoxCategoryRow[];
  /** Tag ids already on this document. */
  applied: string[];
}) {
  const slot = useSidebarSlot();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();

  const owner = `tag-editor:${itemId}`;
  if (slot.owner !== owner || !slot.node) return null;

  const needle = query.trim().toLowerCase();
  const on = new Set(applied);

  const groups = categories
    .map((category) => ({
      ...category,
      tags: needle
        ? category.tags.filter((tag) => tag.name.toLowerCase().includes(needle))
        : category.tags,
    }))
    // A category with nothing left after a search is noise; one that is simply
    // empty still shows, because it is a real part of the vocabulary and its
    // absence would read as a mistake.
    .filter((category) => category.tags.length > 0 || !needle);

  const toggle = (tagId: string) => {
    startTransition(async () => {
      await toggleDocumentTag(itemId, tagId);
      router.refresh();
    });
  };

  return createPortal(
    /*
     * `absolute inset-0`, exactly as the tag browser does it, and not a detail.
     *
     * The slot's target is `display: contents`, so a panel in normal flow
     * becomes an ordinary child of the sidebar column — it stacks *below* the
     * nav, which is `h-full` and has already taken the height, and it stretches
     * the column to its own intrinsic width because the column has no width of
     * its own on a desktop (it takes the nav's `md:w-56`). What you get is the
     * nav where it always was, a strip of empty column beside it, and the panel
     * itself somewhere below the fold.
     *
     * Positioned against the column, which is `relative`, it covers the nav
     * instead — which is what "borrowing the sidebar" has to mean.
     */
    <div className="absolute inset-0 z-10 flex flex-col bg-grey-50">
      <div className="border-b border-grey-200 px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="min-w-0 truncate text-[13px] font-semibold uppercase tracking-wide text-grey-700">
            Tags
          </h2>
          <button
            type="button"
            onClick={() => slot.claim(null)}
            className="shrink-0 text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            Done
          </button>
        </div>

        <p className="mt-0.5 truncate text-[11px] text-grey-500">{itemName}</p>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a tag…"
          aria-label="Find a tag"
          /* 16px, or iOS Safari zooms the page in when it takes focus — and on a
             phone this panel *is* the screen. */
          className="mt-2 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[16px] text-grey-800 placeholder:text-grey-400 focus:border-selected focus:outline-none md:text-[12px]"
        />
      </div>

      <div className={['min-h-0 flex-1 overflow-y-auto p-3', pending ? 'opacity-60' : ''].join(' ')}>
        {groups.length === 0 ? (
          <p className="px-1 text-[12px] text-grey-400">Nothing matches that.</p>
        ) : (
          groups.map((category) => (
            <div key={category.id} className="mb-3">
              <h3 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                {category.name}
              </h3>

              {category.tags.length === 0 ? (
                <p className="px-1 text-[11px] text-grey-400">No tags yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {category.tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      disabled={pending}
                      aria-pressed={on.has(tag.id)}
                      onClick={() => toggle(tag.id)}
                      className={[
                        'rounded-sm px-1.5 py-0.5 text-[11px] disabled:opacity-50',
                        on.has(tag.id)
                          ? 'bg-selected-bg font-medium text-selected'
                          : 'bg-grey-200 text-grey-600 hover:bg-grey-300',
                      ].join(' ')}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>,
    slot.node,
  );
}

/** The button in the detail pane that hands the sidebar over. */
export function TagEditorButton({ itemId }: { itemId: string }) {
  const slot = useSidebarSlot();
  const owner = `tag-editor:${itemId}`;

  return (
    <button
      type="button"
      onClick={() => slot.claim(slot.owner === owner ? null : owner)}
      className="rounded-sm bg-grey-200 px-1.5 py-px text-[11px] text-grey-600 hover:bg-grey-300"
    >
      {slot.owner === owner ? 'Done' : 'Edit tags'}
    </button>
  );
}
