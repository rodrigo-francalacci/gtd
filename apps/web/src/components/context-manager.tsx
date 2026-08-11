'use client';

import type { ContextDimension } from '@gtd/db';
import { useState, useTransition } from 'react';
import { createContext, deleteContext, renameContext } from '@/lib/actions';

export type ManagedContext = {
  id: string;
  name: string;
  dimension: string;
  usage: number;
};

const DIMENSIONS: { key: ContextDimension; label: string; blurb: string }[] = [
  {
    key: 'place',
    label: 'Where',
    blurb: 'Somewhere you are, or a tool you need — Home, Office, Site, Computer.',
  },
  {
    key: 'time',
    label: 'Time',
    blurb: 'How long a gap you have — 5 min, 30 min, 2 hours.',
  },
  {
    key: 'energy',
    label: 'Energy',
    blurb: 'How much you have in the tank — High, Medium, Low.',
  },
  {
    key: 'person',
    label: 'Who',
    blurb: 'Someone to raise things with next time you speak. Optional.',
  },
];

export function ContextManager({ contexts }: { contexts: ManagedContext[] }) {
  return (
    <div className="space-y-7">
      {DIMENSIONS.map((dimension) => (
        <Dimension
          key={dimension.key}
          dimension={dimension}
          contexts={contexts.filter((c) => c.dimension === dimension.key)}
        />
      ))}
    </div>
  );
}

function Dimension({
  dimension,
  contexts,
}: {
  dimension: { key: ContextDimension; label: string; blurb: string };
  contexts: ManagedContext[];
}) {
  const [draft, setDraft] = useState('');
  const [pending, startTransition] = useTransition();

  const add = () => {
    if (!draft.trim()) return;
    startTransition(async () => {
      await createContext(draft, dimension.key);
      setDraft('');
    });
  };

  return (
    <section className={pending ? 'opacity-60' : ''}>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
        {dimension.label}
      </h2>
      <p className="mt-0.5 max-w-prose text-[12px] text-grey-500">{dimension.blurb}</p>

      {contexts.length === 0 ? (
        <p className="mt-2 text-[12px] text-grey-400">
          Nothing here yet — this dimension simply won&apos;t appear in the filter bar.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-grey-150 rounded-sm border border-grey-200">
          {contexts.map((context) => (
            <Row key={context.id} context={context} />
          ))}
        </ul>
      )}

      <form
        action={add}
        className="mt-2 flex gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add a ${dimension.label.toLowerCase()} context…`}
          className="w-64 rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[12px] focus:border-grey-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || pending}
          className="rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-40"
        >
          Add
        </button>
      </form>
    </section>
  );
}

function Row({ context }: { context: ManagedContext }) {
  const [name, setName] = useState(context.name);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <li
      className={[
        'flex flex-wrap items-center gap-2 px-3 py-1.5',
        pending ? 'opacity-50' : '',
      ].join(' ')}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name !== context.name) {
            startTransition(async () => void renameContext(context.id, name));
          }
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="w-48 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-[13px] text-grey-800 hover:border-grey-300 focus:border-grey-500 focus:outline-none"
      />

      <span className="text-[11px] text-grey-500">
        {context.usage === 0
          ? 'unused'
          : `on ${context.usage} action${context.usage === 1 ? '' : 's'}`}
      </span>

      <div className="ml-auto">
        {confirming ? (
          <span className="flex items-center gap-2">
            {/* Renaming is almost always what's wanted; say what delete costs. */}
            <span className="text-[11px] text-stale">
              {context.usage === 0
                ? 'Delete it?'
                : `Remove from ${context.usage} action${context.usage === 1 ? '' : 's'}?`}
            </span>
            <button
              type="button"
              onClick={() => startTransition(async () => void deleteContext(context.id))}
              className="rounded-sm bg-stale px-1.5 py-0.5 text-[11px] text-paper"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-[11px] text-grey-500 underline underline-offset-2"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-[11px] text-grey-400 underline underline-offset-2 hover:text-stale"
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
