/**
 * Does a social post come into the box as a title and a sentence, or as a
 * mangled string with somebody's like count in it?
 *
 * The two inputs below are verbatim from real Instagram posts filed into a box
 * — entities and all — which is why they are worth keeping: this is exactly the
 * shape that arrives, and the failure it caused was invisible until it was on
 * screen next to everything else.
 *
 * Run: node scripts/check-link-meta.mjs
 */

import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps/web/src/lib/box/link.ts', import.meta.url), 'utf8');

/*
 * The three functions are lifted out of the module and evaluated on their own,
 * because importing it would drag in `server-only` and the whole fetch path for
 * the sake of three pure string helpers.
 */
const parts = [
  /const NAMED: Record<string, string> = \{[\s\S]*?\n\};/,
  /function decodeEntities[\s\S]*?\n\}/,
  /function codePoint[\s\S]*?\n\}/,
  /const SOCIAL_PREAMBLE = [^\n]+/,
  /function unwrapSocial[\s\S]*?\n\}/,
  /function untangleTitle[\s\S]*?\n\}/,
].map((pattern) => {
  const found = pattern.exec(source);
  if (!found) throw new Error(`could not find ${pattern} in link.ts`);
  return found[0];
});

const js = parts
  .join('\n\n')
  .replace(/: Record<string, string>/g, '')
  .replace(/\(value: string\)/g, '(value)')
  .replace(/\(value: number, whole: string\)/g, '(value, whole)')
  .replace(/\(text: string \| null\)/g, '(text)')
  .replace(/\(title: string \| null, description: string \| null\)/g, '(title, description)')
  .replace(/: string \| null(?= \{)/g, '')
  .replace(/: string(?= \{)/g, '')
  .replace(/whole, hex: string/g, 'whole, hex')
  .replace(/whole, dec: string/g, 'whole, dec')
  .replace(/whole, name: string/g, 'whole, name');

const { decodeEntities, unwrapSocial, untangleTitle } = new Function(
  `${js}\nreturn { decodeEntities, unwrapSocial, untangleTitle };`,
)();

const cases = [
  {
    what: 'an Instagram post with emoji in the name',
    title: 'Kathryn &#x2601;&#xfe0f; on Instagram: "Consider this your weekend checklist"',
    description:
      '1,929 likes, 16 comments - kathryn.tatess on August 29, 2026: "Consider this your weekend checklist for different types of rest to get&#x2611;&#xfe0f;"',
    wantTitle: 'Kathryn ☁️ on Instagram',
    wantDescription:
      'Consider this your weekend checklist for different types of rest to get☑️',
  },
  {
    what: 'a curly apostrophe, which every platform escapes',
    title: 'Far Out Magazine on Instagram: "Keith Richards&#x2019; favourite albums"',
    description:
      "5,994 likes, 67 comments - faroutmagazine on August 30, 2026: \"Keith Richards&#x2019; favourite albums of all time\"",
    wantTitle: 'Far Out Magazine on Instagram',
    wantDescription: "Keith Richards’ favourite albums of all time",
  },
  {
    what: 'an ordinary page, which must come through untouched',
    title: 'How to sharpen a chisel',
    description: 'A guide to honing angles, with photographs of each stage.',
    wantTitle: 'How to sharpen a chisel',
    wantDescription: 'A guide to honing angles, with photographs of each stage.',
  },
  {
    what: 'a sentence that merely begins with a number',
    title: 'Budget notes',
    description: '2,400 words on why the extension came in over budget: the groundwork.',
    wantTitle: 'Budget notes',
    wantDescription: '2,400 words on why the extension came in over budget: the groundwork.',
  },
  {
    what: 'a title with a colon that is not a caption',
    title: 'Rust: a language for the next decade',
    description: 'An introduction to ownership and borrowing.',
    wantTitle: 'Rust: a language for the next decade',
    wantDescription: 'An introduction to ownership and borrowing.',
  },
];

let bad = 0;

for (const test of cases) {
  const description = unwrapSocial(decodeEntities(test.description));
  const title = untangleTitle(decodeEntities(test.title), description);

  const okTitle = title === test.wantTitle;
  const okDescription = description === test.wantDescription;

  if (!okTitle || !okDescription) bad++;

  console.log(`${okTitle && okDescription ? 'ok  ' : 'FAIL'}  ${test.what}`);

  if (!okTitle) console.log(`        title: ${JSON.stringify(title)}\n         want: ${JSON.stringify(test.wantTitle)}`);
  if (!okDescription) console.log(`         desc: ${JSON.stringify(description)}\n         want: ${JSON.stringify(test.wantDescription)}`);
}

console.log(bad === 0 ? '\nall clean' : `\n${bad} failing`);
process.exit(bad === 0 ? 0 : 1);
