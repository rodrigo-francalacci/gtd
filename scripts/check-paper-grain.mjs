/**
 * Does the generated grain have the texture of paper, or of dust?
 *
 * The distinction is not visible in a thumbnail and is the whole difference
 * between the two. Paper varies *more* over forty pixels than over one — the
 * soft mottling is what your eye recognises — where per-pixel noise, which is
 * what a first attempt produces, has all of its energy at 1px and none at 40.
 *
 * The reference figures come from the Age of Empires II campaign scroll this
 * theme is modelled on, sampled the same way: the 90th-percentile luminance
 * difference between two pixels a given distance apart.
 *
 *     1px    5.0
 *     6px    8.3
 *     40px  10.9
 *
 * Run: node scripts/check-paper-grain.mjs
 */

import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

/** The parchment the overlay sits on. Keep in step with `--color-paper`. */
const BASE = [0xd9, 0xb8, 0x97];

/** What the reference measured, and how far from it is still paper. */
const WANT = [
  { step: 1, target: 5.0, tolerance: 3.5 },
  { step: 6, target: 8.3, tolerance: 4.5 },
  { step: 40, target: 10.9, tolerance: 5.5 },
];

const buf = readFileSync(new URL('../apps/web/public/paper-grain.png', import.meta.url));

let off = 8;
const idat = [];
let ihdr = null;

while (off < buf.length - 8) {
  const len = buf.readUInt32BE(off);
  const kind = buf.toString('ascii', off + 4, off + 8);
  if (kind === 'IHDR')
    ihdr = { w: buf.readUInt32BE(off + 8), h: buf.readUInt32BE(off + 12) };
  if (kind === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
  off += 12 + len;
}

const raw = inflateSync(Buffer.concat(idat));
const stride = ihdr.w * 4;
const out = Buffer.alloc(ihdr.h * stride);

let p = 0;
for (let y = 0; y < ihdr.h; y++) {
  const f = raw[p++];
  for (let x = 0; x < stride; x++) {
    const rb = raw[p + x];
    const a = x >= 4 ? out[y * stride + x - 4] : 0;
    const b = y > 0 ? out[(y - 1) * stride + x] : 0;
    const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
    let v;
    if (f === 0) v = rb;
    else if (f === 1) v = rb + a;
    else if (f === 2) v = rb + b;
    else if (f === 3) v = rb + ((a + b) >> 1);
    else {
      const pp = a + b - c;
      const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
      v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
    }
    out[y * stride + x] = v & 0xff;
  }
  p += stride;
}

/** The tile composited over the parchment, which is what anyone actually sees. */
function luminance(x, y) {
  const i = (y % ihdr.h) * stride + (x % ihdr.w) * 4;
  const alpha = out[i + 3] / 255;

  const channel = (k) => out[i + k] * alpha + BASE[k] * (1 - alpha);

  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Wraps across the tile edge on purpose: a seam would show up here as a spike. */
function variation(step) {
  const diffs = [];

  for (let y = 0; y < ihdr.h; y += 3) {
    for (let x = 0; x < ihdr.w; x += 3) {
      diffs.push(Math.abs(luminance(x, y) - luminance(x + step, y)));
    }
  }

  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length * 0.9)];
}

let bad = 0;

console.log(`${ihdr.w}x${ihdr.h}, ${(buf.length / 1024).toFixed(1)} KB\n`);
console.log('  scale    measured   reference');

for (const { step, target, tolerance } of WANT) {
  const got = variation(step);
  const ok = Math.abs(got - target) <= tolerance;
  if (!ok) bad++;

  console.log(
    `  ${String(step + 'px').padEnd(7)}  ${got.toFixed(1).padStart(6)}   ${target
      .toFixed(1)
      .padStart(6)}   ${ok ? 'ok' : 'OUT OF RANGE'}`,
  );
}

/*
 * The shape matters more than any single figure: paper mottles more over a
 * long distance than a short one. Noise that fails this is dust on a screen,
 * whatever its amplitude.
 */
const fine = variation(1);
const broad = variation(40);

if (broad <= fine) {
  console.log(`\n  broad (${broad.toFixed(1)}) must exceed fine (${fine.toFixed(1)}) — this is noise, not paper`);
  bad++;
} else {
  console.log(`\n  broad ${broad.toFixed(1)} > fine ${fine.toFixed(1)} — mottled, as paper is`);
}

console.log(bad === 0 ? '\npaper' : `\n${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);
