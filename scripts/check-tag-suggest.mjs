/**
 * The disposing half of the tag suggester, without a database or an API key.
 *
 * `cleanSuggestions` is the only thing standing between whatever a model felt
 * like returning and a vocabulary offered to somebody as though the app meant
 * it. Every assertion here is a *refusal* — a proposal that should not reach
 * the panel — because that is the half whose failure is silent: a dropped
 * suggestion is one row fewer, where an accepted bad one becomes a real tag.
 *
 *   node --experimental-strip-types --import ./scripts/ts-resolve.mjs \
 *        scripts/check-tag-suggest.mjs
 */

import { cleanSuggestions, tagKey } from '../apps/web/src/lib/box/suggest-clean.ts';

let failed = 0;

function ok(label, condition) {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!condition) failed += 1;
}

/** Six entries, keyed the way the action keys them. */
const known = new Map([
  ['e1', 'id-1'],
  ['e2', 'id-2'],
  ['e3', 'id-3'],
  ['e4', 'id-4'],
  ['e5', 'id-5'],
  ['e6', 'id-6'],
]);

const labels = new Map([
  ['id-1', 'Tesco fuel 12 Aug'],
  ['id-2', 'Shell 3 Sep'],
  ['id-3', 'Council tax bill'],
  ['id-4', 'BP receipt'],
  ['id-5', 'Letter from the surgery'],
  ['id-6', 'Water bill'],
]);

const clean = (raw, existing = []) =>
  cleanSuggestions({ raw, existing, known, labels, limit: 40 });

// -- the comparison every tag is made under ---------------------------------

ok('tagKey folds case', tagKey('Tesco') === tagKey('tesco'));
ok('tagKey collapses runs of space', tagKey('  Fuel   receipt ') === 'fuel receipt');

// -- what must be refused ---------------------------------------------------

ok(
  'a tag naming no entry is dropped',
  clean([{ category: 'Type', tag: 'Receipt', why: '', entries: [] }]).length === 0,
);

ok(
  'a key that was never sent is dropped',
  clean([{ category: 'Type', tag: 'Receipt', why: '', entries: ['e99'] }]).length === 0,
);

ok(
  'unknown keys are dropped without taking the real ones with them',
  clean([{ category: 'Type', tag: 'Receipt', why: '', entries: ['e1', 'e99', 'e2'] }])[0]
    ?.entries.length === 2,
);

ok(
  'a tag already on that axis is dropped',
  clean([{ category: 'Type', tag: 'receipt', why: '', entries: ['e1'] }], [
    { name: 'Type', tags: ['Receipt'] },
  ]).length === 0,
);

ok(
  'an empty category or tag is dropped',
  clean([
    { category: '   ', tag: 'Receipt', why: '', entries: ['e1'] },
    { category: 'Type', tag: '', why: '', entries: ['e1'] },
  ]).length === 0,
);

ok(
  'a repeated entry key is counted once',
  clean([{ category: 'Type', tag: 'Receipt', why: '', entries: ['e1', 'e1', 'e1'] }])[0]
    ?.entries.length === 1,
);

/*
 * The one that took a paid-for call down.
 *
 * Postgres refuses a NUL anywhere in a `jsonb` document — "unsupported Unicode
 * escape sequence" — and it arrived in a model *reply*, not in the box. One
 * character in one string threw the whole answer away and reached the screen
 * as "a server error occurred".
 */
const NUL = String.fromCharCode(0);
const nulled = clean([
  {
    category: `Doc${NUL}ument type`,
    tag: `Rec${NUL}eipt`,
    why: `because${NUL} of the totals`,
    entries: ['e1'],
  },
]);

ok('a control character in a category is stripped', nulled[0]?.category === 'Doc ument type');
ok('and in a tag', nulled[0]?.tag === 'Rec eipt');
ok('and in a reason', nulled[0]?.why === 'because of the totals');
ok(
  'nothing survives that a jsonb column would refuse',
  JSON.stringify(nulled).indexOf(NUL) === -1,
);

ok(
  'a title carrying one is cleaned before it becomes an example',
  cleanSuggestions({
    raw: [{ category: 'Type', tag: 'Receipt', why: '', entries: ['e1'] }],
    existing: [],
    known,
    labels: new Map([['id-1', `Tesco${NUL} fuel`]]),
    limit: 40,
  })[0]?.examples[0] === 'Tesco fuel',
);

// -- what must survive ------------------------------------------------------

const existing = [{ name: 'Vendor', tags: ['Tesco'] }];

const joined = clean(
  [{ category: 'vendor', tag: 'Shell', why: 'a filling station', entries: ['e2'] }],
  existing,
);

ok('a near-miss category joins the real one', joined[0]?.category === 'Vendor');

const invented = clean([{ category: 'Utility', tag: 'Water', why: '', entries: ['e6'] }], existing);
ok('a genuinely new axis keeps its own name', invented[0]?.category === 'Utility');

/* Whether an axis is new is worked out by the panel against the live
   vocabulary, never stored: it goes stale the moment one proposal under that
   axis is accepted. */
ok(
  'newness is not stored on a proposal',
  Object.prototype.hasOwnProperty.call(invented[0] ?? {}, 'categoryIsNew') === false,
);

const twice = clean([
  { category: 'Type', tag: 'Receipt', why: 'first group', entries: ['e1', 'e2'] },
  { category: 'type', tag: 'receipt', why: 'second group', entries: ['e2', 'e4'] },
]);

ok('the same tag proposed twice is merged, not dropped', twice.length === 1);
ok('and keeps the union of both groups', twice[0]?.entries.length === 3);

const ordered = clean([
  { category: 'Type', tag: 'Letter', why: '', entries: ['e5'] },
  { category: 'Type', tag: 'Receipt', why: '', entries: ['e1', 'e2', 'e4'] },
  { category: 'Type', tag: 'Bill', why: '', entries: ['e3', 'e6'] },
]);

ok(
  'the widest proposal is offered first',
  ordered.map((s) => s.tag).join(',') === 'Receipt,Bill,Letter',
);

ok(
  'examples are titles, not ids',
  ordered[0]?.examples.join(' · ') === 'Tesco fuel 12 Aug · Shell 3 Sep · BP receipt',
);

ok('at most three examples', clean([
  { category: 'Type', tag: 'Receipt', why: '', entries: ['e1', 'e2', 'e3', 'e4'] },
])[0]?.examples.length === 3);

ok(
  'the limit is honoured',
  cleanSuggestions({
    raw: Array.from({ length: 60 }, (_, n) => ({
      category: 'Type',
      tag: `Tag ${n}`,
      why: '',
      entries: ['e1'],
    })),
    existing: [],
    known,
    labels,
    limit: 40,
  }).length === 40,
);

// -- the shape the panel relies on -----------------------------------------

ok(
  'every proposal carries a key unique within the set',
  new Set(ordered.map((s) => s.key)).size === ordered.length,
);

ok(
  'a category differing only in case shares one key',
  clean([
    { category: 'Type', tag: 'Receipt', why: '', entries: ['e1'] },
    { category: 'TYPE', tag: 'RECEIPT', why: '', entries: ['e2'] },
  ]).length === 1,
);

console.log(failed === 0 ? '\nAll good.' : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
