'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addParsedList } from '@/lib/actions';
import { cleanPageForReading } from '@/lib/photo-clean';
import {
  CHILD_MEANS,
  type ListPhotoKind,
  type ReadItem,
  type ReadList,
} from '@/lib/list-photo';
import { IconCamera } from './icons';

/**
 * Read a photographed list into whatever list you are standing in.
 *
 * **It lives in the quick-add row**, which is the answer to "how does this
 * work on a list with no uploader": every list that can be typed into already
 * has one line at the top for typing, so the camera goes on the end of it.
 * Nothing new appears in a pane header, the gesture is in the same place on
 * all four lists, and on a phone the file input opens the camera directly
 * (`capture="environment"`) rather than a file browser.
 *
 * **It proposes; it never writes.** What comes back is a panel of rows with
 * ticks, editable in place, and nothing exists until the button under it is
 * pressed. That is the standing rule for anything a model produced, and it
 * earns its keep here more than anywhere: a misread word reads exactly like a
 * correct one, so the only real check is a person looking at it beside the
 * paper — which is in their other hand.
 *
 * **The photograph never leaves this component.** It is cleaned and shrunk
 * here, posted for reading, and dropped. Nothing goes to Drive, so there is no
 * copy to delete afterwards and nothing left behind if the panel is abandoned.
 */
export function ListPhoto({
  kind,
  projectId,
  listId,
}: {
  kind: ListPhotoKind;
  projectId?: string;
  listId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [read, setRead] = useState<ReadList | null>(null);
  /** Which rows are going in. Ids are indexes: the panel never re-sorts. */
  const [taken, setTaken] = useState<Set<number>>(new Set());

  async function readPhoto(file: File) {
    setProblem(null);
    setReading(true);
    try {
      const ready = await cleanPageForReading(file);

      const response = await fetch(`/api/parse-list?kind=${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': ready.type || 'image/jpeg' },
        body: ready,
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? 'That photo could not be read.');

      const list = body as ReadList;
      if (list.items.length === 0) {
        setProblem('Nothing on that page looked like a list.');
        return;
      }

      setRead(list);
      setTaken(new Set(list.items.map((_, index) => index)));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That photo could not be read.');
    } finally {
      setReading(false);
      // Clearing the input is what lets the same photo be chosen twice, which
      // is exactly what you do after a bad read.
      if (input.current) input.current.value = '';
    }
  }

  async function commit() {
    if (!read) return;
    const wanted = read.items.filter((_, index) => taken.has(index));
    if (wanted.length === 0) return;

    setSaving(true);
    try {
      await addParsedList(kind, { projectId, listId }, wanted);
      setRead(null);
      setTaken(new Set());
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const edit = (index: number, patch: Partial<ReadItem>) => {
    setRead((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item, at) =>
              at === index ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  };

  const editChild = (index: number, childAt: number, text: string) => {
    setRead((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item, at) =>
              at === index
                ? {
                    ...item,
                    children: item.children.map((child, childIndex) =>
                      childIndex === childAt ? { ...child, text } : child,
                    ),
                  }
                : item,
            ),
          }
        : current,
    );
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        /* A phone offers the camera rather than the gallery — this is a page
           in front of you, not a file you saved earlier. */
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void readPhoto(file);
        }}
      />

      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={reading}
        title="Read a photo of a handwritten list"
        aria-label="Read a photo of a handwritten list"
        className="shrink-0 text-grey-400 hover:text-grey-700 disabled:opacity-50"
      >
        {reading ? (
          <span className="text-[11px] uppercase tracking-wider">Reading…</span>
        ) : (
          <IconCamera />
        )}
      </button>

      {problem ? (
        <p className="basis-full pt-1 text-[11px] text-stale">{problem}</p>
      ) : null}

      {read ? (
        <div className="basis-full pt-2">
          <div className="border border-grey-300 bg-grey-50">
            <div className="flex items-baseline justify-between gap-2 border-b border-grey-200 px-3 py-1.5">
              <span className="text-[10px] uppercase tracking-wider text-grey-500">
                What the photo says
              </span>
              <span className="text-[10px] text-grey-400">
                Nothing is saved until you press Add
              </span>
            </div>

            <ul className="max-h-[22rem] overflow-y-auto px-3 py-2">
              {read.items.map((item, index) => (
                <li key={index} className="border-b border-grey-150 py-1.5 last:border-0">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={taken.has(index)}
                      onChange={(event) =>
                        setTaken((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(index);
                          else next.delete(index);
                          return next;
                        })
                      }
                      className="mt-1 h-3.5 w-3.5 accent-selected"
                      aria-label={`Add "${item.text}"`}
                    />

                    <div className="min-w-0 flex-1">
                      <input
                        value={item.text}
                        onChange={(event) => edit(index, { text: event.target.value })}
                        className={[
                          'w-full bg-transparent text-[13px] focus:outline-none',
                          /* A word the reader was unsure of is the one to
                             look at, so it is marked rather than merely
                             correctable. */
                          item.unsure
                            ? 'text-stale underline decoration-dotted underline-offset-4'
                            : 'text-grey-800',
                        ].join(' ')}
                      />

                      {item.children.map((child, childAt) => (
                        <div key={childAt} className="mt-0.5 flex items-baseline gap-1.5 pl-3">
                          <span className="shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
                            {CHILD_MEANS[kind]}
                          </span>
                          <input
                            value={child.text}
                            onChange={(event) => editChild(index, childAt, event.target.value)}
                            className={[
                              'min-w-0 flex-1 bg-transparent text-[12px] focus:outline-none',
                              child.unsure ? 'text-stale' : 'text-grey-700',
                            ].join(' ')}
                          />
                        </div>
                      ))}
                    </div>

                    {kind === 'purchases' ? (
                      <input
                        inputMode="decimal"
                        value={item.price ?? ''}
                        placeholder="price"
                        onChange={(event) => {
                          const raw = event.target.value.trim();
                          const value = Number(raw.replace(',', '.'));
                          edit(index, {
                            price: raw && Number.isFinite(value) ? value : null,
                          });
                        }}
                        className="w-16 shrink-0 bg-transparent text-right text-[12px] tabular-nums text-grey-700 placeholder:text-grey-400 focus:outline-none"
                        aria-label="Price"
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-grey-200 px-3 py-1.5">
              <button
                type="button"
                onClick={() => {
                  setRead(null);
                  setTaken(new Set());
                }}
                className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
              >
                Throw it away
              </button>

              <button
                type="button"
                onClick={() => void commit()}
                disabled={saving || taken.size === 0}
                className="rounded-sm bg-grey-800 px-3 py-1 text-[12px] text-paper hover:bg-grey-900 disabled:opacity-50"
              >
                {saving ? 'Adding…' : `Add ${taken.size}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
