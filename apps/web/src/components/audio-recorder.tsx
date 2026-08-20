'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Record in the browser and hand the result back as a file.
 *
 * `MediaRecorder` writes chunks as they arrive and produces a blob at the end,
 * so nothing is uploaded until you stop — a recording that is still running
 * has nothing to send. The blob then goes up the ordinary upload path, which
 * means no new infrastructure: it is a file like any other.
 *
 * There is no transcription provider wired up yet, so a recording is stored
 * and playable but not searchable.
 */

/**
 * Ask for the microphone *raw*.
 *
 * `{ audio: true }` accepts the browser's defaults, and the defaults are a
 * voice-call processing chain: echo cancellation, noise suppression and
 * automatic gain. That chain is why messaging-app voice notes sound the way
 * they do — it high-passes the bottom out, gates the quiet detail at the top,
 * and rides the level up and down. Fine for a phone call, wrong for anything
 * you might want to keep or listen to twice.
 *
 * Plain values rather than `exact`, so a device that can't honour one degrades
 * instead of throwing `OverconstrainedError` and leaving you with no recording
 * at all. `channelCount` is deliberately unconstrained: a built-in mic is mono
 * and an interface is stereo, and taking what the hardware actually offers is
 * more faithful than insisting on either.
 */
const RAW_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: 48_000,
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
 * 128 kbps, against a messaging app's 16–32.
 *
 * Uploads go straight to Drive, so the ceiling is not ours to worry about: this
 * is roughly a megabyte a minute, and the difference between a recording you
 * keep and one you tolerate.
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

  useEffect(() => {
    let ticker: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const start = async () => {
      let media: MediaStream;

      // Two different failures with two different remedies, so they get two
      // different sentences: being refused the microphone is something you fix
      // in the browser, and a recorder that won't start is not.
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO });
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
        setQuality(
          [
            settings.sampleRate ? `${Math.round(settings.sampleRate / 1000)} kHz` : null,
            settings.channelCount === 2 ? 'stereo' : 'mono',
            settings.noiseSuppression || settings.echoCancellation ? 'processed' : 'raw',
          ]
            .filter(Boolean)
            .join(' · '),
        );

        const mimeType = bestMimeType();
        const mr = new MediaRecorder(media, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: BITRATE,
        });
        recorder.current = mr;

        mr.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.current.push(event.data);
        };

        mr.onstop = () => {
          // The microphone light stays on until every track is stopped, and
          // leaving it lit after a voice note is its own small betrayal.
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
      stream.current?.getTracks().forEach((t) => t.stop());
    };
    // Once, on mount. The callback is reached through `deliver`.
  }, []);

  const finish = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    else onCancel();
  };

  /**
   * Not a size warning any more — uploads go straight to Drive, so at Opus's
   * usual bitrate the ceiling is measured in days. This is about the recording
   * itself: past about half an hour you almost certainly meant to stop, and
   * the whole thing lives in memory until you do.
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
    <div className="mb-2 flex items-center justify-between gap-3 rounded-sm bg-grey-100 px-2 py-1.5">
      <span className="flex items-center gap-2 text-[11px] text-grey-700">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-waiting" />
        Recording · <span className="tabular-nums">{clock(seconds)}</span>
        {quality ? <span className="text-grey-500">{quality}</span> : null}
        {nearLimit ? (
          <span className="text-grey-500">— still recording</span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-3">
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
