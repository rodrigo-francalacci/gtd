'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ComponentType, SVGProps } from 'react';
import {
  IconAreas,
  IconBox,
  IconCalendar,
  IconConnections,
  IconContexts,
  IconInbox,
  IconArchive,
  IconFile,
  IconLists,
  IconNow,
  IconProject,
  IconReview,
  IconStalled,
  IconWaiting,
  LIST_TYPE_ICONS,
} from './icons';
import type { Theme } from '@/lib/pane';
import { ThemeToggle } from './theme-toggle';
import type { ListRow } from '@/lib/queries.shared';
import { BoxMenu } from './box-menu';
import { SearchBox } from './search-box';
import { CaptureTarget } from './drag-capture';
import type { CaptureDrop } from '@/lib/actions';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

type Item = {
  href: string;
  label: string;
  icon: Icon;
  count?: number;
  /** Renders the count in the stale colour rather than plain grey. */
  alert?: boolean;
  /**
   * Match this path only, never its children. For "Manage lists", whose
   * children each have a sidebar entry of their own — without this, opening a
   * list lit both that list and the index above it.
   */
  exact?: boolean;
  /**
   * What a capture dragged out of the inbox becomes if dropped here.
   *
   * Only on entries that are genuinely an answer to "what is this?" — Now,
   * Waiting for, Projects, each list and each box. Contexts, the archive and
   * the Google page are places rather than decisions, and lighting up under a
   * drag would promise something they cannot do.
   */
  drop?: CaptureDrop;
  /**
   * A box, which has things you can do *to* it rather than only go to.
   *
   * Right-click, or hold on a touchscreen. Those two gestures already mean
   * "tell me about this thing" everywhere else on the machine, so the actions
   * behind them need no permanent space in a header — which is what choosing
   * emoji was taking, in the one pane header that already had the most in it.
   */
  menu?: { boxId: string; name: string; waiting: number };
};

export function SidebarNav({
  counts,
  lists,
  boxes,
  theme,
}: {
  /** Passed through to the toggle so it can offer the opposite. */
  theme: Theme;
  counts: {
    next: number;
    waiting: number;
    projects: number;
    stalled: number;
    unfiled: number;
    archived: number;
    inbox: number;
  };
  lists: Pick<ListRow, 'id' | 'name' | 'type' | 'candidateCount'>[];
  /** Empty until the Big Box is set up, which hides the whole group. */
  boxes: { id: string; name: string; pendingCount: number }[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const groups: { heading: string; items: Item[] }[] = [
    {
      heading: 'Capture',
      items: [
        {
          href: '/inbox',
          label: 'Inbox',
          icon: IconInbox,
          count: counts.inbox,
          // Not an error, but the one number you want to see is this one.
          alert: false,
        },
      ],
    },
    {
      heading: 'Engage',
      items: [
        {
          href: '/now',
          label: 'What can I do now',
          icon: IconNow,
          count: counts.next,
          drop: { kind: 'now' },
        },
        {
          href: '/waiting',
          label: 'Waiting for',
          icon: IconWaiting,
          count: counts.waiting,
          drop: { kind: 'waiting' },
        },
        // Engage rather than Organise: the calendar is not something you keep,
        // it is the shape of the day you are deciding inside. No count —
        // the events are read from Google when the view opens, and the shell
        // must not wait on Google to render a number.
        { href: '/calendar', label: 'Calendar', icon: IconCalendar },
      ],
    },
    {
      heading: 'Organise',
      items: [
        {
          href: '/organise',
          label: 'File actions',
          icon: IconFile,
          count: counts.unfiled,
        },
        {
          href: '/projects',
          label: 'Projects',
          icon: IconProject,
          count: counts.projects,
          drop: { kind: 'project' },
        },
        {
          href: '/projects?filter=stalled',
          label: 'Stalled',
          icon: IconStalled,
          count: counts.stalled,
          alert: counts.stalled > 0,
        },
        { href: '/areas', label: 'Areas & goals', icon: IconAreas },
        { href: '/contexts', label: 'Contexts', icon: IconContexts },
        { href: '/review', label: 'Weekly review', icon: IconReview },
        {
          href: '/archive',
          label: 'Archive',
          icon: IconArchive,
          count: counts.archived,
        },
        { href: '/connections', label: 'Google', icon: IconConnections },
      ],
    },
    {
      heading: 'Documents',
      items: [
        // Counts show what hasn't been read yet — the only number here that
        // means anything is pending, since an unread document has no title.
        ...boxes.map((b) => ({
          href: `/box/${b.id}`,
          label: b.name,
          icon: IconBox as Icon,
          count: b.pendingCount,
          drop: { kind: 'box' as const, boxId: b.id },
          menu: { boxId: b.id, name: b.name, waiting: b.pendingCount },
        })),
        { href: '/box', label: 'Manage boxes', icon: IconBox, exact: true },
      ],
    },
    {
      heading: 'Lists',
      items: [
        // Counts show candidates, not total items — what's still undecided is
        // the number worth glancing at.
        ...lists.map((l) => ({
          href: `/lists/${l.id}`,
          label: l.name,
          icon: LIST_TYPE_ICONS[l.type] as Icon,
          count: l.candidateCount,
          drop: { kind: 'list' as const, listId: l.id },
        })),
        { href: '/lists', label: 'Manage lists', icon: IconLists, exact: true },
      ],
    },
  ];

  return (
    <nav
      /* Full width of whatever holds it: a 14rem column on a desktop, the
         drawer's own width on a phone. The drawer decides how wide it is;
         this decides what is in it. */
      className="flex h-full w-full flex-col border-r border-grey-200 bg-grey-100 md:w-56"
      /*
       * Marks this as navigation rather than content, which paper mode reads to
       * give it a coarser sheet than the panes beside it. It is the one column
       * that holds nothing you read at length, so a heavier surface there
       * competes with nothing — and the difference between the two materials is
       * what stops the whole window looking like one flat sheet with lines
       * ruled on it.
       */
      data-pane="nav"
    >
      <div className="border-b border-grey-200 px-4 py-3">
        <span className="text-[13px] font-semibold tracking-tight text-grey-800">
          GTD
        </span>
      </div>

      <SearchBox />

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {groups.map((group) => (
          <div key={group.heading} className="mb-4 md:mb-3">
            <h2 className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
              {group.heading}
            </h2>
            <ul>
              {group.items.map((item) => {
                const [path, query] = item.href.split('?');
                const onPath =
                  pathname === path || (!item.exact && pathname.startsWith(`${path}/`));

                // "Stalled" is a filtered view of /projects, so the filter has
                // to be part of the comparison: matching on the path alone lit
                // both entries at once, and refusing to light anything with a
                // query — the previous guard — lit neither, so the one view
                // reached only from the sidebar was the one view the sidebar
                // never showed you were in.
                const active =
                  onPath &&
                  (params.get('filter') ?? '') ===
                    (new URLSearchParams(query).get('filter') ?? '');
                const Icon = item.icon;

                const link = (
                  <Link
                    href={item.href}
                    /* An <a> is natively draggable and would drag its own
                       href, which on a drop target reads as the entry trying
                       to be dragged away. */
                    draggable={false}
                    className={[
                      /*
                       * Tighter on a desktop than on a phone, which is the one
                       * place the two disagree.
                       *
                       * This column is the only pane whose contents are fixed:
                       * every other list grows and is expected to scroll, while
                       * this one is the whole map of the app and is worth seeing
                       * at once. It was overflowing by about thirty pixels — a
                       * scrollbar to hide two entries — and four pixels a row
                       * across nineteen rows buys back more than twice that.
                       *
                       * Not on the phone, where this is a drawer that scrolls
                       * anyway and a row is a thumb target rather than a
                       * glance.
                       */
                      'flex items-center gap-2 px-4 py-1.5 text-[13px] md:py-1',
                      active
                        ? 'bg-selected-bg font-medium text-selected'
                        : 'text-grey-700 hover:bg-grey-150',
                    ].join(' ')}
                  >
                    <Icon
                      className={[
                        'shrink-0',
                        active ? 'text-selected' : 'text-grey-400',
                      ].join(' ')}
                    />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.count !== undefined && item.count > 0 ? (
                      <span
                        className={[
                          'shrink-0 text-[11px] tabular-nums',
                          item.alert ? 'font-semibold text-stale' : 'text-grey-500',
                        ].join(' ')}
                      >
                        {item.count}
                      </span>
                    ) : null}
                  </Link>
                );

                return (
                  <li key={item.href}>
                    {/* Wrapped only where a drop means something, so the rest
                        of the sidebar stays plain markup and cannot light up
                        under a drag it could not honour. */}
                    {/* Two wrappers, and the order matters: the menu is the
                        outer one, so a drag that starts on a box still reaches
                        the drop target inside it untouched. */}
                    {item.menu ? (
                      <BoxMenu
                        boxId={item.menu.boxId}
                        name={item.menu.name}
                        waiting={item.menu.waiting}
                      >
                        {item.drop ? (
                          <CaptureTarget drop={item.drop}>{link}</CaptureTarget>
                        ) : (
                          link
                        )}
                      </BoxMenu>
                    ) : item.drop ? (
                      <CaptureTarget drop={item.drop}>{link}</CaptureTarget>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-grey-200 px-4 py-2">
        {/* POST, so that merely loading a crafted page can't sign you out. */}
        <form action="/api/auth/signout" method="post">
          <button
            type="submit"
            className="text-[11px] text-grey-400 underline underline-offset-2 hover:text-grey-700"
          >
            Sign out
          </button>
        </form>

        <ThemeToggle preference={theme} />
      </div>
    </nav>
  );
}
