'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  acceptTagSuggestion,
  clearTagSuggestions,
  dismissTagSuggestion,
  suggestBoxTags,
} from '@/lib/actions';
import type { BoxTagSuggestion } from '@/lib/queries.shared';
import { tagKey } from '@/lib/box/suggest-clean';

/**
 * A vocabulary the model has proposed, one proposal at a time.
 *
 * It sits at the top of the tag panel because that is where the question is
 * already being asked — you open that column to look at a box's tags, and the
 * hardest moment is the first one, when there are none and two hundred filed
 * documents to invent them from.
 *
 * **Each proposal is judged on its own**, which is the whole shape of it. An
 * "accept all" would be the model deciding a filing system and telling you
 * afterwards; the panel that pays for itself is one that says *forty of these
 * look like receipts, is that an axis* and takes no for an answer. Widest
 * first, because a tag covering forty entries is a decision about the box and
 * one covering two is a detail you take or leave once the shape is settled.
 *
 * **Accepting makes the tag and tags nothing.** The model is answering "what
 * are the axes here", which is a reading of the whole box; whether *this*
 * document is a receipt is a different and much easier question, and one you
 * answer at a glance or hand to the classifier. Putting a vocabulary onto two
 * hundred documents off the press that invented it would be the app asking to
 * be trusted with exactly what it has always been careful not to do.
 *
 * So the counts and titles on each row are **evidence, not a preview of a
 * write**. They are there because a word proposed with nothing behind it
 * cannot be told from a good one, and the panel says outright that nothing is
 * being tagged — a number beside a button is otherwise read as what the button
 * is about to do.
 */
export function TagSuggestions({
  boxId,
  suggestions,
  readCount,
  totalCount,
  asked,
  existingCategories,
}: {
  boxId: string;
  /** Empty with `asked` set means the set has been worked through. */
  suggestions: BoxTagSuggestion[];
  readCount: number;
  totalCount: number;
  /** Whether anybody has ever pressed the button for this box. */
  asked: boolean;
  /**
   * The axes the box has right now, so "new" can be worked out rather than
   * remembered.
   *
   * It was stored on each proposal at the moment the set was made, and went
   * stale the instant one was accepted: taking "Document type · Webpage"
   * creates that axis, and "Document type · Article" underneath it went on
   * claiming it would make one. Derived state is derived — the panel already
   * has the live vocabulary a few lines up, because that is what it is for.
   */
  existingCategories: string[];
}) {
  const known = new Set(existingCategories.map(tagKey));
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const router = useRouter();

  /*
   * Which one row is being dealt with, so only its own buttons go quiet. A
   * single `pending` would grey the whole list on every press, which in a panel
   * you work down is the thing that makes it feel slow.
   */
  const [busy, setBusy] = useState<string | null>(null);

  const run = (key: string | null, work: () => Promise<unknown>) => {
    setBusy(key);
    startTransition(async () => {
      await work();
      setBusy(null);
      router.refresh();
    });
  };

  const ask = () =>
    startTransition(async () => {
      setFailed(null);
      const result = await suggestBoxTags(boxId);
      // Said rather than swallowed: a refused key, a retired model name and an
      // exhausted quota look identical from a button that just does nothing.
      if (!result.ok) setFailed(result.error);
      router.refresh();
    });

  return (
    <section className="border-b border-grey-200 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[10px] uppercase tracking-wider text-grey-400">Suggested tags</h3>
        {asked ? (
          <button
            type="button"
            onClick={() => run(null, () => clearTagSuggestions(boxId))}
            disabled={pending}
            className="shrink-0 text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800 disabled:opacity-40"
          >
            Throw away
          </button>
        ) : null}
      </div>

      {failed ? (
        <p className="mt-1.5 rounded-sm bg-stale-bg px-2 py-1 text-[11px] text-stale">{failed}</p>
      ) : null}

      {!asked ? (
        <>
          <p className="mt-1 text-[11px] text-grey-500">
            Read the titles and summaries already in this box and propose
            categories and tags for it. Accepting one makes the tag; nothing
            gets tagged.
          </p>
          <button
            type="button"
            onClick={ask}
            disabled={pending}
            className="mt-1.5 rounded-sm border border-grey-300 px-2 py-1 text-[11px] text-grey-700 hover:border-grey-500 disabled:opacity-40"
          >
            {pending ? 'Reading the box…' : 'Suggest tags'}
          </button>
        </>
      ) : suggestions.length === 0 ? (
        <>
          {/* Worked through is not the same as never asked, and reads as
              finished rather than as an empty panel. */}
          <p className="mt-1 text-[11px] text-grey-500">
            All dealt with. Ask again once more has been filed here.
          </p>
          <button
            type="button"
            onClick={ask}
            disabled={pending}
            className="mt-1.5 rounded-sm border border-grey-300 px-2 py-1 text-[11px] text-grey-700 hover:border-grey-500 disabled:opacity-40"
          >
            {pending ? 'Reading the box…' : 'Ask again'}
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-[11px] text-grey-500">
            {/* The sample is stated, or a reading of the recent half would be
                presented as a reading of the box. And the counts below are said
                to be evidence *here*, once, rather than on every row: a number
                beside a button is read as what the button will do. */}
            From {readCount === totalCount ? 'all' : `the newest ${readCount} of`}{' '}
            {totalCount} {totalCount === 1 ? 'entry' : 'entries'}. Accepting makes
            the tag — it doesn&rsquo;t tag anything, the counts are just what the
            suggestion is based on.
          </p>

          {byCategory(suggestions).map(([category, rows]) => (
            <section key={category} className="mt-2">
              {/*
                Grouped by axis, because the axis is the thing being judged.
                "Is Vendor a useful way to look at this box" is one decision,
                and its values read as a set — flat and sorted by coverage,
                they interleave, and the same category's name appears three
                times down the panel looking like three different questions.
              */}
              <h4 className="mb-1 flex items-baseline gap-1.5 text-[10px] uppercase tracking-wider text-grey-400">
                <span className="min-w-0 truncate">{category}</span>
                {known.has(tagKey(category)) ? null : (
                  /* Accepting any of these makes the axis as well as the value,
                     which is a larger thing to agree to than one more tag. */
                  <span className="shrink-0 text-grey-300">new</span>
                )}
              </h4>

              <ul className="space-y-1.5">
                {rows.map((one) => (
                  <li
                    key={one.key}
                    className={[
                      'rounded-sm border border-grey-200 px-2 py-1.5',
                      busy === one.key ? 'opacity-50' : '',
                    ].join(' ')}
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[12px] text-grey-800">
                        {one.tag}
                      </span>
                      <span
                        className="shrink-0 tabular-nums text-[10px] text-grey-400"
                        title={`Seen on ${one.entries.length} of the entries read`}
                      >
                        {one.entries.length}
                      </span>
                    </div>

                    {one.why ? (
                      <p className="mt-0.5 text-[11px] text-grey-500">{one.why}</p>
                    ) : null}

                    {/* What it is talking about, so the word can be judged
                        rather than guessed at. Three titles is enough to
                        recognise a group and short of the row becoming a list
                        of its own. */}
                    {one.examples.length > 0 ? (
                      <p className="mt-0.5 truncate text-[10px] text-grey-400">
                        {one.examples.join(' · ')}
                      </p>
                    ) : null}

                    <div className="mt-1 flex items-baseline gap-3">
                      <button
                        type="button"
                        onClick={() => run(one.key, () => acceptTagSuggestion(boxId, one.key))}
                        disabled={pending}
                        className="text-[11px] text-grey-700 underline underline-offset-2 hover:text-grey-900 disabled:opacity-40"
                      >
                        Make this tag
                      </button>
                      <button
                        type="button"
                        onClick={() => run(one.key, () => dismissTagSuggestion(boxId, one.key))}
                        disabled={pending}
                        className="text-[11px] text-grey-400 underline underline-offset-2 hover:text-grey-700 disabled:opacity-40"
                      >
                        No
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </section>
  );
}

/**
 * The proposals gathered under their axis, widest axis first.
 *
 * The order within a category is already the order they arrived in — widest
 * first — because `cleanSuggestions` sorted the whole set that way and grouping
 * is stable. Ordering the *categories* by their best row keeps the same
 * promise one level up: the axis with the most behind it is the one worth
 * deciding about first.
 */
function byCategory(suggestions: BoxTagSuggestion[]): [string, BoxTagSuggestion[]][] {
  const groups = new Map<string, BoxTagSuggestion[]>();

  for (const one of suggestions) {
    groups.set(one.category, [...(groups.get(one.category) ?? []), one]);
  }

  return [...groups.entries()].sort(
    (a, b) => (b[1][0]?.entries.length ?? 0) - (a[1][0]?.entries.length ?? 0),
  );
}
