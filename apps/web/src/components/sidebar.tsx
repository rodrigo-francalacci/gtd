'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType, SVGProps } from 'react';
import {
  IconAreas,
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
import { SearchBox } from './search-box';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

type Item = {
  href: string;
  label: string;
  icon: Icon;
  count?: number;
  /** Renders the count in the stale colour rather than plain grey. */
  alert?: boolean;
};

export function SidebarNav({
  counts,
  lists,
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
}) {
  const pathname = usePathname();

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
        },
        {
          href: '/waiting',
          label: 'Waiting for',
          icon: IconWaiting,
          count: counts.waiting,
        },
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
      heading: 'Lists',
      items: [
        // Counts show candidates, not total items — what's still undecided is
        // the number worth glancing at.
        ...lists.map((l) => ({
          href: `/lists/${l.id}`,
          label: l.name,
          icon: LIST_TYPE_ICONS[l.type] as Icon,
          count: l.candidateCount,
        })),
        { href: '/lists', label: 'Manage lists', icon: IconLists },
      ],
    },
  ];

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-grey-200 bg-grey-100">
      <div className="border-b border-grey-200 px-4 py-3">
        <span className="text-[13px] font-semibold tracking-tight text-grey-800">GTD</span>
      </div>

      <SearchBox />

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {groups.map((group) => (
          <div key={group.heading} className="mb-4">
            <h2 className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
              {group.heading}
            </h2>
            <ul>
              {group.items.map((item) => {
                const [path, query] = item.href.split('?');
                // "Stalled" is a filtered view of /projects, so it must not
                // light up merely because /projects is open.
                const active = query
                  ? false
                  : pathname === path || pathname.startsWith(`${path}/`);
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={[
                        'flex items-center gap-2 px-4 py-1.5 text-[13px]',
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
