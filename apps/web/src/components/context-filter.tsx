'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { Context } from '@gtd/db';

/**
 * The filter bar for "what can I do now". Selection lives in the URL so a
 * filtered view is linkable and survives a refresh.
 *
 * Two taps to adjust, per the brief: one to drop a dimension, one to pick
 * another value.
 */
export function ContextFilter({
  groups,
}: {
  groups: { time: Context[]; energy: Context[]; person: Context[] };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = new Set(searchParams.getAll('ctx'));

  const toggle = (id: string) => {
    const next = new URLSearchParams(searchParams);
    const current = next.getAll('ctx');
    next.delete('ctx');
    const updated = current.includes(id)
      ? current.filter((c) => c !== id)
      : [...current, id];
    updated.forEach((c) => next.append('ctx', c));
    router.replace(next.toString() ? `/now?${next}` : '/now', { scroll: false });
  };

  const clear = () => router.replace('/now', { scroll: false });

  const dimensions: { key: keyof typeof groups; label: string }[] = [
    { key: 'time', label: 'Time' },
    { key: 'energy', label: 'Energy' },
    { key: 'person', label: 'Who' },
  ];

  return (
    <div className="space-y-1.5">
      {dimensions.map(({ key, label }) => {
        const items = groups[key];
        if (items.length === 0) return null;

        return (
          <div key={key} className="flex items-baseline gap-2">
            <span className="w-11 shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
              {label}
            </span>
            <div className="flex flex-wrap gap-1">
              {items.map((c) => {
                const on = selected.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className={[
                      'rounded-sm border px-1.5 py-px text-[11px]',
                      on
                        ? 'border-selected bg-selected-bg font-medium text-selected'
                        : 'border-grey-300 bg-paper text-grey-600 hover:border-grey-400',
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

      {selected.size > 0 ? (
        <button
          type="button"
          onClick={clear}
          className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-700"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
