/**
 * What the record button is set to, in one place, for everything that records.
 *
 * These were in `voice-chain.ts` and had to come out of it: that module is
 * `'use client'` and builds a Web Audio graph, and the Chrome sidebar needs the
 * *numbers* without either. It records into the same boxes as the app, so a
 * voice note made in the sidebar and one made in the composer must not be two
 * different sounds — which is exactly what they were, the sidebar recording the
 * raw microphone while the app grew a leveller.
 *
 * A second copy in the extension was the obvious way to fix that and is the
 * trap this repository keeps warning about: two definitions disagree the first
 * time either is tuned, and the symptom is one recording that sounds unlike the
 * rest with nothing anywhere reporting a problem. So the extension fetches
 * these over HTTP from `/api/record-profiles`, and the worklet itself from
 * `/voice-leveller.js`. It holds neither.
 *
 * **The numbers come from `scripts/check-leveller.mjs`, not from listening.**
 * Run it before changing any of them.
 */

/** What the chain is being asked to do. */
export type RecordProfile = 'voice' | 'music';

/**
 * Rumble, removed before anything is multiplied.
 *
 * 100 Hz for speech, which is where a broadcast chain puts it: a male voice's
 * fundamental sits above it, and everything below is handling noise, pocket
 * thumps and the low-frequency mud that sixteen decibels of drive would
 * otherwise spend the ceiling's headroom on.
 *
 * 30 Hz for music, and the number matters: a bass guitar's low E is 41 Hz and a
 * six-string acoustic's is 82, so anything higher is not filtering rumble, it is
 * removing the instrument.
 */
export const HIGHPASS_HZ: Record<RecordProfile, number> = { voice: 100, music: 30 };

/**
 * How the leveller is set, per profile.
 *
 * Speech arriving anywhere between −30 and −12 dBFS comes out between −5.5 and
 * −1.4, which is eighteen decibels of variation reduced to four. Quieter than
 * −35 stays quieter, and that is the honest consequence of the twelve-decibel
 * cap.
 *
 * `music` is a true bypass rather than a gentler setting: an instrument is not
 * asking the question a leveller answers, and pointing one at an acoustic
 * guitar cost nineteen decibels of gain reduction and a distorted pick attack.
 */
export const LEVELLER = {
  voice: {
    compress: true,
    driveDb: 16,
    thresholdDb: -18,
    kneeDb: 10,
    ratio: 8,
    maxReductionDb: 12,
    makeupDb: 12,
    ceilingDb: -1.5,
    attack: 0.003,
    release: 0.25,
    ceilingRelease: 0.08,
    envRelease: 0.05,
    /**
     * Ten milliseconds of latency, which nothing here can notice: this is a
     * recorder, not a monitor. It buys a ceiling that is already down before
     * the peak arrives rather than chasing it afterwards.
     */
    lookahead: 0.01,
    /**
     * How far above the room a frame has to be to count as speech, and how long
     * it stays counted afterwards. The hangover matters as much as the
     * threshold: speech is full of stops and breaths, and freezing inside one
     * would modulate the level within a sentence.
     */
    voiceMarginDb: 8,
    holdSeconds: 0.25,
  },
  music: {
    compress: false,
    driveDb: 0,
    thresholdDb: -18,
    kneeDb: 10,
    ratio: 8,
    maxReductionDb: 12,
    makeupDb: 0,
    ceilingDb: -1.5,
    attack: 0.003,
    release: 0.25,
    ceilingRelease: 0.08,
    envRelease: 0.05,
    lookahead: 0.01,
    voiceMarginDb: 8,
    holdSeconds: 0.25,
  },
} as const;

/**
 * The safety clipper, after everything.
 *
 * With the worklet's lookahead in front of it this should never engage — which
 * is the point, and a change from the version where it was catching every
 * plosive and audibly distorting them. It stays because a `WaveShaper` is a
 * lookup table and cannot be late.
 *
 * Linear below the knee and a `tanh` bend above, joined so that both value and
 * slope are continuous. A plain `tanh` over the whole range pulls a −6 dBFS
 * signal down by nearly a decibel, which is a compressor pretending to be a
 * clipper.
 */
export const CLIP_KNEE = 0.6;
/** −1.0 dBFS, below the worklet's own ceiling so it is the last word. */
export const CLIP_CEILING = 0.891;

/**
 * The clipper's transfer curve.
 *
 * Sampled across [−2, 2], because the input to this stage really does exceed
 * full scale and a table stopping at 1 makes the browser clamp to its last
 * entry — a hard clip, with the aliasing that implies.
 */
export function clipCurve(points = 4096): Float32Array<ArrayBuffer> {
  // Backed by an explicit ArrayBuffer: `WaveShaperNode.curve` is typed as one.
  const curve = new Float32Array(new ArrayBuffer(points * 4));
  const span = CLIP_CEILING - CLIP_KNEE;

  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 4 - 2;
    const magnitude = Math.abs(x);

    curve[i] =
      magnitude <= CLIP_KNEE
        ? x
        : Math.sign(x) * (CLIP_KNEE + span * Math.tanh((magnitude - CLIP_KNEE) / span));
  }

  return curve;
}

/** 48 kHz, and a bitrate set explicitly — `MediaRecorder`'s default is neither documented nor generous. */
export const SAMPLE_RATE = 48_000;
export const BITRATE = 128_000;
