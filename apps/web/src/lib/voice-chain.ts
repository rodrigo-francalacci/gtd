'use client';

/*
 * The numbers live in `record-profiles.ts` rather than here, because the
 * Chrome sidebar records into the same boxes and needs them without a Web
 * Audio graph or a `'use client'` boundary. It fetches them from
 * `/api/record-profiles`; a second copy would be two definitions to keep in
 * agreement, which is how one recording ends up sounding unlike the rest.
 */
import {
  HIGHPASS_HZ,
  LEVELLER,
  SAMPLE_RATE,
  clipCurve,
  type RecordProfile,
} from './record-profiles';

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

// Re-exported so the recorder keeps importing its profile type from the
// module it builds its chain with.
export type { RecordProfile };

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

  const context = new Ctor({ sampleRate: SAMPLE_RATE });

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
