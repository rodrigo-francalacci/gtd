'use client';

import { useEffect, useState } from 'react';
import { playableAudio } from './audio-repair';

/**
 * The bits of the preview pane that more than one viewer needs.
 *
 * Extracted when the audio player grew a transcript beside it and stopped
 * being a single component: two things now fetch bytes the same way and report
 * a failure the same way, and the alternative to a shared module was a
 * circular import between the pane and the player it renders.
 */

export const GENERIC = 'That file would not load.';

/**
 * Why a preview failed, in words worth showing.
 *
 * An `<img>` or an `<iframe>` reports only that it did not load, which for
 * every file in the app at once is a true statement pointing in the wrong
 * direction. The endpoint knows better — a withdrawn Google grant is the usual
 * cause and is fixed on one page — so this asks it, and falls back to the
 * generic line when there is nothing better to say.
 */
export async function reasonFor(src: string): Promise<string> {
  try {
    return await reasonFrom(await fetch(src));
  } catch {
    return GENERIC;
  }
}

export async function reasonFrom(response: Response): Promise<string> {
  if (!response.headers.get('content-type')?.includes('json')) return GENERIC;

  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? GENERIC;
}

/**
 * A media file, fetched into a blob rather than pointed at the endpoint.
 *
 * A media element loads over its own path, separate from `fetch`, and it
 * negotiates ranges before it will admit to a duration — an easy thing to get
 * subtly wrong through a proxy, and hard to tell apart from a broken file when
 * it does. Handing it bytes it already has removes the negotiation entirely:
 * the clip either decodes or it doesn't.
 *
 * It matters more now than it did. A transcript is typed against the timeline,
 * so a clip whose length the browser will not commit to is not merely
 * inelegant — it is unusable for the one job this pane exists to do.
 */
export function useMediaBlob(src: string): {
  objectUrl: string | null;
  error: string | null;
} {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let live = true;

    void (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) {
          // The body usually says something worth repeating — a revoked
          // Google grant, most often, which is not a fact about this file.
          const reason = await reasonFrom(response);
          if (live) setError(reason);
          return;
        }

        /*
         * Repaired on the way past, if it needs it and only if it needs it.
         *
         * Having the whole file in hand is what makes this possible at all: a
         * defect in the first frame cannot be fixed by an element streaming
         * from a URL, which is already committed by the time it finds one.
         */
        const blob = await playableAudio(await response.blob());
        if (!live) return;

        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      } catch {
        if (live) setError(GENERIC);
      }
    })();

    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);

  return { objectUrl, error };
}
