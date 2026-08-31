'use client';

import { useState, useTransition } from 'react';
import { recordTopUp, setModelPrice } from '@/lib/actions';
import type { SpendLine, SpendSummary } from '@/lib/ai/spend';

/**
 * What the AI in this app is costing, and roughly what is left.
 *
 * **OpenAI will not say what is left**, which was measured rather than assumed:
 * with a project key every billing endpoint answers 403, including the legacy
 * route that used to return a credit balance and the whole Admin API. An admin
 * key would open the Admin API and even then reports spend, not remaining
 * credit.
 *
 * So this is a ledger the app keeps: every response carries exact token counts,
 * three places call the model, and the arithmetic is done here. It is an
 * **estimate and says so** — it cannot see anything spent outside this app, and
 * it prices tokens from a list you told it rather than from an invoice.
 */

const PURPOSES: Record<string, string> = {
  box: 'Reading documents',
  emoji: 'Choosing emoji',
  purchase: 'Reading receipts',
  link: 'Reading links',
  filename: 'Naming files',
};

/** Money, to the cent, because these are small numbers and rounding hides them. */
function money(value: number): string {
  return value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(2)}`;
}

function tokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function sum(lines: SpendLine[]): number | null {
  if (lines.length === 0) return 0;
  if (lines.some((line) => line.cost === null)) return null;
  return lines.reduce((t, line) => t + (line.cost ?? 0), 0);
}

export function AiSpend({
  summary,
  models,
  priced,
}: {
  summary: SpendSummary;
  /** Models this app has actually used, so the price form can offer them. */
  models: string[];
  priced: { model: string; input: number; cached: number; output: number }[];
}) {
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [showPrices, setShowPrices] = useState(false);

  const since = sum(summary.sinceTopUp);
  const left =
    summary.lastTopUp && since !== null ? summary.toppedUp - since : null;

  return (
    <div className="mt-3">
      {/*
        The headline, and it is a subtraction rather than a reading. Said as an
        estimate every time it is shown: a number that looks like a balance and
        is not would be the one thing here worth getting wrong.
      */}
      {summary.lastTopUp ? (
        <p className="text-[13px] text-grey-800">
          {left === null ? (
            <>Spent since your top-up: not priced yet — see below.</>
          ) : (
            <>
              About <span className="font-medium">{money(Math.max(0, left))}</span> left
              of the {money(summary.toppedUp)} you added on{' '}
              {summary.lastTopUp.at.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
              })}
              , with {money(since ?? 0)} spent since.
            </>
          )}
        </p>
      ) : (
        <p className="max-w-prose text-[12px] leading-relaxed text-grey-600">
          Tell it what you last put in and it can work out what is left.
        </p>
      )}

      <p className="mt-1 max-w-prose text-[11px] leading-relaxed text-grey-500">
        An estimate, not a balance. OpenAI does not let this app read the
        account — every billing endpoint refuses the key it has — so this counts
        the tokens this app spends and prices them from the list below. Anything
        you spend elsewhere on the same account is invisible to it.
      </p>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
        <div>
          <dt className="text-grey-500">Today</dt>
          <dd className="tabular-nums text-grey-800">
            {sum(summary.today) === null ? '—' : money(sum(summary.today) ?? 0)}
          </dd>
        </div>
        <div>
          <dt className="text-grey-500">This month</dt>
          <dd className="tabular-nums text-grey-800">
            {sum(summary.month) === null ? '—' : money(sum(summary.month) ?? 0)}
          </dd>
        </div>
      </dl>

      {/*
        Where it went, which is more useful than the total: the question behind
        "am I running out" is nearly always "what is eating it".
      */}
      {summary.month.length > 0 ? (
        <table className="mt-3 w-full max-w-lg text-[11px]">
          <thead>
            <tr className="text-left text-grey-500">
              <th className="font-normal">This month</th>
              <th className="font-normal">In</th>
              <th className="font-normal">Cached</th>
              <th className="font-normal">Out</th>
              <th className="text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody className="text-grey-700">
            {summary.month.map((line) => (
              <tr key={`${line.purpose} ${line.model}`}>
                <td className="py-0.5">{PURPOSES[line.purpose] ?? line.purpose}</td>
                <td className="tabular-nums">{tokens(line.inputTokens)}</td>
                <td className="tabular-nums">{tokens(line.cachedTokens)}</td>
                <td className="tabular-nums">{tokens(line.outputTokens)}</td>
                <td className="text-right tabular-nums">
                  {line.cost === null ? 'no price' : money(line.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-[12px] text-grey-500">
          Nothing spent this month.
        </p>
      )}

      {summary.unpriced.length > 0 ? (
        <p className="mt-2 max-w-prose text-[11px] leading-relaxed text-stale">
          No price recorded for {summary.unpriced.join(', ')} — its tokens are
          counted above but cannot be turned into money. Add it below, from
          OpenAI&rsquo;s pricing page.
        </p>
      ) : null}

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(amount);
          if (!Number.isFinite(value) || value <= 0) return;

          startTransition(async () => {
            await recordTopUp(value, note);
            setAmount('');
            setNote('');
          });
        }}
      >
        <label className="flex flex-col gap-0.5 text-[11px] text-grey-500">
          I just added
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="20"
            className="w-24 rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[12px] text-grey-800"
          />
        </label>

        <label className="flex flex-col gap-0.5 text-[11px] text-grey-500">
          Note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional"
            className="w-48 rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[12px] text-grey-800"
          />
        </label>

        <button
          type="submit"
          disabled={pending || !amount.trim()}
          className="rounded-sm border border-grey-300 px-2.5 py-1 text-[12px] text-grey-700 disabled:opacity-40"
        >
          Record it
        </button>
      </form>

      <button
        type="button"
        onClick={() => setShowPrices((open) => !open)}
        className="mt-3 text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
      >
        {showPrices ? 'Hide prices' : 'Prices per million tokens'}
      </button>

      {showPrices ? <Prices models={models} priced={priced} /> : null}
    </div>
  );
}

/**
 * The price list, typed in rather than shipped.
 *
 * Nothing is seeded with a guess: a made-up default is indistinguishable on
 * screen from a real one, and being confidently wrong about money is worse
 * than admitting a gap. The models offered are the ones this app has actually
 * used, so there is nothing to look up but the numbers.
 */
function Prices({
  models,
  priced,
}: {
  models: string[];
  priced: { model: string; input: number; cached: number; output: number }[];
}) {
  const [pending, startTransition] = useTransition();
  const known = new Map(priced.map((row) => [row.model, row]));

  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="max-w-prose text-[11px] leading-relaxed text-grey-500">
        From OpenAI&rsquo;s pricing page, in dollars per million tokens. Cached
        input is charged at a fraction of the ordinary rate and is counted
        separately above, so it needs its own figure.
      </p>

      {models.length === 0 ? (
        <p className="text-[11px] text-grey-500">
          No model has been used yet, so there is nothing to price.
        </p>
      ) : null}

      {models.map((model) => {
        const row = known.get(model);

        return (
          <form
            key={model}
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);

              startTransition(async () => {
                await setModelPrice(
                  model,
                  Number(data.get('input')),
                  Number(data.get('cached')),
                  Number(data.get('output')),
                );
              });
            }}
          >
            <span className="w-56 truncate text-[11px] text-grey-700">{model}</span>

            {(
              [
                ['input', 'In', row?.input],
                ['cached', 'Cached', row?.cached],
                ['output', 'Out', row?.output],
              ] as const
            ).map(([name, label, value]) => (
              <label
                key={name}
                className="flex flex-col gap-0.5 text-[10px] text-grey-500"
              >
                {label}
                <input
                  name={name}
                  defaultValue={value ?? ''}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-20 rounded-sm border border-grey-300 bg-paper px-1.5 py-0.5 text-[11px] tabular-nums text-grey-800"
                />
              </label>
            ))}

            <button
              type="submit"
              disabled={pending}
              className="rounded-sm border border-grey-300 px-2 py-0.5 text-[11px] text-grey-700 disabled:opacity-40"
            >
              Save
            </button>
          </form>
        );
      })}
    </div>
  );
}
