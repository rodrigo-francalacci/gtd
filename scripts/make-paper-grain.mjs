/**
 * Draw the paper grain, once, as a small PNG.
 *
 * The obvious way to make paper grain in CSS is `feTurbulence` behind a
 * `mix-blend-mode: multiply` overlay, and over a whole viewport both halves are
 * things to avoid: a blending layer that size forces the page to be composited
 * into a texture and blended again on every paint, and an SVG filter used as a
 * background can be re-rasterised while that happens.
 *
 * So the noise is baked here instead. A PNG costs one decode, tiles for free,
 * needs no filter and no blend, and is a static file rather than bytes in the
 * stylesheet of every user who has never chosen this theme.
 *
 * **The shape of the noise was measured, not invented.** Sampling the Age of
 * Empires II campaign scroll this theme is modelled on, at three scales (90th
 * percentile luminance difference between two pixels that far apart):
 *
 *     1px    5.0     fine grain
 *     6px    8.3
 *     40px  10.9     blotches
 *
 * Which is the opposite of what a first attempt at "paper texture" produces.
 * Pure per-pixel noise has all of its energy at 1px and none at 40, and reads
 * as a dusty screen rather than as a sheet — the thing your eye actually
 * recognises as paper is the *large* soft mottling, with the grain on top.
 *
 * Run: node scripts/make-paper-grain.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

/**
 * The tile.
 *
 * 256 rather than 128, because the blotches are the point and a 40px feature
 * needs room to be a feature rather than a repeat. Every octave's cell size
 * below divides it, which is what makes the noise wrap without a seam.
 */
const SIZE = 256;

/**
 * Both directions.
 *
 * The overlay lies over *every* surface — the paper, the panel greys, a
 * selected row — so it cannot simply paint the parchment colour. It modulates
 * whatever is beneath it: darker where the sheet is thick, lighter where it is
 * thin. A one-directional overlay can only dim, which turns every surface into
 * the same muddy tone and loses the difference between them.
 */
const DARK = [92, 68, 38];
const LIGHT = [255, 246, 228];

/**
 * Peak alpha, out of 255.
 *
 * Swept against `scripts/check-paper-grain.mjs` rather than chosen: 34 came out
 * at a third of the reference, 100 overshot the blotches by half. Seventy lands
 * all three scales inside tolerance.
 */
const AMPLITUDE = 70;

/**
 * Deterministic, so re-running produces the same file and the diff is empty.
 * A mulberry32, which is short and has no discernible pattern at this scale.
 */
function random(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const next = random(20260829);

/** Smoothstep, so the lattice does not show as diamonds. */
const ease = (t) => t * t * (3 - 2 * t);

/**
 * One octave of tileable value noise.
 *
 * Values live on a lattice of `SIZE / cell` points and are read back with
 * bilinear interpolation. The lattice index wraps modulo its own size, which is
 * the whole of why the tile has no seam: the right edge interpolates towards
 * the same values the left edge starts from.
 */
function octave(cell) {
  const n = SIZE / cell;
  const grid = new Float64Array(n * n);
  for (let i = 0; i < grid.length; i++) grid[i] = next() * 2 - 1;

  const at = (gx, gy) => grid[(((gy % n) + n) % n) * n + (((gx % n) + n) % n)];

  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = ease(fx - x0);
    const ty = ease(fy - y0);

    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;

    return top * (1 - ty) + bottom * ty;
  };
}

/*
 * Weighted so the large scales carry most of the energy, which is what the
 * measurement asked for. The 1px term is last and smallest: it is the grain you
 * see with your nose against the screen, not the thing that makes it paper.
 */
const LAYERS = [
  [64, 0.34],
  [32, 0.25],
  [16, 0.2],
  [8, 0.14],
  [4, 0.07],
];

const fields = LAYERS.map(([cell, weight]) => [octave(cell), weight]);

// One scanline per row, each prefixed with filter byte 0 (None).
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));

for (let y = 0; y < SIZE; y++) {
  const row = y * (1 + SIZE * 4);
  raw[row] = 0;

  for (let x = 0; x < SIZE; x++) {
    let v = 0;
    for (const [field, weight] of fields) v += field(x, y) * weight;

    // The fine grain, uncorrelated by construction.
    v += (next() * 2 - 1) * 0.16;

    /*
     * The laid lines of a pressed sheet, every fourth row. Four divides 256, so
     * they meet themselves at the seam rather than stepping.
     */
    if (y % 4 === 0) v -= 0.12;

    const clamped = Math.max(-1, Math.min(1, v));
    const [r, g, b] = clamped < 0 ? DARK : LIGHT;

    const at = row + 1 + x * 4;
    raw[at] = r;
    raw[at + 1] = g;
    raw[at + 2] = b;
    raw[at + 3] = Math.round(Math.abs(clamped) * AMPLITUDE);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
ihdr[10] = 0; // deflate
ihdr[11] = 0; // adaptive filtering
ihdr[12] = 0; // no interlace

const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return ~c;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);

  return Buffer.concat([length, body, crc]);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = new URL('../apps/web/public/paper-grain.png', import.meta.url);
writeFileSync(out, png);

console.log(`${SIZE}x${SIZE} grain, ${png.length} bytes -> apps/web/public/paper-grain.png`);
