import Link from 'next/link';
import {
  IMPACT_LABELS,
  WHERE_LABELS,
  formatMoney,
  type ListItemRow,
  type PurchaseImpact,
} from '@/lib/queries.shared';

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
