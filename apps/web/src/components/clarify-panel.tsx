'use client';

import { useState, useTransition } from 'react';
import { clarifyInboxItem, type ClarifyDecision } from '@/lib/actions';
import type { Context } from '@gtd/db';

type Kind = ClarifyDecision['kind'];

const ACTIONABLE: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'next_action', label: 'Next action', hint: 'The very next physical step' },
  { kind: 'waiting', label: 'Waiting for', hint: 'Someone else owes you this' },
  { kind: 'project', label: 'Project', hint: 'More than one step' },
  { kind: 'done', label: 'Did it', hint: 'Under two minutes — already done' },
];

const NOT_ACTIONABLE: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'list_item', label: 'Park on a list', hint: 'Someday, reference, purchases' },
  { kind: 'trashed', label: 'Trash', hint: 'No action, no value' },
];

export function ClarifyPanel({
  item,
  projects,
  areas,
  lists,
  contextGroups,
}: {
  item: {
    id: string;
    rawText: string | null;
    createdAt: Date;
    aiSuggestion: {
      projectId?: string;
      contextIds?: string[];
      confidence?: number;
    } | null;
  };
  projects: { id: string; title: string }[];
  areas: { id: string; name: string }[];
  lists: { id: string; name: string; type: string }[];
  contextGroups: {
    place: Context[];
    time: Context[];
    energy: Context[];
    person: Context[];
  };
}) {
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<Kind | null>(null);

  // The suggestion pre-fills; it never commits anything on its own.
  const [title, setTitle] = useState((item.rawText ?? '').split('\n')[0].trim());
  const [projectId, setProjectId] = useState(item.aiSuggestion?.projectId ?? '');
  const [areaId, setAreaId] = useState('');
  const [listId, setListId] = useState(lists[0]?.id ?? '');
  const [contextIds, setContextIds] = useState<string[]>(
    item.aiSuggestion?.contextIds ?? [],
  );

  const suggestedProject = projects.find((p) => p.id === item.aiSuggestion?.projectId);

  const toggleContext = (id: string) =>
    setContextIds((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );

  const confirm = () => {
    if (!kind) return;

    let decision: ClarifyDecision;
    if (kind === 'trashed') decision = { kind: 'trashed' };
    else if (kind === 'project') decision = { kind, title, areaId: areaId || null };
    else if (kind === 'list_item') {
      if (!listId) return;
      decision = { kind, title, listId };
    } else decision = { kind, title, projectId: projectId || null, contextIds };

    startTransition(async () => {
      await clarifyInboxItem(item.id, decision);
      setKind(null);
    });
  };

  const needsTitle = kind !== null && kind !== 'trashed';
  const dimensions: { key: keyof typeof contextGroups; label: string }[] = [
    { key: 'place', label: 'Where' },
    { key: 'time', label: 'Time' },
    { key: 'energy', label: 'Energy' },
    { key: 'person', label: 'Who' },
  ];

  return (
    <div className={pending ? 'opacity-60' : ''}>
      {/* The raw capture, shown as a quotation and never editable — it is the
          record of what you actually thought. Everything below is a layer on
          top of it. */}
      <section>
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          Captured{' '}
          {new Intl.DateTimeFormat('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(item.createdAt)}
        </h2>
        <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-grey-300 pl-3 text-[15px] leading-relaxed text-grey-800">
          {item.rawText}
        </blockquote>
      </section>

      <p className="mt-5 text-[13px] font-medium text-grey-800">Is it actionable?</p>

      <div className="mt-2 space-y-3">
        <Row
          options={ACTIONABLE}
          selected={kind}
          onSelect={setKind}
          heading="Yes"
        />
        <Row
          options={NOT_ACTIONABLE}
          selected={kind}
          onSelect={setKind}
          heading="No"
        />
      </div>

      {kind ? (
        <section className="mt-5 rounded-sm border border-grey-300 bg-grey-50 px-3 py-3">
          {needsTitle ? (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                {kind === 'project'
                  ? 'Project title'
                  : kind === 'list_item'
                    ? 'Item'
                    : 'Action — start with a verb'}
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
              />
            </div>
          ) : (
            <p className="text-[12px] text-grey-600">
              The capture stays in the record, marked as trashed. Nothing is
              deleted.
            </p>
          )}

          {kind === 'next_action' || kind === 'waiting' || kind === 'done' ? (
            <>
              <div className="mt-3">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                  Project
                </label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
                {suggestedProject && projectId === suggestedProject.id ? (
                  <p className="mt-1 text-[11px] text-grey-500">
                    Suggested from the text — change it if that&apos;s wrong.
                  </p>
                ) : null}
              </div>

              <div className="mt-3 space-y-1.5">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                  Contexts
                </span>
                {dimensions.map(({ key, label }) => {
                  const items = contextGroups[key];
                  if (items.length === 0) return null;
                  return (
                    <div key={key} className="flex items-baseline gap-2">
                      <span className="w-11 shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
                        {label}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {items.map((c) => {
                          const on = contextIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => toggleContext(c.id)}
                              className={[
                                'rounded-sm border px-1.5 py-px text-[11px]',
                                on
                                  ? 'border-grey-700 bg-grey-700 text-paper'
                                  : 'border-grey-300 text-grey-600 hover:border-grey-500',
                              ].join(' ')}
                            >
                              {c.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {kind === 'project' ? (
            <div className="mt-3">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                Area of focus
              </label>
              <select
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
                className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
              >
                <option value="">No area</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {kind === 'list_item' ? (
            <div className="mt-3">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
                List
              </label>
              {lists.length === 0 ? (
                <p className="mt-1 text-[12px] text-stale">
                  No lists yet — create one under Manage lists first.
                </p>
              ) : (
                <select
                  value={listId}
                  onChange={(e) => setListId(e.target.value)}
                  className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
                >
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={
                pending ||
                (needsTitle && !title.trim()) ||
                (kind === 'list_item' && !listId)
              }
              className="rounded-sm bg-grey-800 px-2.5 py-1 text-[12px] text-paper disabled:opacity-40"
            >
              {kind === 'trashed' ? 'Trash it' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setKind(null)}
              className="text-[11px] text-grey-500 underline underline-offset-2"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Row({
  heading,
  options,
  selected,
  onSelect,
}: {
  heading: string;
  options: { kind: Kind; label: string; hint: string }[];
  selected: Kind | null;
  onSelect: (kind: Kind) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-6 shrink-0 pt-1 text-[10px] uppercase tracking-wider text-grey-400">
        {heading}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.kind}
            type="button"
            title={o.hint}
            onClick={() => onSelect(o.kind)}
            className={[
              'rounded-sm border px-2 py-1 text-[12px]',
              selected === o.kind
                ? 'border-grey-800 bg-grey-800 text-paper'
                : 'border-grey-300 text-grey-600 hover:border-grey-500',
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
