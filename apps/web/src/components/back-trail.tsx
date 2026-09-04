import Link from 'next/link';

/**
 * The way back to whatever you followed a link from.
 *
 * The full-screen view puts this in its header, where there is a header to put
 * it in. In the panes there is not — a detail pane starts at the row's own
 * title — so it goes above that as one quiet line, which is also where a
 * breadcrumb belongs on a page that has one.
 *
 * It is the same journey either way, and that is the point of having it in both
 * places: following a note's link into another action and then wanting the note
 * back is the same wish whichever size the window is, and answering it in only
 * one of them makes the other feel like the broken one.
 *
 * Rendered from `back` in the URL rather than from history, so it survives a
 * refresh and a shared link — and so that one step is genuinely one step. It
 * says where you came *from*, never "up": what a row belongs to is a different
 * question, and the header answers that one separately.
 */
export function BackTrail({ label, href }: { label: string; href: string }) {
  return (
    <p className="mb-2 truncate text-[11px] text-grey-500">
      <span aria-hidden className="mr-0.5">
        ‹
      </span>
      <Link href={href} className="underline underline-offset-2 hover:text-grey-800">
        {label}
      </Link>
    </p>
  );
}
