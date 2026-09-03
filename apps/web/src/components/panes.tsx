import type { ReactNode } from 'react';
import type { ColumnSet } from '@/lib/columns';
import { ConsoleCascade } from './console-cascade';
import { DEFAULT_PANE_WIDTH, type ViewMode } from '@/lib/pane';
import { ResizablePane } from './resizable-pane';
import { ViewToggle } from './view-toggle';

/**
 * What the detail pane gives up once the file preview is open.
 *
 * `0 1 38rem`: no longer grows, so the preview takes everything left over;
 * still shrinks, so a narrow window squeezes this rather than overflowing.
 *
 * 38rem because that is exactly what the pane’s contents are: the inner
 * column is `max-w-[38rem] px-7`, and `box-sizing: border-box` means the
 * padding is *inside* that figure, not added to it. It was 41rem on the
 * arithmetic of a content box — 38 plus 3.5 of padding, rounded — which left a
 * 3rem strip down the right of the pane that nothing could ever be drawn in
 * and that the preview was not allowed to use. Dead space is bad enough on
 * its own; dead space taken *from* the pane you opened to look at something
 * is the wrong way round.
 *
 * With no preview open the class does not apply and the pane fills the window
 * as before — the empty room to the right of the text is then the window’s,
 * not something withheld from another pane.
 *
 * This used to need a matching rule on the shell’s `<main>`, which wrapped
 * panes 2 and 3 — capping only the pane inside it moved the empty space one
 * level up and still left the preview with half the window. That wrapper is
 * gone: `<main>` is now the pane track itself, so every pane is a direct
 * child of one flex container and the cap lands where it is written.
 */
const CAPPED_BY_PREVIEW = 'group-data-[preview=open]/shell:flex-[0_1_38rem]';

/**
 * The middle pane: a scrolling list with a sticky header.
 *
 * Wider than the classic Evernote proportion because rows here carry more than
 * a title — project, contexts, and waiting state all sit on the second line
 * and were wrapping at the old width.
 */
export function ListPane({
  title,
  titleNote,
  subtitle,
  actions,
  fill = false,
  viewMode,
  paneWidth,
  showToggle = true,
  viewKey,
  columns,
  children,
}: {
  title: string;
  /**
   * A fact about the pane that sits beside its name rather than under it.
   *
   * Distinct from `subtitle`, which describes the *contents* and changes as
   * they do ("14 coming up", "Nothing booked"). This is for something as
   * fixed as the heading itself — today’s date over a calendar — and it is
   * set in the heading’s own line so it reads as part of the name.
   */
  titleNote?: string;
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
  /** Which list this is, so the density it is switched to is remembered here
      rather than app-wide. */
  viewKey?: string;
  /** Column header, shown only in compact mode. */
  columns?: ColumnSet;
  children: ReactNode;
}) {
  const compact = viewMode === 'compact';

  const body = (
    <>
      {/*
        The header outranks the list, so menus opened from it are not cut into.

        Menus here — the calendar picker, a sort menu — hang down over the rows,
        and the rows carry sticky headings of their own: day chips in a feed,
        status headings on projects and areas, year headings in the archive.
        Those are all `z-20`, and so were the menus, and at an equal z-index the
        later element in the DOM wins. The scrolling list comes after this
        header, so a day chip painted straight across an open menu.

        Fixed by *lowering the list* rather than raising the header. Raising it
        works and costs something: the resize handle is a `z-30` sibling running
        the full height of the pane, and a header above it would swallow the top
        few centimetres of the drag strip. Putting the list in its own `z-0`
        context caps every sticky heading inside it instead, leaving the handle
        untouched and the header only one step up.

        Done here rather than on each menu, because the next menu added to a
        pane header would have the same problem and no reason to expect it.
      */}
      <header className="relative z-10 border-b border-grey-200 px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="min-w-0 truncate text-[13px] font-semibold uppercase tracking-wide text-grey-700">
            {title}
            {titleNote ? (
              // Same line, lighter weight: it is a caption on the name, not a
              // second heading competing with it.
              <span className="ml-2 font-normal tracking-normal text-grey-400">
                {titleNote}
              </span>
            ) : null}
          </h1>
          <div className="flex items-center gap-2">
            {actions}
            {viewMode && showToggle ? (
              <ViewToggle mode={viewMode} viewKey={viewKey} />
            ) : null}
          </div>
        </div>
        {subtitle ? (
          <div className="mt-1 text-[12px] text-grey-500">{subtitle}</div>
        ) : null}
      </header>

      {compact && columns ? <ColumnHeader columns={columns} /> : null}

      {/* `z-0` is not cosmetic: it makes this a stacking context, which is what
          caps the sticky headings inside at their own level instead of letting
          them compete with the header's menus. See the header above. */}
      {/*
        The list scrolls, and its scrollbar keeps to itself until it is being
        used — the same rule the sidebar follows and for a stronger reason:
        this is the pane you scroll most, and a permanent bar down the inside
        edge of it sits directly beside the hairlines the layout is made of.
        `ScrollFade` in the shell hears the scroll; the class is the whole
        opt-in.
      */}
      <div
        data-surface="list"
        className="scrollbar-fade relative z-0 min-h-0 flex-1 overflow-y-auto"
      >
        {children}
      </div>
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
    <div
      data-surface="detail"
      className={[
        'scrollbar-fade min-w-0 flex-1 overflow-y-auto bg-paper',
        CAPPED_BY_PREVIEW,
      ].join(' ')}
    >
      {/*
        `data-pane="detail"` is a marker for one theme and inert in the other
        three: console mode deals this pane's sections in one at a time when a
        row is selected. A marker rather than a class, for the reason the
        preview pane carries one — it names what the element *is*, which is the
        only kind of hook worth styling from outside a component.
      */}
      <div data-pane="detail" className="max-w-[38rem] px-7 py-6">
        {children}
      </div>
      <ConsoleCascade />
    </div>
  );
}

/** Shown when nothing is selected in the middle pane. */
export function EmptyDetail({ message }: { message: string }) {
  return (
    <div
      data-surface="detail"
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
