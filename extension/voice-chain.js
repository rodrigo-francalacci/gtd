/**
 * The recording chain, kept in step with the app's rather than invented here.
 *
 * The sidebar files into the same boxes as the app's own composer, so a voice
 * note made here and one made there had better be the same sound. They were
 * not: the app grew a high-pass, an `AudioWorklet` leveller with lookahead and
 * a voice-activity gate, and a safety clipper, while this recorded the bare
 * microphone with the browser's automatic gain left on. The sidebar produced
 * exactly the quiet, uneven recording the app had just stopped producing.
 *
 * Copying the chain across was the obvious fix and is the mistake this codebase
 * keeps a warning about: two definitions disagree the first time either is
 * tuned, and the symptom is one recording that sounds unlike the rest with
 * nothing anywhere reporting a problem.
 *
 * So the split is along the line Manifest V3 draws. **Code has to be local** —
 * extension pages are pinned to `script-src 'self'`, an `AudioWorklet` module is
 * script, and fetching one from the app would be remote code, which MV3 forbids
 * outright. `voice-leveller.js` beside this file is therefore a *byte-identical
 * copy* of the app's, and `scripts/check-extension-sync.mjs` fails if it ever
 * stops being one; that is the guard standing in for the single file we are not
 * allowed to have.
 *
 * **The numbers are not code and are fetched** — `/api/record-profiles` — so the
 * settings, which have been retuned three times and will be again, still live in
 * exactly one place. What is left here is how to wire four nodes together, which
 * is structure rather than tuning.
 *
 * If either fetch fails — the app is down, or unreachable from this network —
 * recording still happens, unprocessed, and says so. A voice note that is
 * quieter than it should be is worth having; one that did not happen is not.
 */

/**
 * All three of the browser's own filters are off, and that is the point.
 *
 * They are all *dynamic* — their gain moves with the signal — and they would sit
 * in front of a compressor whose whole job is to respond to level. Feeding it
 * something already being modulated means it is chasing a thing that is chasing
 * it: the automatic gain moves under the compressor, the compressor answers, and
 * the result breathes. Noise suppression is the same mechanism aimed at
 * frequency, and what it removes — breath, room, the tail of a word — does not
 * come back.
 *
 * Plain values rather than `exact`: a device that cannot honour one should
 * degrade, not throw and leave you with nothing.
 */
export const PROCESSED_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: 48000,
};

/**
 * What to ask for when the chain could not be built.
 *
 * Automatic gain goes back *on* here, and only here. It is the wrong tool when
 * something better follows it and the only tool when nothing does.
 */
export const RAW_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
  sampleRate: 48000,
};

/**
 * The clipper's transfer curve.
 *
 * The one piece of arithmetic that is here as well as in the app, because a
 * `WaveShaper` wants a table and a table cannot be fetched as a number. Its two
 * constants still come from the app, so what is duplicated is the shape and not
 * the setting. Sampled across [−2, 2]: the input to this stage really can exceed
 * full scale, and a table stopping at 1 makes the browser clamp to its last
 * entry, which is a hard clip.
 */
function clipCurve(knee, ceiling, points = 4096) {
  const curve = new Float32Array(points);
  const span = ceiling - knee;

  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 4 - 2;
    const magnitude = Math.abs(x);

    curve[i] =
      magnitude <= knee
        ? x
        : Math.sign(x) * (knee + span * Math.tanh((magnitude - knee) / span));
  }

  return curve;
}

/** The app's settings, fetched once per panel and kept. */
let profiles = null;

async function loadProfiles(base) {
  if (profiles) return profiles;

  const response = await fetch(`${base}/api/record-profiles`);
  if (!response.ok) throw new Error(`record profiles: ${response.status}`);

  profiles = await response.json();
  return profiles;
}

/**
 * Build the chain over a microphone stream.
 *
 * Returns what to hand `MediaRecorder`, a meter to read, a way to change profile
 * mid-recording, and whether any of it actually happened — the panel says so out
 * loud rather than implying processing that is not taking place.
 */
export async function buildVoiceChain(base, source, profile = 'voice') {
  const settings = await loadProfiles(base);

  const context = new AudioContext({ sampleRate: settings.sampleRate });

  /*
   * An `AudioContext` built outside a user gesture starts suspended, and a
   * suspended graph feeds its destination silence — a recording of the right
   * length, the right size, and empty.
   */
  await context.resume().catch(() => {});

  // Local, and it has to be — see the note at the top. `getURL` rather than a
  // relative path because a worklet module is resolved against the document,
  // and being explicit costs nothing and cannot be got wrong later.
  await context.audioWorklet.addModule(chrome.runtime.getURL('voice-leveller.js'));

  const input = context.createMediaStreamSource(source);

  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.Q.value = 0.707;
  highpass.frequency.value = settings.highpassHz[profile];

  const leveller = new AudioWorkletNode(context, 'voice-leveller', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: settings.leveller[profile],
  });

  const clipper = context.createWaveShaper();
  clipper.curve = clipCurve(settings.clip.knee, settings.clip.ceiling);
  clipper.oversample = '2x';

  const output = context.createMediaStreamDestination();

  let meter = { peak: -Infinity, reduction: 0, voiced: false };

  leveller.port.onmessage = (event) => {
    const { peak, reduction, voiced } = event.data;
    meter = {
      peak: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
      reduction,
      voiced,
    };
  };

  input.connect(highpass).connect(leveller).connect(clipper).connect(output);

  return {
    stream: output.stream,
    bitrate: settings.bitrate,
    read: () => meter,

    /*
     * Switchable mid-recording, because the moment you discover the chain is
     * wrong for what you are playing is the moment you have started playing it.
     * Every node stays put and only its parameters move.
     */
    setProfile: (next) => {
      highpass.frequency.value = settings.highpassHz[next];
      leveller.port.postMessage(settings.leveller[next]);
    },

    close: async () => {
      input.disconnect();
      leveller.port.onmessage = null;
      await context.close().catch(() => {});
    },
  };
}
