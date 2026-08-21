'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { setActionStatus } from '@/lib/actions';
import type { ActionRow } from '@/lib/queries.shared';

type ContextRow = { id: string; name: string; dimension: string };

/**
 * Next actions, filtered by where you are and what you have.
 *
 * The desktop filter bar is a row of small text links along a subtitle; here
 * the same choices are thumb-sized chips that scroll sideways, because the
 * filter is the *primary* interaction on a phone rather than a refinement of
 * a list you are already reading.
 *
 * Ticking one off is a checkbox and nothing else — no drag, no menu, no
 * swipe. Swipe-to-complete is the obvious phone gesture and the wrong one for
 * this: it is undoable only if you notice, and the list this acts on is a list
 * of promises.
 */
export function MobileNow({
  groups,
  actions,
  selected,
}: {
  groups: Record<string, ContextRow[]>;
  actions: ActionRow[];
  selected: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const dimensions: { key: string; label: string }[] = [
    { key: 'place', label: 'Where' },
    { key: 'time', label: 'Time' },
    { key: 'energy', label: 'Energy' },
  ];

  const hrefFor = (id: string) => {
    const next = new URLSearchParams(params);
    const current = next.getAll('ctx');
    next.delete('ctx');

    for (const value of current.includes(id)
      ? current.filter((c) => c !== id)
      : [...current, id]) {
      next.append('ctx', value);
    }

    const query = next.toString();
    return query ? `/m/now?${query}` : '/m/now';
  };

  return (
    <div className="flex flex-col">
      {dimensions.map(({ key, label }) => {
        const rows = groups[key] ?? [];
        // A dimension you have never filled in is not a filter, and an empty
        // heading is worse than an absent one on a screen this size.
        if (rows.length === 0) return null;

        return (
          <div key={key} className="flex flex-col gap-1 px-4 pb-2">
            <span className="text-[10px] uppercase tracking-wider text-grey-500">
              {label}
            </span>
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
              {rows.map((row) => {
                const on = selected.includes(row.id);
                return (
                  <Link
                    key={row.id}
                    href={hrefFor(row.id)}
                    scroll={false}
                    className={[
                      'flex min-h-11 shrink-0 items-center rounded-full px-4 text-[14px]',
                      on
                        ? 'bg-selected-bg font-medium text-selected'
                        : 'bg-grey-150 text-grey-600',
                    ].join(' ')}
                  >
                    {row.name}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      <ul className="mt-2 flex flex-col border-t border-grey-150">
        {actions.length === 0 ? (
          <li className="px-4 py-6 text-[13px] leading-relaxed text-grey-500">
            {selected.length > 0
              ? 'Nothing matches that combination. Loosen a filter.'
              : 'No next actions. Either you are done, or something needs clarifying.'}
          </li>
        ) : (
          actions.map((action) => (
            <li
              key={action.id}
              className="flex items-start gap-3 border-b border-grey-150 px-4 py-3"
            >
              {/* A real checkbox, sized for a thumb rather than a cursor. */}
              <input
                type="checkbox"
                aria-label={`Done: ${action.title}`}
                disabled={pending}
                onChange={() =>
                  startTransition(async () => {
                    await setActionStatus(action.id, 'done');
                    router.refresh();
                  })
                }
                className="mt-0.5 h-5 w-5 shrink-0"
              />

              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] leading-snug text-grey-800">
                  {action.title}
                </span>

                {action.projectTitle || action.contexts.length > 0 ? (
                  <span className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-grey-500">
                    {action.projectTitle ? <span>{action.projectTitle}</span> : null}
                    {action.contexts.map((c) => (
                      <span key={c.id} className="text-grey-400">
                        {c.name}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
