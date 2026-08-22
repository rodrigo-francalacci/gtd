'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaBlob } from '@/lib/preview-media';

/**
 * A recording, and a place to write down what it says.
 *
 * Audio is the one thing in this app that search cannot see inside: there is
 * no speech provider wired up, so `enqueueEnrichment` refuses it rather than
 * queue a job nothing can run. This is the manual path to the same columns —
 * play it, type what you hear — and it is why the player is not the browser's
 * default one. Transcribing is a loop of *back a bit, play, pause, type*, and
 * the native control cannot do the first of those at all.
 *
 * The buttons are separate rather than one play/pause toggle because that is
 * the shape of the work: a toggle punishes the reflex of hitting pause twice
 * by starting playback again under your hands, in a control you are using
 * precisely because you have stopped looking at it.
 */
export function AudioTranscript({
  src,
  transcriptUrl,
}: {
  src: string;
  /** Where the words live. Null for a source with nowhere to put them. */
  transcriptUrl: string | null;
}) {
  const { objectUrl, error } = useMediaBlob(src);

  if (error) {
    return <p className="p-6 text-center text-[12px] text-grey-500">{error}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <Player objectUrl={objectUrl} />
      {transcriptUrl ? (
        <Transcript url={transcriptUrl} />
      ) : (
        <p className="p-6 text-center text-[11px] text-grey-500">
          Nowhere to keep a transcript for this one.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Player({ objectUrl }: { objectUrl: string | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const seekTo = useCallback((seconds: number) => {
    const el = audio.current;
    if (!el) return;

    // `duration` can still be Infinity here; clamping against it would send
    // the clip to the end. The element clamps for us anyway.
    const next = Math.max(0, seconds);
    el.currentTime = Number.isFinite(el.duration) ? Math.min(next, el.duration) : next;
    setTime(el.currentTime);
  }, []);

  /**
   * What a recording made in this app reports as its length: nothing.
   *
   * `MediaRecorder` writes WebM without a Duration element — it is streaming
   * and does not know the length until it stops, and it never goes back to
   * fill it in. So `duration` is `Infinity` and the timeline has no scale,
   * which would break the scrubber for exactly the files the record button
   * produces, and for no others.
   *
   * Seeking past any plausible end makes the browser scan the cues it does
   * have and settle on a real figure; then it goes back to the start. Free
   * against a blob, which is already in memory. Guarded, because a browser is
   * within its rights to reject an absurd `currentTime` outright, and a
   * timeline without a scale is better than a player that threw.
   */
  const onLoadedMetadata = () => {
    const el = audio.current;
    if (!el) return;

    if (Number.isFinite(el.duration)) {
      setDuration(el.duration);
      return;
    }

    const settle = () => {
      el.removeEventListener('timeupdate', settle);
      if (Number.isFinite(el.duration)) setDuration(el.duration);
      el.currentTime = 0;
      setTime(0);
    };

    el.addEventListener('timeupdate', settle);
    try {
      el.currentTime = 1e101;
    } catch {
      el.removeEventListener('timeupdate', settle);
    }
  };

  const stop = () => {
    const el = audio.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setTime(0);
  };

  const label = (seconds: number) => {
    if (!Number.isFinite(seconds)) return '--:--';
    const whole = Math.floor(seconds);
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const ready = objectUrl !== null;

  return (
    <div className="shrink-0 border-b border-grey-200 bg-grey-50 px-3 py-2.5">
      <audio
        ref={audio}
        src={objectUrl ?? undefined}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={() => {
          const el = audio.current;
          if (el && Number.isFinite(el.duration)) setDuration(el.duration);
        }}
        onTimeUpdate={() => setTime(audio.current?.currentTime ?? 0)}
        /*
         * State follows the element, never the call. `play()` returns a promise
         * that does not settle while the autoplay policy is deciding, so a
         * handler that awaited it could sit there indefinitely with the button
         * showing the wrong thing. These fire when it actually happens.
         */
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />

      <div className="flex items-center gap-1">
        <Key onPress={() => seekTo(time - 5)} disabled={!ready} title="Back 5 seconds">
          −5s
        </Key>
        <Key
          onPress={() => void audio.current?.play()}
          disabled={!ready}
          active={playing}
          title="Play"
        >
          <IconPlay />
        </Key>
        <Key onPress={() => audio.current?.pause()} disabled={!ready} title="Pause">
          <IconPause />
        </Key>
        <Key onPress={stop} disabled={!ready} title="Stop and rewind">
          <IconStop />
        </Key>
        <Key onPress={() => seekTo(time + 5)} disabled={!ready} title="Forward 5 seconds">
          +5s
        </Key>

        <span className="ml-auto shrink-0 tabular-nums text-[11px] text-grey-500">
          {label(time)} / {label(duration)}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={duration > 0 ? duration : 0}
        step={0.01}
        value={Math.min(time, duration || 0)}
        disabled={!ready || duration === 0}
        onChange={(e) => seekTo(Number(e.target.value))}
        /* Same reason as the buttons: dragging the timeline must not cost you
           your place in the text. */
        onMouseDown={(e) => e.preventDefault()}
        aria-label="Position"
        className="mt-2 w-full accent-selected"
      />
    </div>
  );
}

/**
 * A transport button that does not take the caret with it.
 *
 * The whole design is "listen with one hand, type with the other", and a
 * button that steals focus ends every rewind with a click back into the
 * textarea to find your place. Suppressing the default on `mousedown` keeps
 * the caret exactly where it was; the click still fires.
 */
function Key({
  onPress,
  disabled,
  active,
  title,
  children,
}: {
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      onMouseDown={(e) => e.preventDefault()}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={[
        'flex h-8 min-w-8 items-center justify-center rounded-sm border px-1.5 text-[11px] tabular-nums',
        'disabled:opacity-40',
        active
          ? 'border-grey-800 bg-grey-800 text-paper'
          : 'border-grey-300 text-grey-700 hover:border-grey-500',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function IconPlay() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <path d="M2.5 1.5v9l8-4.5z" fill="currentColor" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <path d="M3 1.5h2.2v9H3zM6.8 1.5H9v9H6.8z" fill="currentColor" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <rect x="2.5" y="2.5" width="7" height="7" fill="currentColor" />
    </svg>
  );
}

// ---------------------------------------------------------------------------

const SAVE_AFTER_MS = 900;

/**
 * The words, autosaved.
 *
 * Fetched here rather than handed down as a prop, and that is what keeps
 * transcripts out of every list payload: they belong to the one file open in
 * front of you, not to the props of a project pane that only wanted filenames.
 */
function Transcript({ url }: { url: string }) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  /** The latest text, for a save that outlives the render that scheduled it. */
  const latest = useRef('');
  /** What the server is known to hold, so an unchanged draft isn't rewritten. */
  const saved = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const response = await fetch(url);
        const body = (await response.json().catch(() => null)) as { text?: string } | null;
        if (!live) return;
        const value = typeof body?.text === 'string' ? body.text : '';
        latest.current = value;
        saved.current = value;
        setText(value);
      } finally {
        if (live) setLoaded(true);
      }
    })();

    return () => {
      live = false;
    };
  }, [url]);

  const save = useCallback(async () => {
    const value = latest.current;
    if (value === saved.current) return;

    setState('saving');
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      if (!response.ok) throw new Error('save failed');
      saved.current = value;
      setState('saved');
    } catch {
      setState('error');
    }
  }, [url]);

  /*
   * A pending save is flushed when the pane closes or the file changes.
   *
   * Without this the last thing typed is the thing lost, every time — you stop
   * typing because you are done, and being done is exactly when you close it.
   */
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void save();
    };
  }, [save]);

  const edit = (value: string) => {
    setText(value);
    latest.current = value;
    setState('idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_AFTER_MS);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline justify-between gap-2 px-3 pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          Transcript
        </span>
        <span
          className={[
            'text-[10px]',
            state === 'error' ? 'text-stale' : 'text-grey-400',
          ].join(' ')}
        >
          {state === 'saving'
            ? 'Saving…'
            : state === 'saved'
              ? 'Saved'
              : state === 'error'
                ? 'Not saved — it will try again as you type'
                : ''}
        </span>
      </div>

      <textarea
        value={text}
        onChange={(e) => edit(e.target.value)}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          void save();
        }}
        readOnly={!loaded}
        placeholder={loaded ? 'Type what you hear…' : 'Loading…'}
        spellCheck
        className="min-h-0 flex-1 resize-none border-none bg-paper px-3 py-2 text-[13px] leading-relaxed text-grey-900 placeholder:text-grey-400 focus:outline-none"
      />
    </div>
  );
}
