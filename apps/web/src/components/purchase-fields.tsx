'use client';

import type { PurchaseRead } from '@/lib/ai/purchase';
import { WHERE_LABELS, type PurchaseWhere } from '@/lib/queries.shared';

/**
 * What the share turned out to be selling, and the chance to correct it.
 *
 * Most of what reaches a phone as "I want this" is a link shared out of a shop
 * app, carrying the product name and the price in text nobody wants to retype.
 * Reading it is the difference between a list you keep and a list you stop
 * adding to.
 *
 * Everything here is editable, because everything here is a guess. A price is
 * the one field that must never be silently wrong — it goes into a budget
 * total and is believed — so it is shown as a number you can see and change
 * before it is written, not applied behind the post button.
 */
export function PurchaseFieldsPanel({
  text,
  read,
  reading,
  disabled,
  onRead,
  onChange,
}: {
  /** What is in the field, so the button can say whether there is anything to read. */
  text: string;
  read: PurchaseRead | null;
  reading: boolean;
  disabled?: boolean;
  onRead: () => void;
  onChange: (next: PurchaseRead) => void;
}) {
  if (!read) {
    return (
      <button
        type="button"
        disabled={disabled || reading || text.trim().length < 3}
        onClick={onRead}
        className="min-h-11 rounded-sm border border-grey-300 px-3 text-[14px] text-grey-700 disabled:opacity-40"
      >
        {reading ? 'Reading…' : 'Work out the price'}
      </button>
    );
  }

  const set = (patch: Partial<PurchaseRead>) => onChange({ ...read, ...patch });

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-grey-200 bg-grey-50 p-3">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-grey-500">Item</span>
        <input
          value={read.title}
          onChange={(e) => set({ title: e.target.value })}
          disabled={disabled}
          /* 16px, or iOS Safari zooms the page in when it takes focus. */
          className="min-h-11 rounded-sm border border-grey-300 bg-paper px-2 text-[16px] text-grey-900 focus:border-selected focus:outline-none"
        />
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-grey-500">Price</span>
          <input
            /* `decimal`, not `numeric`: this is money and wants a point. */
            inputMode="decimal"
            value={read.cost ?? ''}
            placeholder="—"
            onChange={(e) => {
              const value = e.target.value.trim();
              const n = Number(value);
              set({ cost: value === '' || !Number.isFinite(n) ? null : n });
            }}
            disabled={disabled}
            className="min-h-11 rounded-sm border border-grey-300 bg-paper px-2 text-[16px] tabular-nums text-grey-900 focus:border-selected focus:outline-none"
          />
        </label>

        <div className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-grey-500">Where</span>
          <div className="flex gap-1">
            {(Object.keys(WHERE_LABELS) as PurchaseWhere[]).map((w) => (
              <button
                key={w}
                type="button"
                disabled={disabled}
                aria-pressed={read.where === w}
                // Pressing the one already chosen clears it: "it doesn't say"
                // is a real answer and must stay reachable.
                onClick={() => set({ where: read.where === w ? null : w })}
                className={[
                  'min-h-11 flex-1 rounded-sm border px-2 text-[13px]',
                  read.where === w
                    ? 'border-grey-800 bg-grey-800 text-paper'
                    : 'border-grey-300 text-grey-600',
                ].join(' ')}
              >
                {WHERE_LABELS[w]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {read.url ? (
        <p className="truncate text-[11px] text-grey-500" title={read.url}>
          Link kept in the note: {read.url}
        </p>
      ) : null}
    </div>
  );
}
