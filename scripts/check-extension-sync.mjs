/**
 * The guard standing in for a file we are not allowed to have once.
 *
 * The Chrome sidebar records into the same boxes as the app's composer, so the
 * two must record through the same chain — and a copy of that chain in the
 * extension is the two-definitions trap this repository keeps a warning about:
 * they disagree the first time either is tuned, and the symptom is one recording
 * that sounds unlike the rest with nothing anywhere reporting a problem.
 *
 * Manifest V3 leaves no choice about the code. Extension pages are pinned to
 * `script-src 'self'`, an `AudioWorklet` module is script, and fetching one from
 * the app would be remote code, which MV3 forbids. So the worklet is copied, and
 * this is what makes the copy safe: it must be byte-identical, and CI or a
 * pre-push run says so out loud when it stops being.
 *
 * The *settings* are not code and are not copied — the sidebar fetches them from
 * `/api/record-profiles`, so the numbers still live in exactly one place.
 *
 *   node scripts/check-extension-sync.mjs
 *
 * If this fails and the app's copy is the one you changed:
 *   cp apps/web/public/voice-leveller.js extension/voice-leveller.js
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Files that must be identical on both sides, and why. */
const PAIRS = [
  {
    source: 'apps/web/public/voice-leveller.js',
    copy: 'extension/voice-leveller.js',
    why: 'the levelling worklet — the sidebar and the app must record the same way',
  },
];

let failures = 0;

for (const { source, copy, why } of PAIRS) {
  let a;
  let b;

  try {
    a = readFileSync(join(root, source));
  } catch {
    console.log(`FAIL  ${source} is missing`);
    failures++;
    continue;
  }

  try {
    b = readFileSync(join(root, copy));
  } catch {
    console.log(`FAIL  ${copy} is missing — copy it from ${source}`);
    failures++;
    continue;
  }

  if (a.equals(b)) {
    console.log(`ok    ${relative('.', copy)} matches (${why})`);
    continue;
  }

  failures++;
  console.log(`FAIL  ${copy} has drifted from ${source}`);
  console.log(`      ${a.length} bytes vs ${b.length}`);

  // Name the first line that differs, which is usually the whole story.
  const left = a.toString('utf8').split('\n');
  const right = b.toString('utf8').split('\n');

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) {
      console.log(`      first difference at line ${i + 1}:`);
      console.log(`        app:       ${JSON.stringify(left[i] ?? '(no line)')}`);
      console.log(`        extension: ${JSON.stringify(right[i] ?? '(no line)')}`);
      break;
    }
  }
}

console.log(failures ? `\n${failures} out of step` : '\nall in step');
process.exit(failures ? 1 : 0);
