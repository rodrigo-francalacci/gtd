'use client';

/**
 * How long a thing you are filing right now is worth keeping.
 *
 * The same decision the document pane offers, moved to the moment it is
 * easiest to make: you are looking at the receipt, you know it is worth three
 * months, and saying so costs one tap. Coming back to a thousand filed
 * documents later to decide the same thing one at a time is the version nobody
 * does.
 *
 * Counted from today rather than from an arrival date, because here they are
 * the same thing — this is the arrival. That also means no preset can land in
 * the past, which is the case the document pane has to guard against.
 *
 * Default is Keep, and that stays true whatever else changes: a box exists to
 * keep things, and an expiry is the exception you opt into.
 */
export const LIFETIMES: { label: string; months: number | null }[] = [
  { label: 'Keep', months: null },
  { label: '3m', months: 3 },
  { label: '6m', months: 6 },
  { label: '1y', months: 12 },
  { label: '7y', months: 84 },
];

/** The date a lifetime resolves to, or null for "keep it". */
export function expiryFor(months: number | null): string | null {
  if (months === null) return null;

  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function LifetimePicker({
  months,
  onChange,
  disabled,
  label = 'Keep for',
}: {
  months: number | null;
  onChange: (months: number | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-grey-400">{label}</span>
      {LIFETIMES.map((o) => {
        const on = months === o.months;
        return (
          <button
            key={o.label}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            title={
              o.months === null
                ? 'Keep it indefinitely'
                : `Delete it after ${o.label.replace('m', ' months').replace('y', ' years')}`
            }
            onClick={() => onChange(o.months)}
            className={[
              'rounded-sm border px-1.5 py-px text-[11px]',
              on
                ? 'border-grey-700 bg-grey-700 text-paper'
                : 'border-grey-300 text-grey-600 hover:border-grey-500',
              disabled ? 'opacity-40' : '',
            ].join(' ')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
