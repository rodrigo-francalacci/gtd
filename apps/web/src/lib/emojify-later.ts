'use client';

import { emojifyRows, type EmojiTarget } from './actions';

/**
 * Give a thing an emoji after it has already been saved.
 *
 * The point is that capture must not wait. A model call is a second or two, and
 * the whole design of capture is that the thought lands the instant you press
 * the button and you can type the next one — the same rule the suggester on a
 * capture already follows, and the reason uploads happen after the row is
 * written rather than before it.
 *
 * So this is *called and not awaited*, from the client, after the write has
 * returned. It cannot be a fire-and-forget inside the Server Action: a
 * serverless function is entitled to stop the moment it responds, so work left
 * running after the return is work that may simply not happen. From the browser
 * it is an ordinary second request that either finishes or doesn't.
 *
 * **Nothing depends on it.** Every outcome is survivable by construction:
 *
 *   - no API key, or the model declines — the row keeps no emoji, which is the
 *     state every row was in until you pressed a button anyway;
 *   - the row is deleted before this lands — the update matches nothing;
 *   - the request fails, or the tab is closed mid-flight — same as above, and
 *     the Emojify button on the list is exactly the thing that fills the gap
 *     later;
 *   - it runs twice — the second call sees an emoji already there and, because
 *     `emojifyRows` skips marked rows unless asked to redo, does nothing.
 *
 * Which is why it is safe to call without looking at what it returns, and why
 * this file exists rather than the call being written out five times.
 */
export function emojifyLater(target: EmojiTarget, id: string | null | undefined): void {
  if (!id) return;

  void emojifyRows(target, [id]).catch(() => {
    // Deliberately silent. A capture that succeeded must never report a failure
    // about a decoration on it — the row is saved, which is the thing you asked
    // for, and a red line about an emoji would say otherwise.
  });
}
