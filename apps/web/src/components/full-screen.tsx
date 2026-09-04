'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CoveringPanes } from './file-preview';

/**
 * The window, given over to one thing.
 *
 * Three views want this now — the boards, a row opened to work on, and a file
 * opened to read — and they want the same chrome around it: a title that says
 * what you are looking at, a way out that is both a key and a link, and the
 * surface markers so the theme with three grounds reaches inside. Written once,
 * because the interesting part of each is its contents and the boring part
 * should not be typed three times and drift.
 *
 * **Escape leaves, unless you are typing.** Escape means "abandon this field"
 * first — closing the whole thing out from under a half-written price is the
 * kind of thing you only forgive once.
 *
 * **`router.push`, not `history.back()`.** These are URLs, so the way out has
 * to be the same whether you opened it with a gesture, followed a link into it,
 * or refreshed the page while it was open. The preview pane learned this the
 * hard way: a back that assumed it had pushed the entry on top threw you to
 * another page whenever anything had navigated in between.
 *
 * **`z-50`, matching the sidebar.** Anything lower is painted under the
 * navigation. It must not go higher either: the row menus and the theme
 * switcher portal to the body at `z-50` and are later in the document, so they
 * land above this — which is what a right-click on a row in here needs.
 */
export function FullScreen({
  title,
  subtitle,
  closeHref,
  onClose,
  actions,
  surface = 'list',
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Where the way out goes. Omit when the caller closes it itself. */
  closeHref?: string;
  /**
   * Closing without a URL, for the one view whose state is not in the URL.
   *
   * The preview pane belongs to the *window* rather than to the row it was
   * opened from — it survives clicking through to another project — so it has
   * never been a search param, and expanding it should not make it one.
   */
  onClose?: () => void;
  /** Anything the caller wants beside the way out — a density switch, a link. */
  actions?: ReactNode;
  /**
   * Which ground this stands on.
   *
   * `list` for the working views, because that is what they are: the list, at a
   * different size. `plain` for the file reader, which is a window onto
   * somebody's document and must not be given a costume — the same reason the
   * preview pane is lifted above paper mode's grain.
   */
  surface?: 'list' | 'plain';
  children: ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable)
      ) {
        return;
      }

      if (onClose) onClose();
      else if (closeHref) router.push(closeHref);
    };

    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [router, closeHref, onClose]);

  return (
    <div
      data-surface={surface === 'list' ? 'list' : undefined}
      className="fixed inset-0 z-50 flex flex-col bg-paper"
    >
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-grey-200 px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-[13px] font-semibold text-grey-900">{title}</h1>
          {subtitle ? (
            <p className="truncate text-[11px] text-grey-500">{subtitle}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {actions}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
            >
              Close
            </button>
          ) : closeHref ? (
            <Link
              href={closeHref}
              className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
            >
              Close
            </Link>
          ) : null}
        </div>
      </header>

      {/*
        Everything inside is standing on top of the panes, and the file preview
        needs to know: its fourth column is *behind* this overlay, so a click
        that opens one there loads a file, renders a pane and shows nothing.
        Inside here the same click opens it full screen instead, which is the
        only size that can be seen from here.
      */}
      <CoveringPanes>{children}</CoveringPanes>
    </div>
  );
}
