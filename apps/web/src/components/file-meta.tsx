'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { correctUsage, setAttachmentAddedAt } from '@/lib/actions';
import type { SortKey } from '@/lib/sort';
import type { UsableType } from '@/lib/usage.shared';

const shown = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
});

/**
 * `datetime-local` wants `YYYY-MM-DDTHH:mm`, local and unzoned. `toISOString`
 * is UTC and would shift the value every time the row rendered, so the parts
 * are read off the date itself. Same helper as the document pane's.
 */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * The one fact a file row shows: whichever one it is currently sorted by.
 *
 * A date *and* a count *and* a size on every row would be a table, and these
 * lists sit inside a detail pane where the point is the file's name. So the
 * row shows the field that explains its position and nothing else — under
 * "Added" that is the date, under "By use" it is the count, and under "By
 * name" the name is already there and this shows nothing at all.
 *
 * And because it is exactly the field you are looking at when you notice it is
 * wrong, it is also the field you can correct here. Click the value, type over
 * it. That is the whole editing story for both of them: a counter you cannot
 * fix eventually tells you something you know to be untrue and offers no way
 * to say so, and an arrival date decides where the row *is*.
 */
export function FileMeta({
  type,
  id,
  sort,
  addedAt,
  useCount,
  /** Linked documents borrow their date from the link row; only the count is ours to set. */
  editableDate = true,
}: {
  type: UsableType;
  id: string;
  sort: SortKey;
  addedAt: Date;
  useCount: number;
  editableDate?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const cell =
    'shrink-0 tabular-nums text-[11px] text-grey-400 hover:text-grey-700';

  if (sort === 'usage') {
    if (editing) {
      return (
        <input
          type="number"
          min={0}
          autoFocus
          defaultValue={useCount}
          disabled={pending}
          onBlur={(e) => {
            const next = Number(e.target.value);
            setEditing(false);
            if (!Number.isFinite(next) || next === useCount) return;
            startTransition(async () => {
              await correctUsage(type, id, next);
              router.refresh();
            });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-12 shrink-0 rounded-sm border border-grey-300 bg-paper px-1 text-right text-[11px] tabular-nums focus:border-grey-500 focus:outline-none"
        />
      );
    }

    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={
          useCount === 1
            ? 'Opened once — click to correct'
            : `Opened ${useCount} times — click to correct`
        }
        className={cell}
      >
        {useCount}×
      </button>
    );
  }

  if (sort !== 'arrival') return null;

  if (editing && editableDate) {
    return (
      <input
        type="datetime-local"
        autoFocus
        defaultValue={localInput(addedAt)}
        disabled={pending}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          const value = e.target.value;
          if (!value) return;
          startTransition(async () => {
            await setAttachmentAddedAt(id, new Date(value).toISOString());
            setEditing(false);
            router.refresh();
          });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
        }}
        className="shrink-0 rounded-sm border border-grey-300 bg-paper px-1 text-[11px] focus:border-grey-500 focus:outline-none"
      />
    );
  }

  if (!editableDate) {
    return <span className={cell}>{shown.format(addedAt)}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="When this was added — click to correct"
      className={cell}
    >
      {shown.format(addedAt)}
    </button>
  );
}
