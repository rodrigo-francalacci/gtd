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
 * Run: node scripts/make-paper-grain.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

/** Small enough to be a few kilobytes, big enough that the repeat is invisible. */
const SIZE = 128;

/** The colour of the grain: the ink of the ramp, not black. */
const R = 90;
const G = 72;
const B = 40;

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

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);

  return Buffer.concat([length, body, crc]);
}

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

const next = random(20260829);

// One scanline per row, each prefixed with filter byte 0 (None). Filtering
// random noise buys nothing — there is no correlation for it to exploit — and
// None keeps this readable.
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));

for (let y = 0; y < SIZE; y++) {
  const row = y * (1 + SIZE * 4);
  raw[row] = 0;

  for (let x = 0; x < SIZE; x++) {
    /*
     * Two things at once: a fine grain everywhere, and the faint laid lines of
     * a pressed sheet every fourth row. Four divides 128, so the lines meet
     * themselves at the tile seam instead of stepping.
     */
    const grain = next() * 15;
    const laid = y % 4 === 0 ? 5 : 0;

    // Occasional darker fibre — sparse, or it reads as dirt rather than paper.
    const fibre = next() > 0.995 ? 14 : 0;

    const at = row + 1 + x * 4;
    raw[at] = R;
    raw[at + 1] = G;
    raw[at + 2] = B;
    raw[at + 3] = Math.min(255, Math.round(grain + laid + fibre));
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

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = new URL('../apps/web/public/paper-grain.png', import.meta.url);
writeFileSync(out, png);

console.log(`${SIZE}x${SIZE} grain, ${png.length} bytes -> apps/web/public/paper-grain.png`);
