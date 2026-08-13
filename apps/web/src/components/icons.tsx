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

/** Weekly review — a checklist on a clipboard. */
export const IconReview = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M3.4 3.4h9.2v10.2H3.4z" />
    <path d="M6 2.2h4v2H6z" />
    <path d="m5.6 8 1.2 1.2 2.6-2.6" />
  </Glyph>
);

/** Contexts — tags. */
export const IconContexts = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.6 7.4V3.4a.8.8 0 0 1 .8-.8h4l6.2 6.2-4.8 4.8L2.6 7.4z" />
    <path d="M5.4 5.4h.01" />
  </Glyph>
);

/** Connections — two links of a chain. */
export const IconConnections = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l1.8-1.8a2.6 2.6 0 0 0-3.7-3.7l-1 1" />
    <path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3L3.7 8.1a2.6 2.6 0 0 0 3.7 3.7l1-1" />
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

/** An attached document — a page with a folded corner. */
export const IconDocument = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M9.2 2H4.2v12h7.6V4.6z" />
    <path d="M9.2 2v2.6h2.6" />
  </Glyph>
);

/** An attached image — a frame with a horizon. */
export const IconImage = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="2.2" y="3.4" width="11.6" height="9.2" rx="1" />
    <path d="M2.6 10.6 6 7.6l2.4 2 2-1.6 2.9 2.5" />
    <circle cx="5.6" cy="6.2" r="0.9" />
  </Glyph>
);

/** An attached recording — a microphone. */
export const IconAudio = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="6.2" y="1.8" width="3.6" height="7.2" rx="1.8" />
    <path d="M3.8 7.4a4.2 4.2 0 0 0 8.4 0M8 11.6V14" />
  </Glyph>
);

/** Take a photo — a camera body with a lens. */
export const IconCamera = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M2.2 5.6h2.6l1-1.6h4.4l1 1.6h2.6v7.2H2.2z" />
    <circle cx="8" cy="9.2" r="2.4" />
  </Glyph>
);

/** Attach a file — a paperclip. */
export const IconPaperclip = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M12.4 7.6 7.7 12.3a3 3 0 0 1-4.2-4.2l5.2-5.2a2 2 0 0 1 2.8 2.8l-5.2 5.2a1 1 0 0 1-1.4-1.4l4.7-4.7" />
  </Glyph>
);

/** Recording in progress — a filled dot. */
export const IconRecord = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="4" fill="currentColor" stroke="none" />
  </Glyph>
);

/** Stop recording — a square. */
export const IconStop = (p: IconProps) => (
  <Glyph {...p}>
    <rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1" fill="currentColor" stroke="none" />
  </Glyph>
);

/** Light mode — a sun. */
export const IconSun = (p: IconProps) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="3.1" />
    <path d="M8 1.4v1.5M8 13.1v1.5M1.4 8h1.5M13.1 8h1.5M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1" />
  </Glyph>
);

/** Dark mode — a crescent. */
export const IconMoon = (p: IconProps) => (
  <Glyph {...p}>
    <path d="M13 9.6A5.6 5.6 0 0 1 6.4 3a5.7 5.7 0 1 0 6.6 6.6z" />
  </Glyph>
);
