'use client';

import type { ListOrder } from '@/lib/file-lists';
import { EmojiPicker } from './emoji-picker';
import type { Context } from '@gtd/db';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  deleteAction,
  moveActionToProject,
  nudgeWaiting,
  setActionStatus,
  toggleActionContext,
  updateActionNotes,
  updateActionTitle,
} from '@/lib/actions';
import {
  daysSince,
  isStale,
  type AttachmentRow,
  type LinkedDocumentRow,
} from '@/lib/queries.shared';
import { Attachments } from './attachments';
import { MoveTo } from './move-to';
import { LinkedDocuments } from './linked-documents';
import { NoteEditor } from './note-editor';
import { TurnIntoNextAction } from './turn-into-next';
import { WaitingOnField } from './waiting-on-field';

type ActionDetailData = {
  /** Its emoji, or null. Editable here whatever the model chose. */
  emoji: string | null;
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
  attachments,
  fileOrder,
  documents,
  docOrder,
  documentOptions,
  contextGroups,
  parties,
  projects = [],
}: {
  action: ActionDetailData;
  /** Projects it could be filed under. Empty hides the control. */
  projects?: { id: string; title: string }[];
  attachments: AttachmentRow[];
  documents: LinkedDocumentRow[];
  /** How each of the two file lists is ordered. Separate choices. */
  fileOrder?: ListOrder;
  docOrder?: ListOrder;
  documentOptions: LinkedDocumentRow[];
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
      {/* Beside the title, because it belongs to the row rather than to any of
          the fields below it — and because this is where you are already
          looking when you decide the model got it wrong. */}
      <div className="flex items-center gap-2">
        <EmojiPicker target="actions" id={action.id} emoji={action.emoji ?? null} label="action" />
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
        className="min-w-0 flex-1 border-none bg-transparent text-xl font-semibold text-grey-900 focus:outline-none"
        />
      </div>

      {/* Filing was a drag onto a project row, which touch cannot do at all —
          so the project line is now also where you change it. Same Server
          Action the drag calls. */}
      <div className="mt-1 flex items-baseline justify-between gap-2">
        {action.projectTitle ? (
          /*
           * The project line is a way *to* the project as well as a label.
           *
           * An action is nearly always read as one step of something larger,
           * and the question it raises — what else is on this — was three
           * clicks away through the sidebar, with the project's name already on
           * screen the whole time. Underlined only on hover, because it sits
           * under the title as a fact about the row first and a link second.
           */
          <Link
            href={`/projects/${action.projectId}`}
            className="truncate text-[12px] text-grey-500 hover:text-grey-800 hover:underline"
          >
            {action.projectTitle}
          </Link>
        ) : (
          <p className="text-[12px] text-grey-400">No project — standalone action</p>
        )}

        {projects.length > 0 ? (
          <MoveTo
            label="File"
            current={action.projectId}
            options={[
              { id: null, name: 'No project', hint: 'A standalone next action' },
              ...projects.map((p) => ({ id: p.id, name: p.title })),
            ]}
            onMove={(projectId) => moveActionToProject(action.id, projectId)}
          />
        ) : null}
      </div>

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

      <Attachments
        parentType="action"
        parentId={action.id}
        rows={attachments}
        sort={fileOrder?.sort}
        sortKey={fileOrder?.viewKey}
        groups={fileOrder?.groups}
        moveUpTo={action.projectTitle}
      />

      <LinkedDocuments
        parentType="action"
        parentId={action.id}
        rows={documents}
        candidates={documentOptions}
        sort={docOrder?.sort}
        sortKey={docOrder?.viewKey}
        groups={docOrder?.groups}
        moveUpTo={action.projectTitle}
      />


      <LinkedDocuments
        only="emails"
        parentType="action"
        parentId={action.id}
        rows={documents}
        candidates={documentOptions}
        moveUpTo={action.projectTitle}
      />

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
