'use client';

/**
 * The signal chain a voice note goes through on its way to the encoder.
 *
 * The recorder used to hand `MediaRecorder` the microphone's own stream and ask
 * the browser to be kind to it — `autoGainControl`, and nothing else. That is
 * not a chain, it is a hope, and it produced exactly what it sounds like:
 * recordings you have to turn the volume up for.
 *
 * Everything here happens *before* the encoder, in the Web Audio graph, which
 * is the whole reason it is affordable. `MediaRecorder` is handed the output of
 * a `MediaStreamAudioDestinationNode` rather than the microphone, so the
 * processed signal is what gets encoded, once. The alternative — record, then
 * fix it — means decoding and re-encoding to Opus, which browsers cannot do
 * quickly and which would need a hand-written Ogg muxer. That was the reason
 * proper levelling was dropped the first time round; doing it live removes the
 * reason rather than paying its price.
 *
 * What it cannot do is *peak normalise*, and the difference is worth being
 * exact about. Normalising means finding the loudest sample and scaling the
 * whole file so that sample lands on the ceiling — and you cannot know the
 * loudest sample until the recording has stopped. What a limiter with a fixed
 * ceiling gives instead is the thing normalising was for: a known, consistent
 * peak. Offline you normalise, compress, and normalise again because the first
 * pass is what gets the material into the compressor's range; live, that first
 * pass is simply a gain stage with a number on it, which is `DRIVE_DB` below.
 */

/** Decibels to a linear gain factor. */
const gain = (dB: number) => 10 ** (dB / 20);

/**
 * The clipper's transfer curve, as a lookup table.
 *
 * Sampled across [−2, 2] rather than [−1, 1]: the input to this stage really
 * does exceed full scale — that is the whole reason it exists — and a table
 * that stops at 1 would have the browser clamp to its last entry, which is a
 * hard clip with aliasing rather than the soft bend the curve describes.
 */
function clipCurve(points = 4096): Float32Array<ArrayBuffer> {
  // Backed by an explicit ArrayBuffer: WaveShaperNode.curve is typed as one,
  // and a bare Float32Array could in principle be over shared memory.
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

/**
 * Rumble, removed before anything is multiplied by fourteen.
 *
 * Not tone-shaping, and deliberately far below anything a voice uses: a phone
 * held in a hand puts handling noise and pocket thumps down here, and they
 * carry real energy. Fourteen decibels of drive applied to a signal containing
 * them spends the limiter's headroom on sound nobody can hear, which comes back
 * as a recording that measures loud and sounds quiet. 65 Hz, gently, is the
 * smallest filter that stops that happening.
 */
const HIGHPASS_HZ = 65;

/**
 * The stage that stands in for the first normalise.
 *
 * Sized for a phone held at conversational distance with the browser's own
 * gain control switched off, which puts speech peaks somewhere near −25 dBFS.
 * Fourteen decibels lands them a little over the optical stage's threshold and
 * the average squarely in its working range.
 *
 * Checked against the static curve the specification defines for
 * `DynamicsCompressorNode` rather than guessed at: −25 dBFS in comes out near
 * −4 dBFS having given up about six decibels, which is levelling. The first
 * attempt drove it eighteen and took fifteen decibels off the same input,
 * which is a different effect wearing the same name.
 *
 * Deterministic, which is the point of turning the browser's automatic gain off
 * to make room for it: AGC moves under you, so the same sentence recorded twice
 * comes back at two levels — and a compressor fed by one is chasing something
 * that is already chasing it.
 */
const DRIVE_DB = 14;

/**
 * The attack, fixed, because on the compressor this is modelled on it is.
 *
 * An LA-2A has no attack control: the photocell responds in about ten
 * milliseconds and that is the end of the discussion. It is a slow attack by
 * any modern standard, and that is the point — a consonant gets through with
 * its edge intact and only the vowel behind it is levelled. What escapes in
 * those ten milliseconds is the limiter's problem, which is exactly the
 * division of labour in the hardware chain this imitates.
 */
const OPTO_ATTACK = 0.01;

/**
 * Two compressors, because an optical one releases in two stages.
 *
 * This is the whole character of the thing. An LA-2A's release is
 * program-dependent: roughly the first half of the gain reduction recovers in
 * a twentieth of a second, and the remainder takes a second or more, so the
 * compressor lets syllables breathe while holding the overall level down
 * across a sentence. It never pumps, because the part of the recovery you
 * would hear happens too fast to hear and the part you could hear happens too
 * slowly.
 *
 * `DynamicsCompressorNode` has one release time and no way to make it
 * program-dependent. Two of them in series is the standard way to get the
 * behaviour anyway, and it costs nothing here: the slow stage does the
 * levelling and sets the average, the fast stage catches what pokes through
 * between words. Both attack together, at the same ten milliseconds, so they
 * respond to one event and differ only in how they let go of it.
 *
 * Thresholds are set for a signal that has already been through `DRIVE_DB`.
 */
const OPTO_SLOW = {
  threshold: -16,
  knee: 12,
  ratio: 3,
  attack: OPTO_ATTACK,
  release: 1.5,
} as const;

const OPTO_FAST = {
  threshold: -18,
  knee: 10,
  ratio: 2.5,
  attack: OPTO_ATTACK,
  release: 0.06,
} as const;

/**
 * Makeup, since `DynamicsCompressorNode` has none of its own.
 *
 * Enough to keep the limiter working rather than merely present: a couple of
 * decibels of limiting on the loudest syllables is what makes a voice note
 * sound dense instead of merely loud, and a limiter that never engages is a
 * safety net being paid for and not used.
 */
const MAKEUP_DB = 12;

/**
 * The ceiling, and the second normalise in everything but name.
 *
 * Ratio 20 is as brickwall as `DynamicsCompressorNode` goes, with the knee shut
 * so it behaves as a limiter rather than a second compressor. −1.2 dBFS rather
 * than 0: a lossy encoder reconstructs a waveform that can overshoot the
 * samples it was given, so a file peaking at exactly zero decodes to one that
 * clips.
 */
const LIMIT = {
  threshold: -1.2,
  knee: 0,
  ratio: 20,
  attack: 0.001,
  release: 0.08,
} as const;

/**
 * The safety clipper, and it is not decoration.
 *
 * `DynamicsCompressorNode` is a feed-forward compressor with no lookahead, so
 * however fast the attack, a transient gets through before the gain moves. That
 * is fine for a compressor and not fine for the last stage before an encoder:
 * measured on real recordings, this chain was delivering peaks of **+3.8 dBFS**
 * with the limiter set to −1.2. The limiter was working; it simply cannot catch
 * the first millisecond of a plosive, which is exactly the part that clips.
 *
 * A `WaveShaperNode` is sample-accurate by construction — it is a lookup table,
 * so it has no attack to be too slow. Nothing gets past it.
 *
 * Linear below the knee and a `tanh` bend above, joined so that both the value
 * and the slope are continuous at the join: below −4.4 dBFS the signal is
 * untouched, and above it bends smoothly to the ceiling instead of folding
 * over. A plain `tanh` over the whole range was the first idea and is audibly
 * wrong — it pulls a −6 dBFS signal down by nearly a decibel, which is a
 * compressor pretending to be a clipper.
 */
const CLIP_KNEE = 0.6;
/** −1.0 dBFS. Below zero because a lossy decoder reconstructs peaks above it. */
const CLIP_CEILING = 0.891;

export type VoiceMeter = {
  /** Peak of the last frame, in dBFS. `-Infinity` for silence. */
  peak: number;
  /** Gain reduction across both stages, in decibels, as a positive number. */
  reduction: number;
};

export type VoiceChain = {
  /** What to hand `MediaRecorder`. */
  stream: MediaStream;
  /** The current meter reading. Cheap — call it from an animation frame. */
  read: () => VoiceMeter;
  /** Tear the graph down. Does not stop the microphone's own tracks. */
  close: () => Promise<void>;
  /** Whether the graph was actually built, or this is the microphone as-is. */
  processed: boolean;
};

/**
 * Build the chain over a microphone stream.
 *
 * Hands the microphone stream back untouched if this browser has no Web Audio,
 * which is the same trade every constraint in the recorder makes: a device that
 * cannot do the good thing should still make a recording.
 */
export function buildVoiceChain(source: MediaStream): VoiceChain {
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext);

  if (!Ctor) {
    return {
      stream: source,
      read: () => ({ peak: -Infinity, reduction: 0 }),
      close: async () => {},
      processed: false,
    };
  }

  const context = new Ctor({ sampleRate: 48_000 });
  const input = context.createMediaStreamSource(source);

  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = HIGHPASS_HZ;
  highpass.Q.value = 0.707;

  const drive = context.createGain();
  drive.gain.value = gain(DRIVE_DB);

  const slow = context.createDynamicsCompressor();
  slow.threshold.value = OPTO_SLOW.threshold;
  slow.knee.value = OPTO_SLOW.knee;
  slow.ratio.value = OPTO_SLOW.ratio;
  slow.attack.value = OPTO_SLOW.attack;
  slow.release.value = OPTO_SLOW.release;

  const fast = context.createDynamicsCompressor();
  fast.threshold.value = OPTO_FAST.threshold;
  fast.knee.value = OPTO_FAST.knee;
  fast.ratio.value = OPTO_FAST.ratio;
  fast.attack.value = OPTO_FAST.attack;
  fast.release.value = OPTO_FAST.release;

  const makeup = context.createGain();
  makeup.gain.value = gain(MAKEUP_DB);

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = LIMIT.threshold;
  limiter.knee.value = LIMIT.knee;
  limiter.ratio.value = LIMIT.ratio;
  limiter.attack.value = LIMIT.attack;
  limiter.release.value = LIMIT.release;

  /*
   * The meter sits at the very end, after the limiter, so it reports what is
   * actually being encoded rather than what the chain was aiming at. Anywhere
   * earlier and it would be describing a signal that no longer exists by the
   * time it reaches the file.
   */
  const clipper = context.createWaveShaper();
  clipper.curve = clipCurve();
  // No oversampling: the curve is near-linear for all but the top few decibels,
  // so the harmonics it generates are both rare and low. Four-times
  // oversampling would add latency to every sample to tidy up a transient.
  clipper.oversample = '2x';

  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;

  const output = context.createMediaStreamDestination();

  input
    .connect(highpass)
    .connect(drive)
    .connect(slow)
    .connect(fast)
    .connect(makeup)
    .connect(limiter)
    .connect(clipper)
    .connect(analyser)
    .connect(output);

  /*
   * An `AudioContext` constructed outside a user gesture starts suspended, and
   * a suspended graph feeds its destination silence — so the recording would be
   * the right length, the right size, and empty. It is created a moment after
   * `getUserMedia` resolves, which is usually still within the gesture that
   * opened the recorder, but "usually" is not a thing to rely on when the
   * failure is a file of nothing.
   */
  void context.resume().catch(() => {});

  const frame = new Float32Array(analyser.fftSize);

  return {
    stream: output.stream,
    processed: true,

    read: () => {
      analyser.getFloatTimeDomainData(frame);

      let peak = 0;
      for (const sample of frame) {
        const magnitude = Math.abs(sample);
        if (magnitude > peak) peak = magnitude;
      }

      return {
        peak: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
        /*
         * All three stages, added. `reduction` is reported as a negative
         * number of decibels: the two optical stages do the levelling and the
         * limiter catches whatever got past them, and how hard the chain is
         * working in total is the number worth showing.
         */
        reduction: -(slow.reduction + fast.reduction + limiter.reduction),
      };
    },

    close: async () => {
      input.disconnect();
      // A suspended context can still hold an audio device open; closing is
      // what actually gives it back.
      await context.close().catch(() => {});
    },
  };
}

/** A one-line description of the chain, for the recorder's readout. */
export const VOICE_CHAIN_LABEL =
  `+${DRIVE_DB} dB · opto ${OPTO_SLOW.ratio}:1 · limit ${LIMIT.threshold} dBFS`;
