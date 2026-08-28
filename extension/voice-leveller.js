/**
 * The leveller, as an AudioWorklet.
 *
 * This replaces a pair of `DynamicsCompressorNode`s that were standing in for a
 * broadcast leveller and doing four things they structurally cannot:
 *
 *   - **Lookahead.** A `DynamicsCompressorNode` is feed-forward with no delay
 *     line, so a transient is through the output before the gain has moved,
 *     however fast the attack. Measured on real recordings the old chain was
 *     delivering peaks of +3.8 dBFS with the limiter set to −1.2 — every plosive
 *     and every guitar pick arriving at the safety clipper and being distorted
 *     by it. Here the detector runs on the *incoming* signal while the output is
 *     read from a delay line, so the gain is already down by the time the peak
 *     arrives, and the clipper after this node goes back to being a formality.
 *
 *   - **A cap on gain reduction.** Nothing bounded how hard the old chain
 *     pulled: a guitar peaking at −9 dBFS collected nineteen decibels, which is
 *     not levelling, it is crushing. Twelve is the limit here, and the ceiling
 *     term below is allowed past it only because protecting against clipping is
 *     a different job from levelling.
 *
 *   - **Knowing whether anyone is speaking.** Without it a long release does
 *     exactly the wrong thing in a pause: the gain climbs back and the room
 *     noise climbs with it, so every silence swells. It is the single most
 *     recognisable difference between a voice note that sounds produced and one
 *     that sounds like a bad phone call.
 *
 *   - **Freezing on silence.** Which is what you do about the above: while no
 *     voice is present the gain is *held* where it was rather than released.
 *
 * The one step nothing here can copy is reaching down to the microphone's own
 * analogue gain. A web page has no such control, and there is no polyfill for
 * it — everything below happens after the converter.
 */

/** Decibels to linear, and back. Guarded, because log(0) is not a number. */
const dbToGain = (db) => Math.pow(10, db / 20);
const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-7));

/**
 * A one-pole smoothing coefficient for a time constant in seconds.
 *
 * The usual `1 - exp(-1 / (t * rate))`: after `t` seconds the follower has
 * covered about 63% of the distance, which is what "attack" and "release" mean
 * everywhere else and is worth matching rather than inventing a scale.
 */
const coefficient = (seconds, rate) =>
  seconds <= 0 ? 1 : 1 - Math.exp(-1 / Math.max(seconds * rate, 1));

class VoiceLeveller extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const rate = sampleRate;

    /**
     * The delay line that makes lookahead possible.
     *
     * Sized once, at the longest lookahead the settings allow, so switching
     * profile mid-recording never reallocates — a `new Float32Array` inside
     * `process` is a glitch waiting for the garbage collector.
     */
    this.maxDelay = Math.ceil(0.02 * rate);
    this.delay = [new Float32Array(this.maxDelay), new Float32Array(this.maxDelay)];
    this.write = 0;

    /** Peak follower on the undelayed signal, linear. */
    this.envelope = 0;
    /** Levelling reduction, in decibels, always ≥ 0. Frozen in silence. */
    this.reduction = 0;
    /**
     * Protection reduction, kept separate from the levelling above.
     *
     * Two followers rather than one, because the two jobs want opposite time
     * constants. Levelling wants a gentle attack — a fast one grabs at the
     * front of every word — while the ceiling wants to be down *before* the
     * peak arrives, and one shared attack cannot be both. Sharing one is what
     * let a cold transient through at +0.7 dBFS in the first version of this:
     * the compressor was three milliseconds into a six-millisecond window when
     * eighteen decibels were needed at once.
     *
     * It also must never be frozen. Protection that held after one loud noise
     * would hold the whole recording down behind it.
     */
    this.ceiling = 0;
    /** Where the noise floor sits, in decibels. Starts pessimistic and falls. */
    this.noiseDb = -50;
    /** Samples of speech still credited after the last voiced frame. */
    this.hold = 0;

    /** How often the meter is posted, in samples. About fifty times a second. */
    this.meterEvery = Math.round(rate / 50);
    this.meterCountdown = this.meterEvery;
    this.meterPeak = 0;
    this.meterReduction = 0;

    this.configure(options.processorOptions || {});
    this.port.onmessage = (event) => this.configure(event.data || {});
  }

  configure(config) {
    const rate = sampleRate;
    const has = (key) => Object.prototype.hasOwnProperty.call(config, key);

    if (has('compress')) this.compress = Boolean(config.compress);
    if (has('driveDb')) this.drive = dbToGain(config.driveDb);
    if (has('makeupDb')) this.makeupDb = config.makeupDb;
    if (has('thresholdDb')) this.thresholdDb = config.thresholdDb;
    if (has('kneeDb')) this.kneeDb = config.kneeDb;
    if (has('ratio')) this.ratio = Math.max(config.ratio, 1);
    if (has('maxReductionDb')) this.maxReductionDb = config.maxReductionDb;
    if (has('ceilingDb')) this.ceilingDb = config.ceilingDb;
    if (has('voiceMarginDb')) this.voiceMarginDb = config.voiceMarginDb;

    if (has('attack')) this.attackCoef = coefficient(config.attack, rate);
    if (has('release')) this.releaseCoef = coefficient(config.release, rate);
    if (has('ceilingRelease')) this.ceilingReleaseCoef = coefficient(config.ceilingRelease, rate);
    if (has('envRelease')) this.envCoef = coefficient(config.envRelease, rate);
    if (has('holdSeconds')) this.holdSamples = Math.round(config.holdSeconds * rate);

    if (has('lookahead')) {
      this.lookahead = Math.min(
        Math.max(Math.round(config.lookahead * rate), 1),
        this.maxDelay - 1,
      );

      /*
       * The ceiling attacks in a quarter of the lookahead, which is what makes
       * the lookahead worth having: a one-pole covers 98% of the distance in
       * four time constants, so by the time the peak reaches the output the
       * gain is already there. Derived rather than configured, because the two
       * numbers are only ever right in relation to each other.
       */
      this.ceilingAttackCoef = coefficient(config.lookahead / 4, rate);
    }
  }

  /**
   * Whether the frame in front of us is somebody talking.
   *
   * Energy against an adaptive floor, not a fixed threshold: a fixed one is
   * wrong in every room, and the point of this is to work in a car and a
   * kitchen without being told which. The floor falls quickly toward whatever
   * quiet it finds and rises very slowly, so it settles on the noise of the room
   * rather than being dragged up by speech.
   *
   * The hangover matters as much as the detection. Speech is full of gaps —
   * stops, breaths, the space between clauses — and freezing the gain inside
   * one and unfreezing after it would modulate the level within a sentence,
   * which is worse than not freezing at all.
   */
  voiced(envDb) {
    if (envDb < this.noiseDb) {
      this.noiseDb += (envDb - this.noiseDb) * 0.02;
    } else {
      this.noiseDb += (envDb - this.noiseDb) * 0.00002;
    }

    if (envDb > this.noiseDb + this.voiceMarginDb) {
      this.hold = this.holdSamples;
      return true;
    }

    if (this.hold > 0) {
      this.hold--;
      return true;
    }

    return false;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0 || !input[0]) {
      // No input at all — the track has gone away, or nothing has arrived yet.
      // Returning true keeps the node alive rather than ending the graph.
      return true;
    }

    const channels = Math.min(input.length, output.length, this.delay.length);
    const frames = output[0].length;

    for (let i = 0; i < frames; i++) {
      /*
       * The loudest channel decides, and both are then multiplied by the same
       * number. Two channels with independent gain is two channels drifting
       * apart — a stereo image that wanders whenever one side is louder.
       */
      let level = 0;

      for (let c = 0; c < channels; c++) {
        const sample = input[c][i] * this.drive;
        this.delay[c][this.write] = sample;
        const magnitude = Math.abs(sample);
        if (magnitude > level) level = magnitude;
      }

      // Peak follower: instant up, exponential down. The detector sees the
      // signal *now*; the output below is reading it `lookahead` samples late.
      this.envelope =
        level > this.envelope
          ? level
          : this.envelope + (level - this.envelope) * this.envCoef;

      const envDb = gainToDb(this.envelope);
      const speaking = this.voiced(envDb);

      /*
       * The compressor curve, soft-kneed, and capped.
       *
       * Capped at twelve decibels because past that a leveller stops levelling
       * and starts generating intermodulation — the thing that makes heavily
       * processed speech sound like it is being squeezed through something.
       */
      let target = 0;

      if (this.compress) {
        const over = envDb - this.thresholdDb;
        const half = this.kneeDb / 2;
        const slope = 1 - 1 / this.ratio;

        if (over >= half) {
          target = over * slope;
        } else if (over > -half) {
          const into = over + half;
          target = (into * into * slope) / (2 * this.kneeDb);
        }

        if (target > this.maxReductionDb) target = this.maxReductionDb;
      }

      /*
       * The ceiling, added on top and deliberately not capped.
       *
       * Holding the output below full scale is protection, not levelling, and
       * refusing to do it because twelve decibels have already been spent would
       * be the cap defeating the thing it exists to make safe. It is rare: with
       * six milliseconds of lookahead the compressor above has usually dealt
       * with the peak before this is consulted.
       */
      // (the ceiling is computed below, from the smoothed levelling gain)

      /*
       * Freeze, which is the whole reason this is a worklet.
       *
       * More reduction is applied at the attack rate. Less is released at the
       * release rate *only while someone is speaking* — in a silence the gain
       * simply stays where it was. Without this the long release does precisely
       * the wrong thing in every pause: it winds the gain back up and brings the
       * room with it, so the hiss breathes between sentences.
       */
      if (target > this.reduction) {
        this.reduction += (target - this.reduction) * this.attackCoef;
      } else if (speaking) {
        this.reduction += (target - this.reduction) * this.releaseCoef;
      }

      /*
       * The ceiling, from what the levelling has actually settled on rather
       * than from where it is heading. Uncapped: holding the output below full
       * scale is protection, and refusing to do it because twelve decibels have
       * been spent already would be the cap defeating the thing it makes safe.
       */
      const projected = envDb - this.reduction + this.makeupDb;
      const over = projected > this.ceilingDb ? projected - this.ceilingDb : 0;

      this.ceiling +=
        (over - this.ceiling) *
        (over > this.ceiling ? this.ceilingAttackCoef : this.ceilingReleaseCoef);

      const gain = dbToGain(this.makeupDb - this.reduction - this.ceiling);

      const read = (this.write - this.lookahead + this.maxDelay) % this.maxDelay;

      for (let c = 0; c < channels; c++) {
        const value = this.delay[c][read] * gain;
        output[c][i] = value;

        const magnitude = Math.abs(value);
        if (magnitude > this.meterPeak) this.meterPeak = magnitude;
      }

      // Any channel the input did not supply is left silent rather than being
      // fed the previous buffer's contents.
      for (let c = channels; c < output.length; c++) output[c][i] = 0;

      // Both, added: what the meter should say is how much the chain took off
      // in total, not how much one half of it did.
      const total = this.reduction + this.ceiling;
      if (total > this.meterReduction) this.meterReduction = total;

      this.write = (this.write + 1) % this.maxDelay;

      if (--this.meterCountdown <= 0) {
        this.port.postMessage({
          peak: this.meterPeak,
          reduction: this.meterReduction,
          voiced: speaking,
        });
        this.meterCountdown = this.meterEvery;
        this.meterPeak = 0;
        this.meterReduction = 0;
      }
    }

    return true;
  }
}

registerProcessor('voice-leveller', VoiceLeveller);
