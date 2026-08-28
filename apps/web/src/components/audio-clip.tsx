'use client';

import { useEffect, useRef, useState } from 'react';
import { playableAudio } from '@/lib/audio-repair';
import { GENERIC, reasonFrom } from '@/lib/preview-media';

/**
 * The browser's own transport, over a file the browser might refuse.
 *
 * The feed plays a recording where it sits, because a voice note has no title
 * and no summary and is the one entry you cannot judge without hearing it. The
 * native control is right there — it is the one every phone and desktop has
 * trained everyone to use, and a feed is not the place to be taught a new one.
 *
 * **The bytes are not fetched until they are wanted.** `preload="none"` and a
 * plain `src` is what makes a day of recordings cost nothing to scroll past,
 * and that is why this cannot simply do what the preview pane does: the pane
 * fetches into a blob on open, which is correct for the one file you asked to
 * look at and wrong for twenty you are scrolling past.
 *
 * So the repair is the fallback rather than the default. The element is pointed
 * at the endpoint and left alone; only when it actually fails does this fetch
 * the file, run `lib/audio-repair` over it, and hand back bytes the browser
 * will accept. A good file never pays for any of it, and a bad one costs one
 * download at the moment somebody pressed play.
 */
export function AudioClip({ src, className }: { src: string; className?: string }) {
  const element = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  /** Whether the repair has already been attempted, so a second failure is final. */
  const attempted = useRef(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  const repair = async () => {
    /*
     * A second error is the repaired file failing too, which means the fault
     * was never the one this knows how to fix. Saying so is better than
     * fetching the same bytes again to fail the same way.
     */
    if (attempted.current) {
      setFailed(GENERIC);
      return;
    }
    attempted.current = true;

    try {
      const response = await fetch(src);
      if (!response.ok) {
        // Usually a withdrawn Google grant, which is not a fact about this
        // file and is fixed on one page.
        setFailed(await reasonFrom(response));
        return;
      }

      const url = URL.createObjectURL(await playableAudio(await response.blob()));
      objectUrl.current = url;

      const audio = element.current;
      if (!audio) return;

      audio.src = url;
      audio.load();

      /*
       * Play, because the person pressed play — the failure they are waiting
       * out is invisible to them. If the autoplay policy refuses it the clip
       * is loaded anyway and the next press works, which is the whole reason
       * this does not throw the refusal away.
       */
      await audio.play().catch(() => {});
    } catch {
      setFailed(GENERIC);
    }
  };

  if (failed) {
    return <span className="block text-[11px] text-stale">{failed}</span>;
  }

  return (
    <audio
      ref={element}
      src={src}
      controls
      preload="none"
      onError={() => void repair()}
      className={className}
    />
  );
}
