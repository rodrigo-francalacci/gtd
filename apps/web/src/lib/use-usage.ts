'use client';

/**
 * Recording that something was opened, from the browser.
 *
 * `sendBeacon` rather than `fetch`, because this fires on a click that is
 * about to navigate. A `fetch` started during a navigation is cancelled when
 * the page tears down — reliably enough that the counts would be roughly
 * "things you clicked and then didn't go anywhere", which is the opposite of
 * what is wanted. A beacon is handed to the browser and delivered regardless.
 *
 * Beacons carry cookies, so the session goes with it. `keepalive` on a fetch
 * would do the same job; `sendBeacon` says what it is for.
 */
import type { UsableType } from './usage.shared';

export type { UsableType };

export function recordUse(type: UsableType, id: string): void {
  const body = JSON.stringify({ type, id });

  // A `Blob` with the right type, because `sendBeacon` sends a bare string as
  // `text/plain;charset=UTF-8` and the route reads JSON.
  const payload = new Blob([body], { type: 'application/json' });

  if (navigator.sendBeacon?.('/api/usage', payload)) return;

  /**
   * Safari has historically refused beacons with a non-CORS-safelisted type,
   * and returns false rather than throwing. The fallback is the same request
   * with `keepalive`, which survives the navigation for the same reason.
   */
  void fetch('/api/usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Nothing to do. A missed count is a row one place lower in a sort.
  });
}
