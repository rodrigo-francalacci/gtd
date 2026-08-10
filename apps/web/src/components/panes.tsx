import type { ReactNode } from 'react';
import type { ColumnSet } from '@/lib/columns';
import { ViewToggle } from './view-toggle';
import type { ViewMode } from '@/lib/view-mode';

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
  width = 'w-[30rem]',
  viewMode,
  showToggle = true,
  columns,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Override for views where this pane should take the remaining space. */
  width?: string;
  /** Drives the column header, and the density toggle unless suppressed. */
  viewMode?: ViewMode;
  /** Set false on a second pane in the same view so the toggle isn't doubled. */
  showToggle?: boolean;
  /** Column header, shown only in compact mode. */
  columns?: ColumnSet;
  children: ReactNode;
}) {
  const compact = viewMode === 'compact';

  // A table needs room for its fixed columns, so compact mode widens the pane
  // and the detail pane gives up the space — which is how the Evernote list
  // view this copies was proportioned. An explicit width still wins.
  const resolvedWidth = compact && width === 'w-[30rem]' ? 'w-[46rem]' : width;

  return (
    <div
      className={`flex ${resolvedWidth} ${resolvedWidth === 'flex-1' ? 'min-w-0' : 'shrink-0'} flex-col border-r border-grey-200 bg-grey-50`}
    >
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
    </div>
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
    <div className="min-w-0 flex-1 overflow-y-auto bg-paper">
      <div className="max-w-[38rem] px-7 py-6">{children}</div>
    </div>
  );
}

/** Shown when nothing is selected in the middle pane. */
export function EmptyDetail({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-1 items-center justify-center bg-paper">
      <p className="text-[13px] text-grey-400">{message}</p>
    </div>
  );
}

export function EmptyList({ message }: { message: string }) {
  return <p className="px-4 py-6 text-[13px] leading-relaxed text-grey-500">{message}</p>;
}
