'use client';

import { useEffect, useRef, useState } from 'react';
import {
  PROFILE_LABEL,
  buildVoiceChain,
  type RecordProfile,
  type VoiceChain,
  type VoiceMeter,
} from '@/lib/voice-chain';

/**
 * Record in the browser and hand the result back as a file.
 *
 * `MediaRecorder` writes chunks as they arrive and produces a blob at the end,
 * so nothing is uploaded until you stop — a recording that is still running has
 * nothing to send. The blob then goes up the ordinary upload path, which means
 * no new infrastructure: it is a file like any other.
 *
 * There is no transcription provider wired up yet, so a recording is stored and
 * playable but not searchable.
 */

/**
 * All three of the browser's filters are off. The chain does the work instead.
 *
 * `{ audio: true }` accepts a voice-call processing chain — echo cancellation,
 * noise suppression, automatic gain — and every one of them is now refused, for
 * one reason with two halves.
 *
 * The first half is that two of them are destructive and nothing downstream can
 * undo them. AEC brings a high-pass and takes the bottom out; suppression is a
 * spectral gate that shuts the quiet detail at the top, which is what makes a
 * messaging app's voice notes unpleasant to hear twice. Suppression was on for
 * a while on the argument that a spoken note is a message rather than a
 * recording of a room. That argument was worth testing and it lost: what it
 * removes is breath, room and the tail of a word, and none of that comes back.
 *
 * The second half is the one that settles it. All three are *dynamic* — their
 * gain moves with the signal — and they sit in front of a compressor whose
 * whole job is to respond to the signal's level. Feeding a compressor something
 * that is already being modulated means it is chasing a thing that is chasing
 * it, which is exactly why `autoGainControl` had to go, and suppression is the
 * same mechanism aimed at frequency rather than level. Whatever is going to
 * shape the dynamics has to be the only thing shaping them, and that is now
 * `lib/voice-chain.ts`, where the numbers are written down and can be argued
 * with.
 *
 * What is left is the microphone as it hears the room, gain-staged
 * deliberately. Noisier than a phone call, and that is the trade: a bit of room
 * behind a voice is what makes a recording sound like a place rather than a
 * telephone.
 *
 * Stereo is asked for, which reverses the earlier mono decision now that the
 * level is under control. Mono was right while the point was to keep a voice
 * note small and a phone microphone is one capsule anyway; it stops being
 * right the moment you record anything that is not a voice, and an interface
 * with two inputs was being folded down for a saving that no longer matters at
 * this bitrate. A device with one capsule still gives one channel, because a
 * constraint is a request.
 *
 * Plain values rather than `exact`, so a device that can't honour one degrades
 * instead of throwing `OverconstrainedError` and leaving you with no recording
 * at all — which is why `channelCount` here is a request, and why the readout
 * reports what was actually granted rather than what was asked for.
 */
const VOICE_INPUT: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: 48_000,
  channelCount: 2,
};

/**
 * The best container this browser will actually encode.
 *
 * Opus first: at a sane bitrate it is transparent for speech and good enough
 * for a hummed idea, which the alternatives at this size are not. Safari
 * doesn't do WebM and gives AAC in an MP4 instead. An empty string tells
 * `MediaRecorder` to choose, which is the last resort rather than the default.
 */
function bestMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm',
  ];

  return (
    candidates.find(
      (type) =>
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
    ) ?? ''
  );
}

/**
 * 128 kbps stereo Opus.
 *
 * Back up from 32, and the reasoning that took it down is worth recording
 * because it was sound at the time and is not any more. 32k mono is what Opus
 * was designed for and is genuinely transparent *for speech* — the argument was
 * that four times the bitrate buys headroom for material there is none of.
 *
 * What changed is that the level is now under control, and a recording you can
 * actually hear is a recording you use for more than speech: a room, a rehearsal,
 * an idea hummed at an instrument. 32k mono is the wrong container for any of
 * those, and the thing about a lossy encode is that you find out afterwards.
 *
 * A megabyte a minute rather than a quarter of one. Uploads go straight to
 * Drive, so the ceiling is Drive's and the cost is the connection it goes up
 * on — which is worth a minute of a phone's data for something kept for years.
 */
const BITRATE = 128_000;

export function AudioRecorder({
  onDone,
  onCancel,
}: {
  onDone: (file: File) => void;
  onCancel: () => void;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const chain = useRef<VoiceChain | null>(null);
  /**
   * Read by the effect that builds the chain, which runs once on mount and
   * must not be torn down and restarted when the profile changes — that
   * would end the recording. The chain is told about the change instead.
   */
  const profileRef = useRef<RecordProfile>('voice');
  /**
   * Cancelling must not deliver the file. `stop()` fires `onstop`
   * asynchronously, so by the time it runs the component may already be gone
   * — a ref is the only thing both sides can still read.
   */
  const cancelled = useRef(false);

  /**
   * Held in a ref, not read from the closure. The call site passes an inline
   * arrow, so its identity changes on every render of the capture box — as an
   * effect dependency that would tear down and restart the recorder mid-word.
   * The effect runs once; this keeps it calling the current callback.
   */
  const deliver = useRef(onDone);

  // Assigned after commit rather than during render: writing a ref while
  // rendering is unsafe under concurrent rendering, and this one is only ever
  // read from `onstop`, long after either way.
  useEffect(() => {
    deliver.current = onDone;
  });


  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** What the microphone actually gave us, shown so the setting is checkable. */
  const [quality, setQuality] = useState<string | null>(null);
  /** Live level and gain reduction, so the chain is visible while it works. */
  const [meter, setMeter] = useState<VoiceMeter>({ peak: -Infinity, reduction: 0 });
  /**
   * Levelled for speech, or left alone.
   *
   * Starts on voice every time and is never remembered, which is the same
   * rule the capture screen applies to where a thought is going. A profile
   * that persisted would eventually squash a guitar or leave a voice note
   * nobody can hear, and you would only find out on playback.
   */
  const [profile, setProfile] = useState<RecordProfile>('voice');

  // Applied to a graph that is already running, so switching mid-take is
  // seamless. What is already encoded keeps the treatment it was given.
  useEffect(() => {
    profileRef.current = profile;
    chain.current?.setProfile(profile);
  }, [profile]);

  useEffect(() => {
    let ticker: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const start = async () => {
      let media: MediaStream;

      // Two different failures with two different remedies, so they get two
      // different sentences: being refused the microphone is something you fix
      // in the browser, and a recorder that won't start is not.
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: VOICE_INPUT });
      } catch {
        setError(
          'No microphone available, or permission was refused. Check the site permissions in your browser.',
        );
        return;
      }

      try {
        // Permission dialogs take as long as they take; by the time this
        // resolves the user may have cancelled out of the recorder entirely.
        if (stopped) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }

        stream.current = media;

        // What was asked for and what was granted are different questions, and
        // only the second one is audible. Showing it means a device quietly
        // ignoring the constraints is visible rather than a mystery.
        const settings = media.getAudioTracks()[0]?.getSettings() ?? {};

        /*
         * Everything between the microphone and the encoder. Built before the
         * recorder because the recorder is handed *its* output rather than the
         * microphone's — that is what makes the levelling free, since the
         * processed signal is the only one that is ever encoded.
         */
        const built = buildVoiceChain(media, profileRef.current);
        chain.current = built;

        /**
         * What was actually granted, not what was asked for.
         *
         * Constraints are requests — a device that cannot honour one is meant
         * to degrade rather than fail — so a microphone quietly ignoring the
         * channel count or the suppression flag should be visible here rather
         * than be a mystery about why one recording sounds unlike the rest.
         *
         * The chain is named too, because it is now the thing setting the
         * level: a recording that comes out wrong should say what was done to
         * it, not leave you guessing between the microphone and the processing.
         */
        setQuality(
          [
            settings.sampleRate ? `${Math.round(settings.sampleRate / 1000)} kHz` : null,
            settings.channelCount === 2 ? 'stereo' : 'mono',
            `${Math.round(BITRATE / 1000)} kbps`,
            /*
             * This now reports a *disagreement* rather than a setting. All
             * three filters are asked for as off, so anything other than "full
             * range" means the device refused — some phone microphones apply
             * their processing below the browser and cannot be talked out of
             * it. Worth naming plainly, because it is the first thing to
             * suspect when one recording sounds unlike the rest.
             */
            settings.noiseSuppression || settings.echoCancellation
              ? 'device filtering'
              : 'full range',
            built.processed ? null : 'unprocessed',
          ]
            .filter(Boolean)
            .join(' · '),
        );

        const mimeType = bestMimeType();
        const mr = new MediaRecorder(built.stream, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: BITRATE,
        });
        recorder.current = mr;

        mr.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.current.push(event.data);
        };

        mr.onstop = () => {
          // The microphone light stays on until every track is stopped, and
          // leaving it lit after a voice note is its own small betrayal. The
          // graph goes with it: a live `AudioContext` holds the device too.
          void chain.current?.close();
          chain.current = null;
          stream.current?.getTracks().forEach((t) => t.stop());
          stream.current = null;

          if (cancelled.current) return;

          const type = mr.mimeType || 'audio/webm';
          const blob = new Blob(chunks.current, { type });
          if (blob.size === 0) {
            setError('That recording came out empty.');
            return;
          }

          const stamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ')
            .replace(/:/g, '-');

          deliver.current(
            new File([blob], `Voice note ${stamp}.${extensionFor(type)}`, { type }),
          );
        };

        mr.start();
        ticker = setInterval(() => setSeconds((s) => s + 1), 1000);
      } catch {
        // The microphone was granted and then the recorder refused it — a dead
        // track, or a format this browser won't encode.
        void chain.current?.close();
        chain.current = null;
        media.getTracks().forEach((t) => t.stop());
        stream.current = null;
        setError('This browser could not start recording from that microphone.');
      }
    };

    void start();

    return () => {
      stopped = true;
      if (ticker) clearInterval(ticker);
      // Unmounting mid-recording is a cancel, not a save.
      cancelled.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      void chain.current?.close();
      chain.current = null;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
    // Once, on mount. The callback is reached through `deliver`.
  }, []);

  /**
   * The meters, read on animation frames and reported about ten times a second.
   *
   * Separate from the graph because they are the one part of this that has to
   * keep up with the sound rather than with the clock. Read every frame so a
   * transient is caught, published far less often — a meter that re-rendered at
   * sixty hertz would cost more than the audio processing it is reporting on.
   */
  useEffect(() => {
    let raf = 0;
    let publishedAt = 0;
    let held: VoiceMeter = { peak: -Infinity, reduction: 0 };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);

      const current = chain.current?.read();
      if (!current) return;

      // Hold the highest peak seen since the last publish, so a syllable
      // between two frames is not simply missed.
      held = {
        peak: Math.max(held.peak, current.peak),
        reduction: Math.max(held.reduction, current.reduction),
      };

      if (now - publishedAt < 90) return;
      publishedAt = now;
      setMeter(held);
      held = { peak: -Infinity, reduction: 0 };
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const finish = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    else onCancel();
  };

  /**
   * Not a size warning any more — uploads go straight to Drive, so at Opus's
   * usual bitrate the ceiling is measured in days. This is about the recording
   * itself: past about half an hour you almost certainly meant to stop, and the
   * whole thing lives in memory until you do.
   */
  const nearLimit = seconds > 30 * 60;

  if (error) {
    return (
      <div className="mb-2 flex items-center justify-between gap-3 rounded-sm bg-grey-100 px-2 py-1.5">
        <span className="text-[11px] text-stale">{error}</span>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="mb-2 flex flex-col gap-1 rounded-sm bg-grey-100 px-2 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-grey-700">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-waiting" />
          Recording · <span className="tabular-nums">{clock(seconds)}</span>
          {quality ? <span className="text-grey-500">{quality}</span> : null}
          {/* Rendered from the toggle rather than baked into `quality` when the
              chain was built, or it would go on describing the profile you
              started in after you had switched out of it. */}
          <span className="text-grey-500">{PROFILE_LABEL[profile]}</span>
          {nearLimit ? <span className="text-grey-500">— still recording</span> : null}
        </span>

        <span className="flex shrink-0 items-center gap-3">
          {/*
            On screen for the whole take, because it is the one setting that
            can ruin one. Switchable mid-recording: the graph is already
            running and only its parameters move, and the moment you find out
            the chain is wrong for what you are playing is the moment you have
            started playing it.
          */}
          <span className="flex overflow-hidden rounded-sm border border-grey-300">
            {(['voice', 'music'] as const).map((which) => (
              <button
                key={which}
                type="button"
                aria-pressed={profile === which}
                onClick={() => setProfile(which)}
                title={
                  which === 'voice'
                    ? 'Levelled hard, so a quiet note is still audible'
                    : 'Flat — no drive, no compression, just a safety limiter'
                }
                className={[
                  'px-1.5 py-0.5 text-[11px]',
                  profile === which
                    ? 'bg-grey-800 text-paper'
                    : 'bg-paper text-grey-600 hover:text-grey-900',
                ].join(' ')}
              >
                {which === 'voice' ? 'Voice' : 'Music'}
              </button>
            ))}
          </span>

          <button
            type="button"
            onClick={() => {
              cancelled.current = true;
              finish();
              onCancel();
            }}
            className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={finish}
            className="rounded-sm bg-grey-800 px-2 py-0.5 text-[11px] text-paper"
          >
            Stop
          </button>
        </span>
      </div>

      <LevelMeter meter={meter} />
    </div>
  );
}

/**
 * What the chain is doing, while it does it.
 *
 * Two numbers rather than a waveform, because the two questions worth asking
 * are "is this reaching the ceiling" and "how hard is it being held back", and a
 * waveform answers neither. The peak scale runs from −48 dBFS, which is far
 * enough down to show a room going quiet and shallow enough that ordinary
 * speech fills most of the bar.
 *
 * It is also the thing that makes a bad recording diagnosable afterwards: a bar
 * that never left the left-hand end means the microphone, and one pinned at the
 * right with ten decibels of reduction means the chain was working and the
 * problem is somewhere else.
 */
function LevelMeter({ meter }: { meter: VoiceMeter }) {
  const FLOOR = -48;
  const level = Math.max(0, Math.min(1, (meter.peak - FLOOR) / -FLOOR));
  // Twelve decibels of reduction fills the bar — beyond that the chain is being
  // asked to do something it should not have to.
  const squash = Math.max(0, Math.min(1, meter.reduction / 12));

  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-grey-300"
        role="meter"
        aria-label="Recording level"
        aria-valuenow={Math.round(level * 100)}
      >
        <div
          className="h-full rounded-full bg-grey-700 transition-[width] duration-75"
          style={{ width: `${level * 100}%` }}
        />
      </div>

      <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-grey-500">
        {meter.peak === -Infinity ? '−∞' : meter.peak.toFixed(1)} dB
      </span>

      <div
        className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-grey-300"
        role="meter"
        aria-label="Gain reduction"
        aria-valuenow={Math.round(meter.reduction)}
      >
        <div
          className="h-full rounded-full bg-waiting transition-[width] duration-75"
          style={{ width: `${squash * 100}%` }}
        />
      </div>

      <span
        className="w-14 shrink-0 text-right text-[10px] tabular-nums text-grey-500"
        title="Gain reduction"
      >
        −{meter.reduction.toFixed(1)} GR
      </span>
    </div>
  );
}

function clock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Browsers disagree: Chrome gives webm, Safari mp4. Both carry a codec tag. */
function extensionFor(mimeType: string): string {
  const base = mimeType.split(';')[0].trim();
  if (base === 'audio/mp4' || base === 'audio/aac') return 'm4a';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/mpeg') return 'mp3';
  return 'webm';
}
