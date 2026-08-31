'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The archive's own search box.
 *
 * Separate from the app-wide one because it answers a different question. Live
 * search asks *what am I doing about this*; here you already know the thing is
 * finished and are looking for what it said — a quote from a project that ended
 * last spring, the step that turned out to matter. Mixing the two makes both
 * worse, which is why the main box now leaves finished work out unless you ask
 * for it with `A:`.
 *
 * Submitted rather than typed-through: this runs a ranked query across every
 * archived project and action, and firing it per keystroke would be a request
 * per letter for a page nobody scrolls in a hurry.
 */
export function ArchiveSearch({ term, view }: { term: string; view: string | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState(term);

  const go = (next: string) => {
    const params = new URLSearchParams();
    if (next.trim()) params.set('find', next.trim());
    // The section you are in survives the search, so results and the list you
    // came from stay the same kind of thing.
    if (view) params.set('view', view);

    router.push(params.size > 0 ? `/archive?${params}` : '/archive');
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        go(draft);
      }}
      className="flex items-center gap-1"
    >
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Search the archive…"
        aria-label="Search the archive"
        /* 16px, or iOS Safari zooms the page in when it takes focus. */
        className="min-w-0 flex-1 rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[16px] text-grey-800 focus:border-selected focus:outline-none md:text-[12px]"
      />
      {term ? (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            go('');
          }}
          className="shrink-0 text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
        >
          Clear
        </button>
      ) : null}
    </form>
  );
}
