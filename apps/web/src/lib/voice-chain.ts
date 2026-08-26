'use client';

/**
 * The signal chain a recording goes through on its way to the encoder.
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
 * **There are two profiles, and that is the correction to the first version of
 * this file.** It had one chain, tuned to make quiet speech loud, and it was
 * applied to everything that came near the record button. Put an acoustic
 * guitar through it and the arithmetic is brutal: a signal already peaking at
 * −9 dBFS collects nineteen decibels of gain reduction, and the ten-millisecond
 * attack — right for a voice — lets every pick transient through to the clipper
 * behind it. The result is a squashed, distorted recording of an instrument
 * that needed nothing done to it at all.
 *
 * A leveller is not a quality setting. It is the answer to one question — *this
 * is too quiet and too uneven* — and an instrument played into a microphone is
 * not asking it.
 */

/** Decibels to a linear gain factor. */
const gain = (dB: number) => 10 ** (dB / 20);

/**
 * What the chain is being asked to do.
 *
 * `voice` levels hard: a spoken note is a message to yourself, recorded at
 * whatever distance you happened to be holding the phone, and the only wrong
 * answer is one you cannot hear. `music` gets out of the way: no drive, no
 * compression, a rumble filter low enough to leave a bass guitar alone, and the
 * limiter kept purely as a safety net it should never touch.
 *
 * Not remembered between recordings, deliberately — the same rule the capture
 * screen's destination chips follow. A remembered profile is how you get a
 * squashed guitar or a voice note nobody can hear, and you find out afterwards.
 * It is one tap, and it is on screen the whole time you are recording.
 */
export type RecordProfile = 'voice' | 'music';

/**
 * Rumble, removed before anything is multiplied.
 *
 * Not tone-shaping. A phone held in a hand puts handling noise and pocket
 * thumps down here and they carry real energy, so fourteen decibels of drive
 * applied to a signal containing them spends the limiter's headroom on sound
 * nobody can hear.
 *
 * 30 Hz for music, and the number matters: a bass guitar's low E is 41 Hz and a
 * six-string acoustic's is 82, so anything higher is not filtering rumble, it is
 * removing the instrument. 65 is safe for a voice, whose fundamental does not go
 * near it.
 */
const HIGHPASS_HZ = { voice: 65, music: 30 } as const;

/**
 * The stage that stands in for a first normalise.
 *
 * Sized for a phone held at conversational distance with the browser's own gain
 * control switched off, which puts speech peaks somewhere near −25 dBFS.
 * Fourteen decibels lands them a little over the optical stage's threshold and
 * the average squarely in its working range.
 *
 * Checked against the static curve the specification defines for
 * `DynamicsCompressorNode` rather than guessed at: −25 dBFS in comes out near
 * −4 dBFS having given up about six decibels, which is levelling. An earlier
 * attempt drove it eighteen and took fifteen decibels off the same input, which
 * is a different effect wearing the same name.
 *
 * Zero for music. Whatever the microphone gives is the level, the meter says
 * what it is, and moving closer is a better gain control than a number in a
 * file.
 */
const DRIVE_DB = { voice: 14, music: 0 } as const;

/**
 * The attack, fixed, because on the compressor this is modelled on it is.
 *
 * An LA-2A has no attack control: the photocell responds in about ten
 * milliseconds and that is the end of the discussion. It is a slow attack by any
 * modern standard, and for a voice that is the point — a consonant gets through
 * with its edge intact and only the vowel behind it is levelled.
 *
 * It is also precisely why this chain must not be pointed at an instrument. Ten
 * milliseconds is an eternity to a plucked string: the transient is through
 * before the gain moves, and with makeup gain behind it that transient arrives
 * at the clipper. Every note, on its attack — which is the part of a guitar note
 * you actually listen to.
 */
const OPTO_ATTACK = 0.01;

/**
 * Two compressors, because an optical one releases in two stages.
 *
 * An LA-2A's release is program-dependent: roughly the first half of the gain
 * reduction recovers in a twentieth of a second and the remainder takes a second
 * or more, so it lets syllables breathe while holding the level down across a
 * sentence. It never pumps, because the part of the recovery you would hear
 * happens too fast to hear and the part you could hear happens too slowly.
 *
 * `DynamicsCompressorNode` has one release time and no way to make it
 * program-dependent. Two in series is the standard way to get the behaviour
 * anyway, and it costs nothing here.
 *
 * A ratio of 1 is a true bypass whatever the threshold says, which is what the
 * music profile uses: the nodes stay in the graph and stop doing anything,
 * rather than the graph being rebuilt to change profile mid-recording.
 */
const OPTO = {
  voice: {
    slow: { threshold: -16, knee: 12, ratio: 3, attack: OPTO_ATTACK, release: 1.5 },
    fast: { threshold: -18, knee: 10, ratio: 2.5, attack: OPTO_ATTACK, release: 0.06 },
  },
  music: {
    slow: { threshold: 0, knee: 0, ratio: 1, attack: OPTO_ATTACK, release: 1.5 },
    fast: { threshold: 0, knee: 0, ratio: 1, attack: OPTO_ATTACK, release: 0.06 },
  },
} as const;

/** Makeup, since `DynamicsCompressorNode` has none of its own. */
const MAKEUP_DB = { voice: 12, music: 0 } as const;

/**
 * The ceiling. Unconditional, and the same in both profiles.
 *
 * Ratio 20 is as brickwall as `DynamicsCompressorNode` goes, with the knee shut
 * so it behaves as a limiter rather than a second compressor. −1.2 dBFS rather
 * than 0: a lossy encoder reconstructs a waveform that can overshoot the samples
 * it was given, so a file peaking at exactly zero decodes to one that clips.
 *
 * In the music profile it should never engage. It is there for the take where
 * you misjudged the distance, and a limiter that catches one chorus is better
 * than a recording you cannot use.
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
 * `DynamicsCompressorNode` is feed-forward with no lookahead, so however fast
 * the attack a transient gets through before the gain moves. Measured on real
 * recordings, this chain was delivering peaks of **+3.8 dBFS** with the limiter
 * set to −1.2. The limiter was working; it simply cannot catch the first
 * millisecond of a plosive, which is exactly the part that clips.
 *
 * A `WaveShaperNode` is sample-accurate by construction — a lookup table has no
 * attack to be too slow. Nothing gets past it.
 *
 * Linear below the knee and a `tanh` bend above, joined so that both value and
 * slope are continuous: below −4.4 dBFS the signal is untouched, and above it
 * bends smoothly to the ceiling instead of folding over. A plain `tanh` over the
 * whole range was the first idea and is audibly wrong — it pulls a −6 dBFS
 * signal down by nearly a decibel, which is a compressor pretending to be a
 * clipper.
 */
const CLIP_KNEE = 0.6;
/** −1.0 dBFS. Below zero because a lossy decoder reconstructs peaks above it. */
const CLIP_CEILING = 0.891;

/**
 * The clipper's transfer curve, as a lookup table.
 *
 * Sampled across [−2, 2] rather than [−1, 1]: the input to this stage really
 * does exceed full scale — that is the whole reason it exists — and a table that
 * stops at 1 would have the browser clamp to its last entry, which is a hard
 * clip with aliasing rather than the soft bend the curve describes.
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

export type VoiceMeter = {
  /** Peak of the last frame, in dBFS. `-Infinity` for silence. */
  peak: number;
  /** Gain reduction across every stage, in decibels, as a positive number. */
  reduction: number;
};

export type VoiceChain = {
  /** What to hand `MediaRecorder`. */
  stream: MediaStream;
  /** The current meter reading. Cheap — call it from an animation frame. */
  read: () => VoiceMeter;
  /**
   * Change profile without rebuilding anything.
   *
   * Every node stays where it is and its parameters move, so the switch is
   * seamless and can happen mid-recording — which matters, because the moment
   * you discover the chain is wrong for what you are playing is the moment you
   * have started playing it. What is already encoded keeps the old treatment;
   * there is no undoing that, and pretending otherwise would be worse.
   */
  setProfile: (profile: RecordProfile) => void;
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
export function buildVoiceChain(
  source: MediaStream,
  profile: RecordProfile = 'voice',
): VoiceChain {
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
      setProfile: () => {},
      close: async () => {},
      processed: false,
    };
  }

  const context = new Ctor({ sampleRate: 48_000 });
  const input = context.createMediaStreamSource(source);

  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.Q.value = 0.707;

  const drive = context.createGain();
  const slow = context.createDynamicsCompressor();
  const fast = context.createDynamicsCompressor();
  const makeup = context.createGain();

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = LIMIT.threshold;
  limiter.knee.value = LIMIT.knee;
  limiter.ratio.value = LIMIT.ratio;
  limiter.attack.value = LIMIT.attack;
  limiter.release.value = LIMIT.release;

  const clipper = context.createWaveShaper();
  clipper.curve = clipCurve();
  // No heavy oversampling: the curve is near-linear for all but the top few
  // decibels, so the harmonics it generates are both rare and low. Four-times
  // would add latency to every sample to tidy up a transient.
  clipper.oversample = '2x';

  /*
   * The meter sits at the very end, after the clipper, so it reports what is
   * actually being encoded rather than what the chain was aiming at. Anywhere
   * earlier and it would be describing a signal that no longer exists by the
   * time it reaches the file.
   */
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;

  const output = context.createMediaStreamDestination();

  const setProfile = (next: RecordProfile) => {
    highpass.frequency.value = HIGHPASS_HZ[next];
    drive.gain.value = gain(DRIVE_DB[next]);
    makeup.gain.value = gain(MAKEUP_DB[next]);

    for (const [node, values] of [
      [slow, OPTO[next].slow],
      [fast, OPTO[next].fast],
    ] as const) {
      node.threshold.value = values.threshold;
      node.knee.value = values.knee;
      node.ratio.value = values.ratio;
      node.attack.value = values.attack;
      node.release.value = values.release;
    }
  };

  setProfile(profile);

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
    setProfile,

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
         * Every stage, added. `reduction` is reported as a negative number of
         * decibels: the two optical stages do the levelling and the limiter
         * catches whatever got past them, and how hard the chain is working in
         * total is the number worth showing. In the music profile the first two
         * report nothing, which is the point — a reading above zero there means
         * the take is too hot and you should move back.
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

/** What each profile is doing, for the recorder's readout. */
export const PROFILE_LABEL: Record<RecordProfile, string> = {
  voice: `+${DRIVE_DB.voice} dB · opto ${OPTO.voice.slow.ratio}:1 · limit ${LIMIT.threshold} dBFS`,
  music: `flat · limit ${LIMIT.threshold} dBFS`,
};
