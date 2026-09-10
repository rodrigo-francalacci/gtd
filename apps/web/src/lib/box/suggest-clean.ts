import type { RawSuggestion } from '@/lib/ai/tag-suggest';
import type { BoxTagSuggestion } from '@/lib/queries.shared';

/**
 * The model proposes; this disposes.
 *
 * The same rule `validateTags` enforces one level down, and it matters more
 * here rather than less: that one is checking values against a vocabulary
 * somebody wrote, where this is checking a vocabulary nobody has written yet.
 * There is no list to match against, so the discipline has to come from what a
 * proposal is *allowed to be* — a real category, a tag that is not already
 * there, and entries that exist.
 *
 * Nothing here is applied to a document. The entries a proposal names are
 * evidence for judging it, and validating them is what makes the count on
 * screen a fact rather than a number the model chose.
 *
 * Pure and free of `server-only`, so `scripts/check-tag-suggest.mjs` can run
 * the awkward cases without a database or an API key.
 */

/**
 * The comparison every tag in this app is made under.
 *
 * Case- and space-insensitive, the `resolveParty` rule: "tesco" and "Tesco "
 * are one tag, and `box_tags` has a unique index on `lower(name)` that will
 * refuse the second one anyway. Doing it here is what turns that refusal into
 * a suggestion quietly dropped rather than an error somebody has to read.
 */
export function tagKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Trim, collapse the whitespace, and drop what a `jsonb` column will not hold.
 *
 * A NUL is the one that matters, and it is fatal rather than untidy: Postgres
 * refuses the whole document with `unsupported Unicode escape sequence`, so one
 * stray character anywhere in one string throws away a model call that has
 * already been paid for and reaches the screen as "a server error occurred".
 *
 * It arrived in a *reply*, not in the box — the entries were checked and had
 * none — and that is the point. Everything else in this app comes in through a
 * column that would have refused it years ago; this is the one place text
 * arrives from outside all of that and goes straight into storage.
 *
 * The rest of the C0 range goes with it. A tag, a category or a reason has no
 * business carrying a control character: they are invisible on screen, and one
 * inside a tag name would make two tags that look identical fail to match.
 */
function plain(raw: unknown, limit: number): string {
  if (typeof raw !== 'string') return '';

  /* By code point rather than a regex range: a range has to be written
     with escapes, and an escape that loses a backslash somewhere between
     an editor and the file becomes a literal NUL in the source — which is
     the exact character this exists to remove. */
  const stripped = [...raw]
    .map((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? ' ' : c;
    })
    .join('');

  return stripped.trim().replace(/\s+/g, ' ').slice(0, limit);
}

const CATEGORY_LIMIT = 60;
const TAG_LIMIT = 60;
const WHY_LIMIT = 140;
const EXAMPLE_LIMIT = 70;

/** Enough to recognise a group, short of the row becoming a list of its own. */
const EXAMPLES = 3;

export type CleanInput = {
  raw: RawSuggestion[];
  /** Categories the box already has, with the tags already under them. */
  existing: { name: string; tags: string[] }[];
  /** Every key that was sent, mapped to the entry id it stands for. */
  known: Map<string, string>;
  /** Entry id to title, so a proposal can show a few of what it means. */
  labels: Map<string, string>;
  /** The most proposals worth putting in front of somebody at once. */
  limit: number;
};

/**
 * Turn what came back into something that can be stored and shown.
 *
 * Everything here is a *drop* rather than a repair, deliberately. A proposal
 * that has to be corrected before it can be used is one the model got wrong,
 * and quietly fixing it up would hide how often that happens behind a panel
 * that always looks full.
 */
export function cleanSuggestions({
  raw,
  existing,
  known,
  labels,
  limit,
}: CleanInput): BoxTagSuggestion[] {
  /* The box's own spelling of each category, so an addition joins the category
     rather than sitting beside it in a near-identical one. */
  const canonical = new Map(existing.map((c) => [tagKey(c.name), c.name]));

  /* What is already on each axis, so nothing is proposed twice. Keyed on the
     canonical category, because that is what the proposal will resolve to. */
  const taken = new Map<string, Set<string>>();
  for (const category of existing) {
    taken.set(tagKey(category.name), new Set(category.tags.map(tagKey)));
  }

  const examplesFor = (ids: string[]) =>
    ids
      .slice(0, EXAMPLES)
      .map((id) => plain(labels.get(id), EXAMPLE_LIMIT))
      .filter(Boolean);

  /* Merged rather than first-wins: a model that proposes Receipt twice under
     one category has found two groups of the same thing, and keeping only the
     first would silently drop half its coverage. */
  const merged = new Map<string, BoxTagSuggestion>();

  for (const item of raw) {
    const rawCategory = plain(item?.category, CATEGORY_LIMIT);
    const rawTag = plain(item?.tag, TAG_LIMIT);
    if (!rawCategory || !rawTag) continue;

    const categoryKey = tagKey(rawCategory);
    const category = canonical.get(categoryKey) ?? rawCategory;
    const tagged = tagKey(rawTag);

    // Already on this axis. Accepting it would be a no-op wearing a button.
    if (taken.get(categoryKey)?.has(tagged)) continue;

    /*
     * Keys the model was never given.
     *
     * A hallucinated key is the one failure here that would be invisible:
     * dropped, the tag simply cites fewer entries. The lookup is what makes the
     * short keys safe to use in place of uuids, and what makes the count on
     * screen a fact rather than a number the model chose.
     */
    const entries = [
      ...new Set(
        (Array.isArray(item?.entries) ? item.entries : [])
          .map((k) => known.get(String(k).trim()))
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];

    /*
     * A proposal that names no entry is dropped.
     *
     * The opposite of the rule the tag panel follows for tags you made
     * yourself — there a count of zero is the tag you have just created and are
     * about to start using. Here it is the model offering a word it could not
     * point at anything to justify, and since nothing is tagged by accepting
     * it, the entries are the only evidence there is that the word means
     * something in this box.
     */
    if (entries.length === 0) continue;

    const id = `${categoryKey} ${tagged}`;
    const already = merged.get(id);

    if (already) {
      already.entries = [...new Set([...already.entries, ...entries])];
      already.examples = examplesFor(already.entries);
      continue;
    }

    merged.set(id, {
      key: id,
      category,
      tag: rawTag,
      why: plain(item?.why, WHY_LIMIT),
      entries,
      examples: examplesFor(entries),
    });
  }

  /*
   * Widest first, because that is the order they are worth judging in: a tag
   * covering forty entries is a decision about the box, and one covering two is
   * a detail you can take or leave once the shape is settled.
   */
  return [...merged.values()]
    .sort((a, b) => b.entries.length - a.entries.length)
    .slice(0, limit);
}
