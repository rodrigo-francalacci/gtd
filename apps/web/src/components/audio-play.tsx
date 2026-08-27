'use client';

import { useEffect, useRef, useState } from 'react';
import { playableAudio } from '@/lib/audio-repair';
import { IconAudio, IconPlay, IconStop } from './icons';

/**
 * One clip playing at a time, across the whole page.
 *
 * Module-level rather than a context, because there is nothing to configure
 * and no tree to scope it to: two voice notes talking over each other is
 * wrong everywhere, and the rule is the same on a project pane as anywhere
 * else. Each button hands over the stopper for the one it started.
 */
let stopCurrent: (() => void) | null = null;

/**
 * Play a voice note where it sits, with no player.
 *
 * The transport controls are the right answer in a feed, where a recording is
 * the entry and you may want to scrub back over a mumbled word. In an
 * attachments list it is the wrong one: the row is a filename with a size
 * beside it, and a full-width player wedged into it turns a tidy list into a
 * stack of widgets. What is actually wanted is to hear the thing without
 * losing the pane you are looking at — so the row's own icon becomes the
 * control, and there is nothing else to see.
 *
 * Stop rather than pause, deliberately. These are seconds long and there is no
 * timeline on offer, so resuming from the middle would leave you no way of
 * knowing where the middle was.
 */
export function AudioPlay({ src, name }: { src: string; name: string }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      // Leaving the pane stops the sound. A voice note still playing from a
      // row that is no longer on screen has nothing to stop it.
      audio.current?.pause();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      if (stopCurrent && audio.current) stopCurrent = null;
    },
    [],
  );

  const stop = () => {
    audio.current?.pause();
    if (audio.current) audio.current.currentTime = 0;
    setPlaying(false);
    stopCurrent = null;
  };

  const play = async () => {
    stopCurrent?.();
    setFailed(null);

    /**
     * Fetched into a blob rather than pointed at the endpoint.
     *
     * A media element loads over its own path, separate from `fetch`, and
     * negotiates ranges before it will admit to a duration — easy to get
     * subtly wrong through a proxy and hard to tell from a broken file. The
     * preview pane learned this the same way. Fetched once and kept: pressing
     * play twice should not cost two downloads.
     */
    if (!audio.current) {
      setLoading(true);
      try {
        const response = await fetch(src);
        if (!response.ok) {
          const body = response.headers.get('content-type')?.includes('json')
            ? ((await response.json().catch(() => null)) as { error?: string } | null)
            : null;
          throw new Error(body?.error ?? 'That file would not play.');
        }

        // Repaired on the way past, if it needs it — see `lib/audio-repair`.
        // The bytes are already here, which is the only place the fix can be
        // made: an element streaming from a URL is committed before it finds
        // the bad frame.
        const playable = await playableAudio(await response.blob());
        const url = URL.createObjectURL(playable);
        objectUrl.current = url;

        /**
         * The element's own events drive the button, not the promise from
         * `play()`.
         *
         * That promise resolves when playback actually begins, and under an
         * autoplay policy it can sit pending indefinitely rather than
         * rejecting — which left the button showing "play" while the clip was
         * either starting or never going to. Listening instead means the icon
         * follows what the audio is really doing, and picks up an end, an
         * error or a pause from anywhere without being told.
         */
        const element = new Audio(url);
        element.onplaying = () => setPlaying(true);
        element.onpause = () => setPlaying(false);
        element.onended = () => {
          setPlaying(false);
          stopCurrent = null;
        };
        element.onerror = () => {
          setPlaying(false);
          setFailed('That file would not play.');
        };
        audio.current = element;
      } catch (error) {
        setFailed(error instanceof Error ? error.message : 'That file would not play.');
        setLoading(false);
        return;
      } finally {
        setLoading(false);
      }
    }

    // Not awaited: see above. A rejection is still worth reporting, but the
    // button must not wait on a promise that may never settle.
    stopCurrent = stop;
    audio.current.play().catch(() => {
      setPlaying(false);
      setFailed('That browser would not play it. Open it in Drive instead.');
    });
  };

  const label = failed
    ? failed
    : loading
      ? `Loading ${name}…`
      : playing
        ? `Stop ${name}`
        : `Play ${name}`;

  return (
    <button
      type="button"
      onClick={() => (playing ? stop() : void play())}
      disabled={loading}
      title={label}
      aria-label={label}
      className={[
        'shrink-0 rounded-sm',
        failed
          ? 'text-stale'
          : playing
            ? 'text-grey-800'
            : 'text-grey-400 hover:text-grey-700',
      ].join(' ')}
    >
      {/* The microphone stays while it loads, so the row doesn't flicker
          through three icons on a file that opens in a moment. */}
      {loading || failed ? <IconAudio /> : playing ? <IconStop /> : <IconPlay />}
    </button>
  );
}
