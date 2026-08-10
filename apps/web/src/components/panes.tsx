import type { ReactNode } from 'react';

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
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Override for views where this pane should take the remaining space. */
  width?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex ${width} ${width === 'flex-1' ? 'min-w-0' : 'shrink-0'} flex-col border-r border-grey-200 bg-grey-50`}
    >
      <header className="border-b border-grey-200 px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-[13px] font-semibold uppercase tracking-wide text-grey-700">
            {title}
          </h1>
          {actions}
        </div>
        {subtitle ? (
          <div className="mt-1 text-[12px] text-grey-500">{subtitle}</div>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
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
