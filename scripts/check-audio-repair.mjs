/**
 * Checks for `lib/audio-repair.ts`, against MP4s built here.
 *
 * The repair rewrites bytes inside a user's recording on the strength of a
 * proof about the sample table, so the thing worth testing is not only that it
 * fixes a bad file but that it refuses every good one — a false positive here
 * silently replaces a real frame of audio with silence.
 *
 * Run it before changing anything in that module:
 *   node --experimental-strip-types scripts/check-audio-repair.mjs
 */

import { repairLeadingConfigFrame } from '../apps/web/src/lib/audio-repair.ts';

let failures = 0;

const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name}` +
      (ok ? '' : `\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`),
  );
};

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const str = (s) => [...s].map((c) => c.charCodeAt(0));
const box = (type, body) => [...u32(8 + body.length), ...str(type), ...body];

/**
 * An MP4 whose shape is ours to choose.
 *
 * Only the boxes the repair reads are real; everything it does not look at is
 * omitted rather than faked, so a test failing means the thing under test
 * changed rather than the scaffolding did.
 */
function buildMp4({
  asc = [0x11, 0x90],
  firstSample = null,
  sizes = [341, 341, 342],
  constantSize = 0,
  sampleDescriptions = 1,
  format = 'mp4a',
} = {}) {
  const samples = firstSample ? [firstSample.length, ...sizes] : sizes;

  // esds: ES_Descriptor -> DecoderConfigDescriptor -> DecoderSpecificInfo.
  const dsi = [0x05, asc.length, ...asc];
  // Object type, stream type, three bytes of buffer size, then two four-byte
  // bitrates — thirteen fixed bytes, which is exactly what the parser skips.
  const fixed13 = [0x40, 0x15, 0, 3, 0, 0, 0, 1, 0xf4, 0, 0, 1, 0xf4];
  const dcd = [0x04, fixed13.length + dsi.length, ...fixed13, ...dsi];
  const esd = [0x03, 3 + dcd.length, 0, 0, 0, ...dcd];
  const esds = box('esds', [0, 0, 0, 0, ...esd]);

  // An `mp4a` sample entry: 8 of box header, then 28 of reserved and audio
  // fields, then its child boxes.
  const entry = box(format, [...new Array(28).fill(0), ...esds]);
  const stsd = box('stsd', [0, 0, 0, 0, ...u32(sampleDescriptions), ...entry]);

  const table = constantSize ? [] : samples.flatMap(u32);
  const stsz = box('stsz', [
    0, 0, 0, 0,
    ...u32(constantSize),
    ...u32(samples.length),
    ...table,
  ]);

  // Written last, so the chunk offset is the final four bytes of the header
  // and can be filled in once the header's own length is known.
  const stco = box('stco', [0, 0, 0, 0, ...u32(1), ...u32(0)]);

  const header = [
    ...box('ftyp', [...str('isom'), 0, 0, 0, 0]),
    ...box('moov', box('trak', box('mdia', box('minf', box('stbl', [...stsd, ...stsz, ...stco]))))),
  ];
  header.splice(header.length - 4, 4, ...u32(header.length + 8));

  const media = firstSample ? [...firstSample] : [];
  for (const size of sizes) for (let i = 0; i < size; i++) media.push(0x40 + (i % 60));

  return new Uint8Array([...header, ...box('mdat', media)]).buffer;
}

// ---- the defect, exactly as it arrives ----------------------------------

const broken = buildMp4({ firstSample: [0x11, 0x90] });
const fixed = repairLeadingConfigFrame(broken);
check('a config-as-first-frame file is repaired', fixed !== null, true);

if (fixed) {
  const before = new Uint8Array(broken);
  const after = new Uint8Array(fixed);

  check('the repair does not change the length', after.length, before.length);

  const changed = [];
  for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) changed.push(i);

  // The whole point: nothing outside the two-byte sample is disturbed, so the
  // sample table, every chunk offset and the length are all still true.
  check('the change is confined to the bad sample', changed, [changed[0], changed[0] + 1]);

  const at = changed[0];
  check('it becomes an empty raw_data_block', after[at], 0xe0);
  check('the byte after it is padding', after[at + 1], 0x00);
  check('what it replaced was the configuration', [before[at], before[at + 1]], [0x11, 0x90]);
  check('the original buffer is not mutated', new Uint8Array(broken)[at], 0x11);
}

// ---- every shape that must be left alone --------------------------------

check('a healthy file is untouched', repairLeadingConfigFrame(buildMp4()), null);

check(
  'a short first sample that is not the config is untouched',
  repairLeadingConfigFrame(buildMp4({ firstSample: [0x21, 0x10] })),
  null,
);

check(
  'a first sample the wrong length for the config is untouched',
  repairLeadingConfigFrame(buildMp4({ firstSample: [0x11, 0x90, 0x11] })),
  null,
);

check(
  'a constant-sample-size file is untouched',
  repairLeadingConfigFrame(buildMp4({ constantSize: 341 })),
  null,
);

check(
  'a file holding only the bad sample is untouched',
  repairLeadingConfigFrame(buildMp4({ firstSample: [0x11, 0x90], sizes: [] })),
  null,
);

check(
  'more than one sample description is untouched',
  repairLeadingConfigFrame(buildMp4({ firstSample: [0x11, 0x90], sampleDescriptions: 2 })),
  null,
);

check(
  'a non-AAC track is untouched',
  repairLeadingConfigFrame(buildMp4({ firstSample: [0x11, 0x90], format: 'alac' })),
  null,
);

check('an empty buffer is untouched', repairLeadingConfigFrame(new ArrayBuffer(0)), null);
check('a buffer with no ftyp is untouched', repairLeadingConfigFrame(new ArrayBuffer(64)), null);

// ---- the config length is read, not assumed -----------------------------

const five = [0x11, 0x90, 0x56, 0xe5, 0x00];
check(
  'a five-byte configuration frame is repaired',
  repairLeadingConfigFrame(buildMp4({ asc: five, firstSample: five })) !== null,
  true,
);

// ---- truncation must never throw ----------------------------------------

for (const keep of [8, 20, 60, 120, 200, 300, 400]) {
  let threw = null;
  try {
    repairLeadingConfigFrame(broken.slice(0, keep));
  } catch (error) {
    threw = error.message;
  }
  check(`a file truncated to ${keep} bytes does not throw`, threw, null);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
