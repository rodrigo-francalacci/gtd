import type { ReactNode } from 'react';
import type { ColumnSet } from '@/lib/columns';
import { DEFAULT_PANE_WIDTH, type ViewMode } from '@/lib/pane';
import { ResizablePane } from './resizable-pane';
import { ViewToggle } from './view-toggle';

/**
 * What the third pane gives up once the file preview is open.
 *
 * `0 1 41rem`: no longer grows, so the preview takes everything left over;
 * still shrinks, so a narrow window squeezes this rather than overflowing.
 * 41rem is the note column's own measure (38rem) plus its padding, so nothing
 * inside the pane reflows — it stops stretching empty background it wasn't
 * using. With no preview open the class doesn't apply and the pane fills the
 * window exactly as before.
 *
 * The shell's `<main>` carries the matching rule (see `(app)/layout.tsx`).
 * It wraps panes 2 and 3, so capping only the pane inside it just moved the
 * empty space one level up and still left the preview with half the window.
 */
const CAPPED_BY_PREVIEW = 'group-data-[preview=open]/shell:flex-[0_1_41rem]';

/**
 * The middle pane: a scrolling list with a sticky header.
 *
 * Wider than the classic Evernote proportion because rows here carry more than
 * a title — project, contexts, and waiting state all sit on the second line
 * and were wrapping at the old width.
 */
export function ListPane({
  title,
  subtitle,
  actions,
  fill = false,
  viewMode,
  paneWidth,
  showToggle = true,
  columns,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Take the remaining space instead of a fixed, resizable width. */
  fill?: boolean;
  /** Drives the column header, and the density toggle unless suppressed. */
  viewMode?: ViewMode;
  /** Resolved width in px. Omit (or use `fill`) for a non-resizable pane. */
  paneWidth?: number;
  /** Set false on a second pane in the same view so the toggle isn't doubled. */
  showToggle?: boolean;
  /** Column header, shown only in compact mode. */
  columns?: ColumnSet;
  children: ReactNode;
}) {
  const compact = viewMode === 'compact';

  const body = (
    <>
      <header className="border-b border-grey-200 px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-[13px] font-semibold uppercase tracking-wide text-grey-700">
            {title}
          </h1>
          <div className="flex items-center gap-2">
            {actions}
            {viewMode && showToggle ? <ViewToggle mode={viewMode} /> : null}
          </div>
        </div>
        {subtitle ? (
          <div className="mt-1 text-[12px] text-grey-500">{subtitle}</div>
        ) : null}
      </header>

      {compact && columns ? <ColumnHeader columns={columns} /> : null}

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </>
  );

  if (fill || paneWidth === undefined) {
    return (
      <div
        className={[
          'flex flex-col border-r border-grey-200 bg-grey-50',
          // A filling pane is the rightmost one on its page, so it yields to
          // the preview the same way a detail pane does.
          fill ? `min-w-0 flex-1 ${CAPPED_BY_PREVIEW}` : 'w-[30rem] shrink-0',
        ].join(' ')}
      >
        {body}
      </div>
    );
  }

  return (
    <ResizablePane
      initialWidth={paneWidth}
      defaultWidth={DEFAULT_PANE_WIDTH[viewMode ?? 'comfortable']}
    >
      {body}
    </ResizablePane>
  );
}

/** The column strip above a compact list, as in old Evernote's table view. */
function ColumnHeader({ columns }: { columns: ColumnSet }) {
  return (
    <div
      style={{ gridTemplateColumns: columns.template }}
      className="grid items-center gap-2 border-b border-grey-200 bg-grey-100 px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-grey-500"
    >
      {columns.headers.map((h, i) =>
        i === 0 ? (
          <span key={h} className="flex items-center gap-1.5">
            {/* Invisible copies of the row's leading controls, so the label
                sits exactly above the titles rather than at a guessed offset. */}
            {columns.leading !== 'none' ? (
              <span aria-hidden className="text-[11px] leading-none opacity-0">
                ⠿
              </span>
            ) : null}
            {columns.leading === 'grip-check' ? (
              <span aria-hidden className="h-3.5 w-3.5 shrink-0" />
            ) : null}
            <span>{h}</span>
          </span>
        ) : (
          <span key={h}>{h}</span>
        ),
      )}
    </div>
  );
}

/**
 * The right-hand pane: the note/detail surface.
 *
 * Content is capped and left-aligned rather than centred in the full remaining
 * width — a note column that stretches across a wide monitor is unreadable,
 * and centring it left the pane looking emptier than it is.
 */
export function DetailPane({ children }: { children: ReactNode }) {
  return (
    <div className={['min-w-0 flex-1 overflow-y-auto bg-paper', CAPPED_BY_PREVIEW].join(' ')}>
      <div className="max-w-[38rem] px-7 py-6">{children}</div>
    </div>
  );
}

/** Shown when nothing is selected in the middle pane. */
export function EmptyDetail({ message }: { message: string }) {
  return (
    <div
      className={[
        'flex h-full flex-1 items-center justify-center bg-paper',
        CAPPED_BY_PREVIEW,
      ].join(' ')}
    >
      <p className="text-[13px] text-grey-400">{message}</p>
    </div>
  );
}

export function EmptyList({ message }: { message: string }) {
  return <p className="px-4 py-6 text-[13px] leading-relaxed text-grey-500">{message}</p>;
}
