import type { SVGProps } from 'react';

/**
 * 14px stroke glyphs, deliberately monochrome.
 *
 * Old Evernote put grey notebook marks beside each sidebar row (the colourful
 * bits in that UI were emoji the user typed into notebook *names*). Keeping
 * these greyscale means the palette rule still holds: colour stays reserved
 * for waiting, stale and selection.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Glyph({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/** Inbox — a tray. */
export const IconInbox = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.2 9.4h3.2l1 1.8h3.2l1-1.8h3.2" />
    <path d="M2.2 9.4 3.9 3.2h8.2l1.7 6.2v3.4H2.2z" />
  </Glyph>
);

/** Now / what can I do — a target. */
export const IconNow = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="6" />
    <circle cx="8" cy="8" r="2.2" />
  </Glyph>
);

/** Waiting for — a clock. */
export const IconWaiting = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.6V8l2.4 1.4" />
  </Glyph>
);

/** File actions — tray with an arrow in. */
export const IconFile = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.5 9.5h3l1 1.6h3l1-1.6h3" />
    <path d="M2.5 9.5 4 3.5h8l1.5 6v3h-11z" />
  </Glyph>
);

/** Projects — a folder. */
export const IconProject = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2 4.2h4l1.2 1.6H14v6.6H2z" />
  </Glyph>
);

/** Stalled — a warning triangle. */
export const IconStalled = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M8 2.6 14.4 13H1.6z" />
    <path d="M8 6.6v3" />
    <path d="M8 11.4h.01" />
  </Glyph>
);

/** Areas & goals — a compass. */
export const IconAreas = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="m10.4 5.6-1.3 3.5-3.5 1.3 1.3-3.5z" />
  </Glyph>
);

/** Archive — a lidded box. */
export const IconArchive = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2 5.4h12V13H2z" />
    <path d="M1.4 3h13.2v2.4H1.4z" />
    <path d="M6.4 8.4h3.2" />
  </Glyph>
);

// --- List types -----------------------------------------------------------

/** Someday / Maybe — a cloud. */
export const IconSomeday = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M4.6 12h6.6a2.6 2.6 0 0 0 .3-5.2 3.6 3.6 0 0 0-6.9-.7A2.8 2.8 0 0 0 4.6 12z" />
  </Glyph>
);

/** Purchases — a basket. */
export const IconPurchases = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.2 5.6h11.6L12.6 13H3.4z" />
    <path d="M5.6 5.6 8 2.2l2.4 3.4" />
  </Glyph>
);

/** Reference — a book. */
export const IconReference = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3 2.8h6.2a2 2 0 0 1 2 2v8.4H5a2 2 0 0 1-2-2z" />
    <path d="M11.2 4.8H13v8.4H5" />
  </Glyph>
);

/** Checklist — ticked lines. */
export const IconChecklist = (p: IconProps) => (
  <Glyph {...p}>
    <path d="m2.4 5 1.4 1.4 2.4-2.4" />
    <path d="m2.4 11 1.4 1.4 2.4-2.4" />
    <path d="M8.6 5.2H14" />
    <path d="M8.6 11.2H14" />
  </Glyph>
);

/** Manage lists — stacked lines. */
export const IconLists = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.6 4.4h10.8" />
    <path d="M2.6 8h10.8" />
    <path d="M2.6 11.6h10.8" />
  </Glyph>
);

export const LIST_TYPE_ICONS = {
  someday_maybe: IconSomeday,
  purchases: IconPurchases,
  reference: IconReference,
  checklist: IconChecklist,
} as const;

// --- View toggle ----------------------------------------------------------

/** Comfortable view — rows with a second line. */
export const IconViewComfortable = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.4 3.4h11.2v4.2H2.4z" />
    <path d="M2.4 9.4h11.2v3.2H2.4z" />
  </Glyph>
);

/** Compact view — a table of single lines. */
export const IconViewCompact = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.4 3.6h11.2v8.8H2.4z" />
    <path d="M2.4 6.4h11.2" />
    <path d="M2.4 9.4h11.2" />
    <path d="M6.4 3.6v8.8" />
  </Glyph>
);
