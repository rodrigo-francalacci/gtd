'use client';

import type { Context } from '@gtd/db';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  deleteAction,
  nudgeWaiting,
  setActionStatus,
  toggleActionContext,
  updateActionNotes,
  updateActionTitle,
} from '@/lib/actions';
import { daysSince, isStale } from '@/lib/queries.shared';
import { NoteEditor } from './note-editor';
import { TurnIntoNextAction } from './turn-into-next';
import { WaitingOnField } from './waiting-on-field';

type ActionDetailData = {
  id: string;
  title: string;
  status: 'next' | 'future' | 'waiting' | 'done';
  waitingSince: string | null;
  waitingOn: string | null;
  notes: unknown;
  projectId: string | null;
  projectTitle: string | null;
  contexts: { id: string; name: string; dimension: string }[];
};

export function ActionDetail({
  action,
  contextGroups,
  parties,
}: {
  action: ActionDetailData;
  /** Existing waiting-on names, offered as suggestions. */
  parties: string[];
  contextGroups: {
    place: Context[];
    time: Context[];
    energy: Context[];
    person: Context[];
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(action.title);

  const assigned = new Set(action.contexts.map((c) => c.id));
  const stale = action.status === 'waiting' && isStale(action.waitingSince);
  const days = daysSince(action.waitingSince);

  const statuses: {
    value: 'next' | 'future' | 'waiting' | 'done';
    label: string;
  }[] = [
    { value: 'next', label: 'Next' },
    { value: 'future', label: 'Future' },
    { value: 'waiting', label: 'Waiting for' },
    { value: 'done', label: 'Done' },
  ];

  const dimensions: { key: keyof typeof contextGroups; label: string }[] = [
    { key: 'place', label: 'Where' },
    { key: 'time', label: 'Time' },
    { key: 'energy', label: 'Energy' },
    { key: 'person', label: 'Who' },
  ];

  return (
    <div className={pending ? 'opacity-60' : ''}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title.trim() && title !== action.title) {
            startTransition(async () => {
              await updateActionTitle(action.id, title);
            });
          }
        }}
        className="w-full border-none bg-transparent text-xl font-semibold text-grey-900 focus:outline-none"
      />

      {action.projectTitle ? (
        <p className="mt-1 text-[12px] text-grey-500">{action.projectTitle}</p>
      ) : (
        <p className="mt-1 text-[12px] text-grey-400">No project — standalone action</p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {statuses.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() =>
              startTransition(async () => {
                await setActionStatus(action.id, s.value);
              })
            }
            className={[
              'rounded-sm border px-2 py-1 text-[12px]',
              action.status === s.value
                ? 'border-grey-800 bg-grey-800 text-paper'
                : 'border-grey-300 text-grey-600 hover:border-grey-500',
            ].join(' ')}
          >
            {s.label}
          </button>
        ))}
      </div>

      {action.status === 'waiting' ? (
        <div
          className={[
            'mt-3 flex items-center justify-between gap-3 rounded-sm px-3 py-2 text-[12px]',
            stale ? 'bg-stale-bg text-stale' : 'bg-waiting-bg text-waiting',
          ].join(' ')}
        >
          <span>
            Waiting {days ?? 0} day{days === 1 ? '' : 's'}
            {stale ? ' — this has gone stale' : ''}
          </span>
          <button
            type="button"
            onClick={() =>
              startTransition(async () => {
                await nudgeWaiting(action.id);
              })
            }
            className="underline underline-offset-2"
          >
            Chased today
          </button>
        </div>
      ) : null}

      {action.status === 'next' || action.status === 'future' ? (
        <div className="mt-3 flex">
          <TurnIntoNextAction actionId={action.id} />
        </div>
      ) : null}

      {action.status === 'waiting' ? (
        <section className="mt-4">
          <WaitingOnField
            actionId={action.id}
            value={action.waitingOn}
            parties={parties}
          />
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          Contexts
        </h2>
        <div className="space-y-1.5">
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
                    const on = assigned.has(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          startTransition(async () => {
                            await toggleActionContext(action.id, c.id);
                          })
                        }
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
      </section>

      <section className="mt-7 border-t border-grey-150 pt-5">
        <NoteEditor
          key={action.id}
          initialContent={action.notes}
          placeholder="Notes on this action…"
          onSave={async (doc) => {
            await updateActionNotes(action.id, doc);
          }}
        />
      </section>

      <footer className="mt-8 border-t border-grey-150 pt-3">
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              await deleteAction(action.id);
              router.push(action.projectId ? `/projects/${action.projectId}` : '/now');
            })
          }
          className="text-[11px] text-grey-400 underline underline-offset-2 hover:text-stale"
        >
          Delete action
        </button>
      </footer>
    </div>
  );
}
