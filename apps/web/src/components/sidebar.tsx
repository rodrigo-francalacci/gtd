'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = {
  href: string;
  label: string;
  count?: number;
  /** Renders the count in the stale colour rather than plain grey. */
  alert?: boolean;
};

export function SidebarNav({
  counts,
}: {
  counts: {
    next: number;
    waiting: number;
    projects: number;
    stalled: number;
    unfiled: number;
  };
}) {
  const pathname = usePathname();

  const groups: { heading: string; items: Item[] }[] = [
    {
      heading: 'Engage',
      items: [
        { href: '/now', label: 'What can I do now', count: counts.next },
        { href: '/waiting', label: 'Waiting for', count: counts.waiting },
      ],
    },
    {
      heading: 'Organise',
      items: [
        { href: '/organise', label: 'File actions', count: counts.unfiled },
        { href: '/projects', label: 'Projects', count: counts.projects },
        {
          href: '/projects?filter=stalled',
          label: 'Stalled',
          count: counts.stalled,
          alert: counts.stalled > 0,
        },
        { href: '/areas', label: 'Areas & goals' },
      ],
    },
  ];

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-grey-200 bg-grey-100">
      <div className="border-b border-grey-200 px-4 py-3">
        <span className="text-[13px] font-semibold tracking-tight text-grey-800">GTD</span>
      </div>

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

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={[
                        'flex items-center justify-between gap-2 px-4 py-1.5 text-[13px]',
                        active
                          ? 'bg-selected-bg font-medium text-selected'
                          : 'text-grey-700 hover:bg-grey-150',
                      ].join(' ')}
                    >
                      <span className="truncate">{item.label}</span>
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

      <div className="border-t border-grey-200 px-4 py-2 text-[11px] text-grey-400">
        Inbox, lists and the weekly review land next session.
      </div>
    </nav>
  );
}
