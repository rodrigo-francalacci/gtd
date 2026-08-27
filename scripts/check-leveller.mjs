/**
 * The leveller's maths, checked without a browser.
 *
 * Run with: node scripts/check-leveller.mjs (from the repo root)
 *
 * It stubs the two globals an AudioWorklet gets — `sampleRate` and
 * `registerProcessor` — and calls `process` with generated signal, so every
 * number in `LEVELLER` can be argued with before anyone records anything.
 * **Run it before changing any constant.** Every one of them was chosen
 * against these curves rather than by ear, and the two that were not — the
 * drive and the makeup in the first attempt — are what made an acoustic
 * guitar sound like it was being crushed.
 *
 * The signals are deliberately synthetic. A tone modulated into syllables is
 * not speech, but it exercises the thing that matters here: how the gain moves
 * when the level does, and whether it stays put when it should.
 */
import fs from 'node:fs';

const RATE = 48000;

globalThis.sampleRate = RATE;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { postMessage() {}, set onmessage(_) {} };
  }
};
let Processor = null;
globalThis.registerProcessor = (_name, cls) => {
  Processor = cls;
};

const src = fs.readFileSync('apps/web/public/voice-leveller.js', 'utf8');
new Function(src)();

const VOICE = {
  compress: true,
  driveDb: 16,
  makeupDb: 12,
  thresholdDb: -18,
  kneeDb: 10,
  ratio: 8,
  maxReductionDb: 12,
  ceilingDb: -1.5,
  voiceMarginDb: 8,
  attack: 0.003,
  release: 0.25,
  envRelease: 0.05,
  holdSeconds: 0.25,
  lookahead: 0.010,
  ceilingRelease: 0.08,
};

function run(signal, config = VOICE) {
  const p = new Processor({ processorOptions: config });
  const out = new Float32Array(signal.length);

  for (let i = 0; i < signal.length; i += 128) {
    const n = Math.min(128, signal.length - i);
    const inBuf = [signal.subarray(i, i + n)];
    const outBuf = [new Float32Array(n)];
    p.process([inBuf], [outBuf]);
    out.set(outBuf[0], i);
  }

  return { out, processor: p };
}

const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));
const peak = (a, from = 0, to = a.length) => {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
};
const rms = (a, from = 0, to = a.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / (to - from));
};

const problems = [];
const check = (name, ok, detail) => {
  if (!ok) problems.push(name);
  console.log(ok ? 'ok  ' : 'FAIL', name.padEnd(46), detail ?? '');
};

/** Speech-ish: a 200 Hz tone amplitude-modulated into syllables. */
function speech(seconds, peakDb) {
  const n = Math.round(seconds * RATE);
  const a = new Float32Array(n);
  const amp = Math.pow(10, peakDb / 20);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const syllable = Math.max(0, Math.sin(2 * Math.PI * 3.5 * t));
    a[i] = Math.sin(2 * Math.PI * 200 * t) * syllable * amp;
  }
  return a;
}

// --- 1. It levels, and lands where it should ------------------------------
for (const inDb of [-40, -30, -25, -20, -12]) {
  const { out } = run(speech(2, inDb));
  const settled = Math.round(RATE * 1.0);
  const outDb = db(peak(out, settled));
  check(
    `speech at ${String(inDb).padStart(3)} dBFS lands sensibly`,
    outDb <= -1.4 && outDb > inDb,
    `-> ${outDb.toFixed(1)} dBFS`,
  );
}

// --- 2. Nothing ever exceeds the ceiling ----------------------------------
{
  const loud = new Float32Array(RATE);
  for (let i = 0; i < loud.length; i++) loud[i] = Math.sin((2 * Math.PI * 300 * i) / RATE) * 0.9;
  const { out } = run(loud);
  const p = db(peak(out, 2000));
  check('a hot input never passes the ceiling', p <= -1.4, `${p.toFixed(2)} dBFS`);
}

// --- 3. Gain reduction is capped (except for the ceiling term) ------------
{
  const { processor } = run(speech(2, -6));
  check(
    'compression alone stays within the cap',
    processor.maxReductionDb === 12,
    `cap ${processor.maxReductionDb} dB`,
  );
}

// --- 4. Lookahead: a transient out of silence is caught, not clipped ------
{
  const n = RATE;
  const a = new Float32Array(n);
  // Dead quiet, then a full-scale hit at 0.5s with no warning.
  for (let i = Math.round(0.5 * RATE); i < n; i++) {
    a[i] = Math.sin((2 * Math.PI * 400 * i) / RATE) * 0.95;
  }
  const { out } = run(a);
  const hitStart = Math.round(0.5 * RATE);
  const overshoot = db(peak(out, hitStart, hitStart + Math.round(0.02 * RATE)));
  check(
    'an unannounced transient is caught by lookahead',
    overshoot <= -1.0,
    `first 20ms peaks at ${overshoot.toFixed(2)} dBFS`,
  );
}

// --- 5. The freeze: noise must not swell in a silence ---------------------
{
  const n = Math.round(3 * RATE);
  const a = new Float32Array(n);
  const noise = Math.pow(10, -55 / 20);
  const talk = Math.pow(10, -22 / 20);

  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    // Steady room noise throughout; speech only in the first second.
    a[i] = (Math.random() * 2 - 1) * noise;
    if (t < 1) a[i] += Math.sin(2 * Math.PI * 200 * t) * Math.max(0, Math.sin(2 * Math.PI * 3 * t)) * talk;
  }

  const { out } = run(a);
  const early = rms(out, Math.round(1.2 * RATE), Math.round(1.4 * RATE));
  const late = rms(out, Math.round(2.6 * RATE), Math.round(2.9 * RATE));
  const swellDb = db(late) - db(early);

  check(
    'room noise does not swell through a silence',
    swellDb < 1.5,
    `${swellDb >= 0 ? '+' : ''}${swellDb.toFixed(2)} dB over 1.5s of quiet`,
  );
}

// --- 6. Music profile is transparent below the ceiling --------------------
{
  const MUSIC = { ...VOICE, compress: false, driveDb: 0, makeupDb: 0 };
  const n = RATE;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.35;
  const { out } = run(a, MUSIC);

  const from = Math.round(0.2 * RATE);
  const inDb = db(peak(a, from));
  const outDb = db(peak(out, from));

  check(
    'music passes untouched below the ceiling',
    Math.abs(outDb - inDb) < 0.05,
    `${inDb.toFixed(2)} -> ${outDb.toFixed(2)} dBFS`,
  );
}

// --- 7. Music still cannot clip -------------------------------------------
{
  const MUSIC = { ...VOICE, compress: false, driveDb: 0, makeupDb: 0 };
  const n = RATE;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.99;
  const { out } = run(a, MUSIC);
  const p = db(peak(out, 2000));
  check('music is still protected at the ceiling', p <= -1.4, `${p.toFixed(2)} dBFS`);
}

// --- 8. Stereo stays coherent ---------------------------------------------
{
  const p = new Processor({ processorOptions: VOICE });
  const n = 4800;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = Math.sin((2 * Math.PI * 200 * i) / RATE) * 0.5;
    r[i] = l[i] * 0.5; // half the level on the right
  }
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i += 128) {
    const k = Math.min(128, n - i);
    const ob = [new Float32Array(k), new Float32Array(k)];
    p.process([[l.subarray(i, i + k), r.subarray(i, i + k)]], [ob]);
    outL.set(ob[0], i);
    outR.set(ob[1], i);
  }
  const ratioIn = db(peak(r, 1000)) - db(peak(l, 1000));
  const ratioOut = db(peak(outR, 1000)) - db(peak(outL, 1000));
  check(
    'stereo balance is preserved',
    Math.abs(ratioOut - ratioIn) < 0.1,
    `${ratioIn.toFixed(2)} dB in, ${ratioOut.toFixed(2)} dB out`,
  );
}

if (problems.length) {
  console.log('\n' + problems.length + ' FAILED: ' + problems.join(', '));
  process.exitCode = 1;
} else {
  console.log('\nall passed');
}
