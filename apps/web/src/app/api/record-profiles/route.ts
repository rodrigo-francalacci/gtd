import { NextResponse } from 'next/server';
import {
  BITRATE,
  CLIP_CEILING,
  CLIP_KNEE,
  HIGHPASS_HZ,
  LEVELLER,
  SAMPLE_RATE,
} from '@/lib/record-profiles';

export const dynamic = 'force-dynamic';

/**
 * How to set the record button, for anything that is not this app.
 *
 * The Chrome sidebar records into the same boxes as the composer, and until now
 * recorded the raw microphone — no high-pass, no leveller, and the browser's own
 * automatic gain left on. So a voice note made in the sidebar was the quiet,
 * uneven thing the app spent a week fixing, and the two sounded nothing alike.
 *
 * The obvious fix was to copy the chain into the extension, and that is the trap
 * this repository keeps warning about: two definitions disagree the first time
 * either is tuned, and the symptom is one recording that sounds unlike the rest
 * with nothing anywhere reporting a problem. So the extension holds neither the
 * numbers nor the algorithm — it fetches these, and fetches the worklet itself
 * from `/voice-leveller.js`.
 *
 * **No session.** These are constants, not anybody's data: eleven numbers about
 * decibels, which say nothing about the account and are already in a public
 * repository. Requiring a session would mean the sidebar could not build its
 * chain until you had signed in, which is a worse recording rather than a safer
 * one. `Access-Control-Allow-Origin: *` for the same reason — a worklet module
 * is always fetched in CORS mode, and the caller is a `chrome-extension://`
 * origin that cannot be named in advance.
 */
export function GET() {
  return NextResponse.json(
    {
      highpassHz: HIGHPASS_HZ,
      leveller: LEVELLER,
      clip: { knee: CLIP_KNEE, ceiling: CLIP_CEILING },
      sampleRate: SAMPLE_RATE,
      bitrate: BITRATE,
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        // A minute is long enough that a recording never waits on this twice in
        // a sitting, and short enough that a retune reaches the sidebar today.
        'Cache-Control': 'public, max-age=60',
      },
    },
  );
}
