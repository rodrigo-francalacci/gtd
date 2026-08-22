'use client';

import Link from 'next/link';
import {
  IMPACT_LABELS,
  WHERE_LABELS,
  formatMoney,
  type ListItemRow,
  type PurchaseImpact,
} from '@/lib/queries.shared';
import { useBudgetTrial } from './budget-trial';

/**
 * Budget view over a Purchases list.
 *
 * The three buckets come from `stage`, which is derived from whether an item
 * has been promoted and what happened to the resulting action. They are
 * mutually exclusive, so a given item contributes to exactly one total — that
 * is what stops proposed and committed spend double-counting.
 */
export function BudgetSummary({
  items,
  filters,
  basePath,
}: {
  items: ListItemRow[];
  filters: { impact?: string; where?: string };
  basePath: string;
}) {
  const costOf = (i: ListItemRow) => i.fields?.cost ?? 0;
  const sum = (rows: ListItemRow[]) => rows.reduce((n, i) => n + costOf(i), 0);

  const proposed = items.filter((i) => i.stage === 'candidate');
  const committed = items.filter((i) => i.stage === 'committed');
  const settled = items.filter((i) => i.stage === 'settled');

  const missingCost = items.filter(
    (i) => i.stage !== 'settled' && typeof i.fields?.cost !== 'number',
  ).length;

  const byImpact = (Object.keys(IMPACT_LABELS) as PurchaseImpact[])
    .map((key) => ({
      key,
      label: IMPACT_LABELS[key],
      total: sum([...proposed, ...committed].filter((i) => i.fields?.impact === key)),
      count: [...proposed, ...committed].filter((i) => i.fields?.impact === key).length,
    }))
    .filter((r) => r.count > 0);

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { ...filters, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div>
      <h1 className="text-xl font-semibold text-grey-900">Budget</h1>
      <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-grey-600">
        Proposed spend is what you are still only considering. Committed spend is
        what you have decided on — the action exists, and once ordered it sits in
        Waiting For. An item counts in one column or the other, never both.
      </p>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <Tile
          label="Proposed"
          note={`${proposed.length} candidate${proposed.length === 1 ? '' : 's'}`}
          amount={sum(proposed)}
        />
        <Tile
          label="Committed"
          note={`${committed.length} promoted`}
          amount={sum(committed)}
          emphasis
        />
        <Tile
          label="Already spent"
          note={`${settled.length} done`}
          amount={sum(settled)}
          muted
        />
      </div>

      {missingCost > 0 ? (
        <p className="mt-3 text-[11px] text-stale">
          {missingCost} open item{missingCost === 1 ? ' has' : 's have'} no cost set —
          the totals above are lower than reality.
        </p>
      ) : null}

      <WhatIf candidates={proposed} committed={sum(committed)} />

      {byImpact.length > 0 ? (
        <section className="mt-7">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
            Open spend by impact
          </h2>
          <table className="w-full max-w-md text-[13px]">
            <tbody>
              {byImpact.map((r) => (
                <tr key={r.key} className="border-b border-grey-150">
                  <td className="py-1.5 text-grey-700">{r.label}</td>
                  <td className="py-1.5 text-right text-[11px] text-grey-500">
                    {r.count}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-grey-800">
                    {formatMoney(r.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="mt-7">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          Filter the list
        </h2>
        <div className="space-y-1.5">
          <FilterRow
            label="Impact"
            active={filters.impact}
            options={Object.entries(IMPACT_LABELS)}
            link={(v) => link({ impact: v })}
          />
          <FilterRow
            label="Where"
            active={filters.where}
            options={Object.entries(WHERE_LABELS)}
            link={(v) => link({ where: v })}
          />
        </div>
        {filters.impact || filters.where ? (
          <Link
            href={basePath}
            className="mt-2 inline-block text-[11px] text-grey-500 underline underline-offset-2"
          >
            Clear filters
          </Link>
        ) : null}
      </section>
    </div>
  );
}

/**
 * What a combination would cost, before any of it is real.
 *
 * The three tiles above are a report on decisions already taken. This is the
 * question you actually have on a purchases list — *can I do these two and
 * that one?* — and until now the only way to ask it was to promote them and
 * undo it afterwards, which creates actions, files them on projects and leaves
 * a trail through Waiting For. Nobody does that to check a total.
 *
 * Shown even with nothing ticked, because a control that only appears once you
 * have used it cannot be discovered. Empty, it is one line explaining itself.
 */
function WhatIf({
  candidates,
  committed,
}: {
  candidates: ListItemRow[];
  committed: number;
}) {
  const trial = useBudgetTrial();
  if (!trial) return null;

  const picked = candidates.filter((i) => trial.picked.has(i.id));
  const trying = picked.reduce((n, i) => n + (i.fields?.cost ?? 0), 0);
  const noCost = picked.filter((i) => typeof i.fields?.cost !== 'number').length;

  return (
    <section className="mt-7 rounded-sm border border-grey-200 bg-grey-50 px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          What if
        </h2>
        {picked.length > 0 ? (
          <button
            type="button"
            onClick={trial.clear}
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            Clear
          </button>
        ) : null}
      </div>

      {picked.length === 0 ? (
        <p className="mt-1.5 text-[12px] leading-relaxed text-grey-500">
          Tick candidates in the list to cost a combination. Nothing is promoted
          and nothing is saved — it is only arithmetic.
        </p>
      ) : (
        <>
          <table className="mt-2 w-full text-[12px]">
            <tbody>
              <Line label="Committed already" amount={committed} />
              <Line
                label={
                  picked.length === 1
                    ? 'This candidate'
                    : `These ${picked.length} candidates`
                }
                amount={trying}
              />
              <Line label="Would commit" amount={committed + trying} total />
            </tbody>
          </table>

          <ul className="mt-2.5 space-y-0.5">
            {picked.map((i) => (
              <li key={i.id} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[11px] text-grey-600">
                  {i.title}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-grey-500">
                  {typeof i.fields?.cost === 'number' ? formatMoney(i.fields.cost) : '—'}
                </span>
              </li>
            ))}
          </ul>

          {noCost > 0 ? (
            <p className="mt-2 text-[11px] text-stale">
              {noCost} of these {noCost === 1 ? 'has' : 'have'} no cost set, so the
              figure is lower than reality.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function Line({
  label,
  amount,
  total = false,
}: {
  label: string;
  amount: number;
  total?: boolean;
}) {
  return (
    <tr className={total ? 'border-t border-grey-300' : ''}>
      <td
        className={[
          'py-1',
          total ? 'font-medium text-grey-800' : 'text-grey-600',
        ].join(' ')}
      >
        {label}
      </td>
      <td
        className={[
          'py-1 text-right tabular-nums',
          total ? 'text-[15px] font-medium text-grey-900' : 'text-grey-700',
        ].join(' ')}
      >
        {formatMoney(amount)}
      </td>
    </tr>
  );
}

function Tile({
  label,
  note,
  amount,
  emphasis = false,
  muted = false,
}: {
  label: string;
  note: string;
  amount: number;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={[
        'rounded-sm border px-3 py-2.5',
        emphasis ? 'border-waiting/40 bg-waiting-bg' : 'border-grey-200 bg-grey-50',
      ].join(' ')}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
        {label}
      </div>
      <div
        className={[
          'mt-1 text-lg tabular-nums',
          muted ? 'text-grey-400' : emphasis ? 'text-waiting' : 'text-grey-900',
        ].join(' ')}
      >
        {formatMoney(amount)}
      </div>
      <div className="text-[11px] text-grey-500">{note}</div>
    </div>
  );
}

function FilterRow({
  label,
  active,
  options,
  link,
}: {
  label: string;
  active: string | undefined;
  options: [string, string][];
  link: (value: string | undefined) => string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-12 shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map(([key, text]) => {
          const on = active === key;
          return (
            <Link
              key={key}
              href={link(on ? undefined : key)}
              className={[
                'rounded-sm border px-1.5 py-px text-[11px]',
                on
                  ? 'border-selected bg-selected-bg font-medium text-selected'
                  : 'border-grey-300 bg-paper text-grey-600 hover:border-grey-400',
              ].join(' ')}
            >
              {text}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
