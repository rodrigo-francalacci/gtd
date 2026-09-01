'use client';

/**
 * The bridges' "sync everything", as a control in the sidebar.
 *
 * Pressing sync used to mean opening the panel in a tab, finding the button,
 * pressing it, and coming back — which is four steps around something you do
 * because you just scanned a receipt and want to see it arrive. Here it sits
 * beside the theme switch and is one click from wherever you are.
 *
 * **It has to be a frame.** The work is Gmail and Drive under *your* Google
 * account, through scopes this app deliberately does not hold; only the Apps
 * Script can do it. A frame is how a page from another origin gets to run its
 * own code with its own permissions, and `google.script.run` inside it is what
 * actually presses the button.
 *
 * Nothing is passed in or out. The frame cannot read this page and this page
 * cannot read the frame — different origins — so there is no state to keep in
 * step and no message channel to get wrong. What it reports, it reports on its
 * own face.
 *
 * Absent until the panel has been deployed and its address saved, because a
 * frame pointing nowhere is a broken rectangle in the one column that is always
 * on screen.
 */
export function SyncButton({ url }: { url: string | null }) {
  if (!url) return null;

  /*
   * `?only=sync` is the same deployment rendering one button rather than the
   * whole panel — one URL to keep, one thing to redeploy.
   */
  const src = `${url}${url.includes('?') ? '&' : '?'}only=sync`;

  return (
    <iframe
      src={src}
      title="Sync everything"
      /*
       * Sized to the control inside it. An iframe cannot grow to its content
       * across origins, so the height is the button's height and the width is
       * what the word needs — anything else would be a scrollbar or a gap.
       */
      className="h-[18px] w-[74px] border-0"
      /*
       * Deliberately not sandboxed, for the reason the Apps Script panel in the
       * preview pane is not: this is one page, from one origin the app checked
       * before storing the address, and its entire purpose is to run something
       * when pressed. A sandbox would leave a button that cannot.
       */
      scrolling="no"
    />
  );
}
