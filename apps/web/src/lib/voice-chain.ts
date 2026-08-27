'use client';

/**
 * The signal chain a recording goes through on its way to the encoder.
 *
 * Everything here happens *before* the encoder, in the Web Audio graph, which
 * is the whole reason it is affordable. `MediaRecorder` is handed the output of
 * a `MediaStreamAudioDestinationNode` rather than the microphone, so the
 * processed signal is what gets encoded, once. The alternative — record, then
 * fix it — means decoding and re-encoding to Opus, which browsers cannot do
 * quickly and which would need a hand-written Ogg muxer.
 *
 * **The levelling is an `AudioWorklet`, and the second attempt.** The first was
 * a pair of `DynamicsCompressorNode`s modelled on an LA-2A, and it was the
 * wrong tool in four specific ways that no amount of tuning could reach:
 *
 *   - it has no lookahead, so transients were through the output before the
 *     gain moved and were caught by the safety clipper instead, which is what
 *     an acoustic guitar sounded like;
 *   - nothing capped the gain reduction, so a guitar at −9 dBFS collected
 *     nineteen decibels of it;
 *   - it has no idea whether anyone is speaking;
 *   - and so its long release did exactly the wrong thing in a pause, winding
 *     the gain back up and bringing the room noise with it.
 *
 * `public/voice-leveller.js` does all four. What is left out here is anything a
 * browser cannot reach: a page has no way to move the microphone's own analogue
 * gain, so everything happens after the converter.
 */

/**
 * What the chain is being asked to do.
 *
 * `voice` levels hard: a spoken note is a message to yourself, recorded at
 * whatever distance you happened to be holding the phone, and the only wrong
 * answer is one you cannot hear. `music` gets out of the way entirely — the
 * leveller is bypassed and only the ceiling remains, as a safety net it should
 * never touch.
 *
 * Not remembered between recordings, deliberately — the same rule the capture
 * screen's destination chips follow. A remembered profile is how you get a
 * squashed guitar or a voice note nobody can hear, and you find out on playback.
 */
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
const HIGHPASS_HZ = { voice: 100, music: 30 } as const;

/**
 * How the leveller is set, per profile.
 *
 * The numbers were chosen against a simulation of the worklet's own maths
 * rather than by ear, and the shape is what matters: speech arriving anywhere
 * between −30 and −12 dBFS comes out between −5.5 and −1.4, which is eighteen
 * decibels of variation reduced to four. Quieter than −35 stays quieter, and
 * that is the honest consequence of the twelve-decibel cap.
 *
 * `maxReductionDb` is twelve because past that a leveller stops levelling and
 * starts generating intermodulation — the sound of speech being squeezed
 * through something. The ceiling term inside the worklet is allowed past it,
 * because holding the output below full scale is protection rather than
 * levelling and refusing to do it would be the cap defeating its own purpose.
 */
const LEVELLER = {
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
 * With the worklet's lookahead in front of it this should now never engage —
 * which is the point, and a change from the version where it was catching every
 * plosive and audibly distorting them. It stays because a `WaveShaper` is a
 * lookup table and cannot be late, and a mathematical guarantee at the end of a
 * chain costs nothing when it is never reached.
 *
 * Linear below the knee and a `tanh` bend above, joined so that both value and
 * slope are continuous: below −4.4 dBFS the signal is untouched. A plain `tanh`
 * over the whole range pulls a −6 dBFS signal down by nearly a decibel, which is
 * a compressor pretending to be a clipper.
 */
const CLIP_KNEE = 0.6;
/** −1.0 dBFS, below the worklet's own ceiling so it is the last word, not the first. */
const CLIP_CEILING = 0.891;

function clipCurve(points = 4096): Float32Array<ArrayBuffer> {
  // Backed by an explicit ArrayBuffer: `WaveShaperNode.curve` is typed as one.
  const curve = new Float32Array(new ArrayBuffer(points * 4));
  const span = CLIP_CEILING - CLIP_KNEE;

  for (let i = 0; i < points; i++) {
    // Sampled across [−2, 2]: a table stopping at 1 makes the browser clamp to
    // its last entry, which is a hard clip with aliasing.
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
  /** Gain reduction, in decibels, as a positive number. */
  reduction: number;
  /** Whether the leveller currently thinks someone is talking. */
  voiced: boolean;
};

export type VoiceChain = {
  /** What to hand `MediaRecorder`. */
  stream: MediaStream;
  /** The current meter reading. Cheap — call it from an animation frame. */
  read: () => VoiceMeter;
  /**
   * Change profile without rebuilding anything.
   *
   * The worklet is reconfigured by message and the filter by parameter, so the
   * switch is seamless and can happen mid-recording — which matters, because the
   * moment you discover the chain is wrong for what you are playing is the
   * moment you have started playing it. What is already encoded keeps the old
   * treatment; there is no undoing that.
   */
  setProfile: (profile: RecordProfile) => void;
  /** Tear the graph down. Does not stop the microphone's own tracks. */
  close: () => Promise<void>;
  /** Whether the graph was built at all, or this is the microphone as-is. */
  processed: boolean;
  /** Whether the real leveller loaded, as against the fallback below. */
  levelled: boolean;
};

/** The chain that does nothing, for a browser that cannot do the rest. */
function passthrough(source: MediaStream): VoiceChain {
  return {
    stream: source,
    read: () => ({ peak: -Infinity, reduction: 0, voiced: false }),
    setProfile: () => {},
    close: async () => {},
    processed: false,
    levelled: false,
  };
}

/**
 * Build the chain over a microphone stream.
 *
 * Asynchronous because an `AudioWorklet` module is fetched, and there is no
 * synchronous way to have one. The caller waits — it is a few milliseconds off
 * a local file, and starting the recorder before the processing exists would
 * mean the first second of every take was unprocessed.
 */
export async function buildVoiceChain(
  source: MediaStream,
  profile: RecordProfile = 'voice',
): Promise<VoiceChain> {
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext);

  if (!Ctor) return passthrough(source);

  const context = new Ctor({ sampleRate: 48_000 });

  /*
   * An `AudioContext` built outside a user gesture starts suspended, and a
   * suspended graph feeds its destination silence — a recording of the right
   * length, the right size, and empty.
   */
  await context.resume().catch(() => {});

  const input = context.createMediaStreamSource(source);

  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.Q.value = 0.707;
  highpass.frequency.value = HIGHPASS_HZ[profile];

  const clipper = context.createWaveShaper();
  clipper.curve = clipCurve();
  // The curve is near-linear for all but the top few decibels, so the harmonics
  // it can generate are both rare and low; four-times oversampling would add
  // latency to every sample to tidy up something that should never happen.
  clipper.oversample = '2x';

  const output = context.createMediaStreamDestination();

  let meter: VoiceMeter = { peak: -Infinity, reduction: 0, voiced: false };

  let leveller: AudioWorkletNode | null = null;

  try {
    await context.audioWorklet.addModule('/voice-leveller.js');

    leveller = new AudioWorkletNode(context, 'voice-leveller', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: LEVELLER[profile],
    });

    leveller.port.onmessage = (event: MessageEvent) => {
      const { peak, reduction, voiced } = event.data as {
        peak: number;
        reduction: number;
        voiced: boolean;
      };

      meter = {
        peak: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
        reduction,
        voiced,
      };
    };

    input.connect(highpass).connect(leveller).connect(clipper).connect(output);
  } catch {
    /*
     * No worklet: an insecure context, or a browser that will not load the
     * module. The signal still gets through and is still protected — it simply
     * is not levelled, and the recorder says so rather than implying processing
     * that is not happening.
     */
    leveller = null;
    input.connect(highpass).connect(clipper).connect(output);
  }

  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  clipper.connect(analyser);
  const frame = new Float32Array(analyser.fftSize);

  return {
    stream: output.stream,
    processed: true,
    levelled: leveller !== null,

    setProfile: (next) => {
      highpass.frequency.value = HIGHPASS_HZ[next];
      leveller?.port.postMessage(LEVELLER[next]);
    },

    /*
     * The worklet's own numbers where there is a worklet, and the analyser's
     * otherwise. The worklet sees every sample; the analyser sees whatever
     * happens to be in the last buffer when it is asked, which is enough for a
     * level meter and no use at all for gain reduction.
     */
    read: () => {
      if (leveller) return meter;

      analyser.getFloatTimeDomainData(frame);

      let peak = 0;
      for (const sample of frame) {
        const magnitude = Math.abs(sample);
        if (magnitude > peak) peak = magnitude;
      }

      return {
        peak: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
        reduction: 0,
        voiced: false,
      };
    },

    close: async () => {
      input.disconnect();
      if (leveller) leveller.port.onmessage = null;
      // A suspended context can still hold an audio device open; closing is
      // what gives it back.
      await context.close().catch(() => {});
    },
  };
}

/** What each profile is doing, for the recorder's readout. */
export const PROFILE_LABEL: Record<RecordProfile, string> = {
  voice: `+${LEVELLER.voice.driveDb} dB · max ${LEVELLER.voice.maxReductionDb} dB GR · ${LEVELLER.voice.ceilingDb} dBFS`,
  music: `flat · ${LEVELLER.music.ceilingDb} dBFS`,
};
