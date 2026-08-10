'use client';

import type { ListType } from '@gtd/db';
import { useState, useTransition } from 'react';
import { createList } from '@/lib/actions';
import { LIST_TYPE_LABELS } from '@/lib/queries.shared';

/**
 * Lists are typed because the type drives behaviour — a purchases list gets
 * cost/impact/where fields and a budget, the others don't.
 */
export function NewListForm() {
  const [name, setName] = useState('');
  const [type, setType] = useState<ListType>('someday_maybe');
  const [pending, startTransition] = useTransition();

  return (
    <div className={pending ? 'opacity-60' : ''}>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
        Name
      </label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Books to read"
        className="mt-1 w-full max-w-sm rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
      />

      <span className="mt-4 block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
        Type
      </span>
      <div className="mt-1 flex flex-wrap gap-1">
        {(Object.keys(LIST_TYPE_LABELS) as ListType[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setType(key)}
            className={[
              'rounded-sm border px-2 py-1 text-[11px]',
              type === key
                ? 'border-grey-800 bg-grey-800 text-paper'
                : 'border-grey-300 text-grey-600 hover:border-grey-500',
            ].join(' ')}
          >
            {LIST_TYPE_LABELS[key]}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={!name.trim() || pending}
        onClick={() => startTransition(() => void createList(name, type))}
        className="mt-4 rounded-sm bg-grey-800 px-2.5 py-1 text-[12px] text-paper disabled:opacity-40"
      >
        Create list
      </button>
    </div>
  );
}
