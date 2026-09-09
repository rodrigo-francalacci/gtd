'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { deferAction, scheduleAction, setActionBlocker } from '@/lib/actions';

/**
 * The two questions about *when*, which the app had no answer for until now.
 *
 * They look alike and are opposites. **Do it** is a commitment: I will be
 * doing this at three on Tuesday, and the row lifts to the top of the list
 * when that day comes. **Not until** is a suppression: this is not relevant
 * before March, so take it off the one list that answers "what could I do
 * right now" and give it back to me on the day.
 *
 * Keeping them apart matters more than the space it costs. Most of what
 * clutters a next-actions list is not unscheduled, it is not-yet-relevant, and
 * a single date field would let you say one thing when you meant the other —
 * booking a slot for something you were trying to hide, or hiding something
 * you were trying to book.
 *
 * Nothing here reaches Google. See `scheduleAction` for why that is the design
 * rather than a limitation.
 */
export function ActionWhen({
  actionId,
  scheduledAt,
  scheduledEnd,
  deferUntil,
  blockedBy,
  blockers,
}: {
  actionId: string;
  scheduledAt: Date | null;
  scheduledEnd: Date | null;
  deferUntil: string | null;
  /** The step this one waits on, if any. */
  blockedBy: string | null;
  /**
   * What it could sensibly wait on — its project's other steps, or the other
   * loose ones. Empty means there is nothing to choose from and the row says
   * so rather than offering a picker with one blank entry in it.
   */
  blockers: { id: string; title: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (work: () => Promise<unknown>) =>
    startTransition(async () => {
      await work();
      router.refresh();
    });

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
        When
      </h2>

      <div className="space-y-1.5 text-[12px]">
        <Row
          label="Do it"
          /*
           * A moment, so `datetime-local`. Saved on blur rather than on change,
           * which is the lesson a document's arrival date paid for: `onChange`
           * fires on every segment a native picker touches, and saving there
           * re-renders the list underneath the picker and shuts it — one click
           * before it closes, so setting a time is impossible.
           */
          input={
            <input
              /*
               * Keyed on the stored value, or clearing it leaves the old date
               * sitting in the field.
               *
               * `defaultValue` is read once, at mount. `router.refresh()`
               * re-renders the pane with the new props and React keeps the
               * same input element, which holds whatever the DOM last had —
               * so pressing Clear wrote null to the database and changed
               * nothing on screen. Verified by reading the row back: the write
               * was right and only the field was lying. The same trap panels
               * seeded from props solve with `key={row.id}`.
               */
              key={scheduledAt ? scheduledAt.toISOString() : 'none'}
              type="datetime-local"
              defaultValue={scheduledAt ? localInput(scheduledAt) : ''}
              disabled={pending}
              aria-label="Do it at"
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const value = e.target.value;
                const was = scheduledAt ? localInput(scheduledAt) : '';
                if (value === was) return;
                if (!value) return run(() => scheduleAction(actionId, null));

                run(() =>
                  scheduleAction(
                    actionId,
                    new Date(value).toISOString(),
                    scheduledEnd ? scheduledEnd.toISOString() : null,
                  ),
                );
              }}
              className={FIELD}
            />
          }
          onClear={scheduledAt ? () => run(() => scheduleAction(actionId, null)) : null}
          pending={pending}
          note={
            scheduledAt
              ? scheduledEnd
                ? `until ${clock.format(scheduledEnd)}`
                : null
              : 'a slot you mean to keep'
          }
        />

        <Row
          label="Not until"
          /*
           * A day, so `date`. Nobody defers something to half past two, and the
           * column is a `date` for the same reason — it is compared against the
           * server's day, which is where every other date here is cut.
           */
          input={
            <input
              key={deferUntil ?? 'none'}
              type="date"
              defaultValue={deferUntil ?? ''}
              disabled={pending}
              aria-label="Not until"
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const value = e.target.value;
                if (value === (deferUntil ?? '')) return;
                run(() => deferAction(actionId, value || null));
              }}
              className={FIELD}
            />
          }
          onClear={deferUntil ? () => run(() => deferAction(actionId, null)) : null}
          pending={pending}
          note={deferUntil ? 'hidden from Now until then' : 'off the list until the day'}
        />

        {/*
          The third "when", and the one that is not a date.
          
          It belongs beside the other two because it answers the same question
          — is this available yet — and putting it in a section of its own
          would make a dependency feel like a bigger commitment than it is. It
          is one fact about one step, stated once, at the moment you notice it.
        */}
        <Row
          label="After"
          input={
            blockers.length === 0 ? (
              <span className="text-[11px] text-grey-400">
                {/* Honest about *why* there is nothing, or it reads as broken. */}
                No other step here to wait on.
              </span>
            ) : (
              <select
                value={blockedBy ?? ''}
                disabled={pending}
                aria-label="Waits for"
                onChange={(e) =>
                  run(() => setActionBlocker(actionId, e.target.value || null))
                }
                className={FIELD}
              >
                <option value="">— nothing —</option>
                {blockers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            )
          }
          onClear={blockedBy ? () => run(() => setActionBlocker(actionId, null)) : null}
          pending={pending}
          note={blockedBy ? 'off the list until that is done' : null}
        />
      </div>
    </section>
  );
}

const FIELD =
  'rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-[12px] ' +
  'text-grey-700 hover:border-grey-300 focus:border-grey-400 focus:outline-none ' +
  'disabled:opacity-50';

function Row({
  label,
  input,
  onClear,
  pending,
  note,
}: {
  label: string;
  input: React.ReactNode;
  /** Null when there is nothing set, so there is nothing to take away. */
  onClear: (() => void) | null;
  pending: boolean;
  note: string | null;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {input}
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            disabled={pending}
            className="text-[11px] text-grey-400 underline underline-offset-2 hover:text-grey-700 disabled:opacity-40"
          >
            Clear
          </button>
        ) : null}
        {note ? <span className="text-[11px] text-grey-400">{note}</span> : null}
      </div>
    </div>
  );
}

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * What `datetime-local` wants: `YYYY-MM-DDTHH:mm`, local and zoneless.
 * `toISOString` is UTC and would shift the value every time the pane rendered.
 */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
