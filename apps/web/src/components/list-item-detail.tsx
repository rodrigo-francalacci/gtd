'use client';

import Link from 'next/link';
import { EmojiPicker } from './emoji-picker';
import { useState, useTransition } from 'react';
import type { ListOrder } from '@/lib/file-lists';
import {
  deleteListItem,
  promoteListItem,
  setListItemProject,
  unpromoteListItem,
  updateListItemFields,
  updateListItemNotes,
  updateListItemTitle,
} from '@/lib/actions';
import {
  IMPACT_LABELS,
  WHERE_LABELS,
  formatMoney,
  type ListItemRow as Row,
  type PurchaseImpact,
  type PurchaseWhere,
  type AttachmentRow,
  type LinkedDocumentRow,
} from '@/lib/queries.shared';
import { Attachments } from './attachments';
import { LinkedDocuments } from './linked-documents';
import { NoteEditor } from './note-editor';

export function ListItemDetail({
  item,
  attachments,
  fileOrder,
  documents,
  docOrder,
  documentOptions,
  isPurchases,
  projectOptions,
}: {
  item: Row;
  attachments: AttachmentRow[];
  documents: LinkedDocumentRow[];
  /** How each of the two file lists is ordered. Separate choices. */
  fileOrder?: ListOrder;
  docOrder?: ListOrder;
  documentOptions: LinkedDocumentRow[];
  isPurchases: boolean;
  projectOptions: { id: string; title: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(item.title);
  const [cost, setCost] = useState(
    item.fields?.cost === undefined ? '' : String(item.fields.cost),
  );

  const run = (fn: () => Promise<unknown>) => startTransition(() => void fn());

  const saveCost = () => {
    const trimmed = cost.trim();
    const parsed = trimmed === '' ? undefined : Number(trimmed);
    if (parsed !== undefined && Number.isNaN(parsed)) return;
    run(() => updateListItemFields(item.id, { cost: parsed }));
  };

  return (
    <div className={pending ? 'opacity-60' : ''}>
      {/* Beside the title, because it belongs to the row rather than to any of
          the fields below it — and because this is where you are already
          looking when you decide the model got it wrong. */}
      <div className="flex items-center gap-2">
        <EmojiPicker target="list_items" id={item.id} emoji={item.emoji ?? null} label="item" />
        <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title.trim() && title !== item.title) {
            run(() => updateListItemTitle(item.id, title));
          }
        }}
        className="min-w-0 flex-1 border-none bg-transparent text-xl font-semibold text-grey-900 focus:outline-none"
        />
      </div>

      {/* The candidate/commitment distinction is the whole point of a list. */}
      <div className="mt-3 rounded-sm border border-grey-200 bg-grey-50 px-3 py-2.5">
        {item.stage === 'candidate' ? (
          <>
            <p className="text-[12px] text-grey-600">
              This is a candidate, not a commitment. Nothing happens until you
              promote it.
            </p>
            <button
              type="button"
              onClick={() => run(() => promoteListItem(item.id))}
              className="mt-2 rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper"
            >
              {isPurchases ? 'Promote to a “Buy…” action' : 'Promote to an action'}
            </button>
          </>
        ) : (
          <>
            <p className="text-[12px] text-grey-600">
              {item.stage === 'settled'
                ? 'The action for this is done.'
                : 'Promoted — this is a real commitment now.'}
              {isPurchases && item.stage === 'committed'
                ? ' It counts as committed spend, not proposed.'
                : ''}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <Link
                href={`/now?action=${item.promotedActionId}`}
                className="text-[11px] text-selected underline underline-offset-2"
              >
                Open the action
              </Link>
              <button
                type="button"
                onClick={() => run(() => unpromoteListItem(item.id))}
                className="text-[11px] text-grey-500 underline underline-offset-2"
              >
                Detach (back to candidate)
              </button>
            </div>
          </>
        )}
      </div>

      {isPurchases ? (
        <section className="mt-6 space-y-4">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
              Cost
            </label>
            <input
              value={cost}
              inputMode="decimal"
              onChange={(e) => setCost(e.target.value)}
              onBlur={saveCost}
              onKeyDown={(e) => e.key === 'Enter' && saveCost()}
              placeholder="0"
              className="mt-1 w-32 rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] tabular-nums focus:border-grey-500 focus:outline-none"
            />
            {typeof item.fields?.cost === 'number' ? (
              <span className="ml-2 text-[11px] text-grey-500">
                {formatMoney(item.fields.cost)}
              </span>
            ) : null}
          </div>

          <Choice
            label="Impact"
            value={item.fields?.impact}
            options={Object.entries(IMPACT_LABELS) as [PurchaseImpact, string][]}
            onPick={(v) => run(() => updateListItemFields(item.id, { impact: v }))}
          />

          <Choice
            label="Where"
            value={item.fields?.where}
            options={Object.entries(WHERE_LABELS) as [PurchaseWhere, string][]}
            onPick={(v) => run(() => updateListItemFields(item.id, { where: v }))}
          />
        </section>
      ) : null}

      <section className="mt-6">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          Project
        </label>
        <select
          value={item.projectId ?? ''}
          onChange={(e) =>
            run(() => setListItemProject(item.id, e.target.value || null))
          }
          className="mt-1 w-full max-w-sm rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
        >
          <option value="">No project</option>
          {projectOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </section>

      <section className="mt-6">
        <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          Notes
        </h2>
        {/* key: the editor must not resync from props on autosave, so switching
            items is handled by remounting rather than by an effect. */}
        <NoteEditor
          key={item.id}
          surface="list_item"
          id={item.id}
          height={item.noteHeight ?? null}
          dense={item.noteDense ?? null}
          initialContent={item.notes}
          placeholder="Why this is here, what it depends on…"
          onSave={async (doc) => {
            await updateListItemNotes(item.id, doc);
          }}
        />
      </section>

      <Attachments
        parentType="list_item"
        parentId={item.id}
        rows={attachments}
        label="Photos & files"
        sort={fileOrder?.sort}
        sortKey={fileOrder?.viewKey}
        groups={fileOrder?.groups}
      />

      <LinkedDocuments
        parentType="list_item"
        parentId={item.id}
        rows={documents}
        candidates={documentOptions}
        sort={docOrder?.sort}
        sortKey={docOrder?.viewKey}
        groups={docOrder?.groups}
      />


      <LinkedDocuments
        only="emails"
        parentType="list_item"
        parentId={item.id}
        rows={documents}
        candidates={documentOptions}
      />

      <footer className="mt-8 border-t border-grey-150 pt-3">
        <button
          type="button"
          onClick={() => run(() => deleteListItem(item.id))}
          className="text-[11px] text-grey-400 underline underline-offset-2 hover:text-stale"
        >
          Delete item
        </button>
      </footer>
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T | undefined;
  options: [T, string][];
  onPick: (value: T | undefined) => void;
}) {
  return (
    <div>
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
        {label}
      </span>
      <div className="mt-1 flex flex-wrap gap-1">
        {options.map(([key, text]) => {
          const on = value === key;
          return (
            <button
              key={key}
              type="button"
              // Clicking the active choice clears it.
              onClick={() => onPick(on ? undefined : key)}
              className={[
                'rounded-sm border px-2 py-1 text-[11px]',
                on
                  ? 'border-grey-800 bg-grey-800 text-paper'
                  : 'border-grey-300 text-grey-600 hover:border-grey-500',
              ].join(' ')}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
