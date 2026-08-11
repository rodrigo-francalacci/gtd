'use client';

import { useId, useState, useTransition } from 'react';
import { setWaitingOn } from '@/lib/actions';

/**
 * Who or what you're waiting on.
 *
 * The suggestions are the parties already in the system, offered through a
 * native `datalist` — typing "ne" surfaces "Neil" so you pick the existing
 * one instead of minting a near-duplicate. It stays a free text field rather
 * than a select because the first time you wait on someone they don't exist
 * yet, and being forced to create them elsewhere first would be friction at
 * exactly the wrong moment.
 *
 * The server matches case-insensitively regardless, so typing "neil" still
 * resolves to the existing "Neil".
 */
export function WaitingOnField({
  actionId,
  value,
  parties,
}: {
  actionId: string;
  value: string | null;
  parties: string[];
}) {
  const listId = useId();
  const [draft, setDraft] = useState(value ?? '');
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (draft.trim() === (value ?? '').trim()) return;
    startTransition(async () => void setWaitingOn(actionId, draft));
  };

  return (
    <div className={pending ? 'opacity-60' : ''}>
      <label
        htmlFor={`waiting-on-${listId}`}
        className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500"
      >
        Waiting on
      </label>

      <input
        id={`waiting-on-${listId}`}
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        placeholder="Who or what?"
        autoComplete="off"
        className="mt-1 w-full max-w-xs rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
      />

      <datalist id={listId}>
        {parties.map((party) => (
          <option key={party} value={party} />
        ))}
      </datalist>

      {value ? (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            startTransition(async () => void setWaitingOn(actionId, ''));
          }}
          className="mt-1 text-[11px] text-grey-500 underline underline-offset-2"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
