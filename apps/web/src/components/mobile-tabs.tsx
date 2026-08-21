'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconBox, IconInbox, IconNow } from './icons';

/**
 * The bottom bar.
 *
 * At the bottom because that is where a thumb reaches. The desktop puts its
 * navigation down the left and its controls top-right, which on a phone held
 * in one hand is the two furthest corners from the only finger available.
 *
 * Three destinations, and the restraint is the point: this is a capture app
 * that can also show you two things. Projects, areas, the weekly review and
 * anything involving dragging stay on the desktop, where there is a mouse and
 * room to think — a phone in a shop is not where you restructure your
 * commitments.
 */
const TABS = [
  { href: '/m', label: 'Capture', icon: IconInbox, exact: true },
  { href: '/m/now', label: 'Now', icon: IconNow },
  { href: '/m/boxes', label: 'Boxes', icon: IconBox },
];

export function MobileTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="flex shrink-0 border-t border-grey-200 bg-grey-50"
      // The home indicator on a modern phone sits over the bottom of the
      // screen. Without this the tab labels are underneath it.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            /* min-h-14: a touch target has to be a target. 44px is the floor
               everyone quotes and 56 is comfortable for a thumb aiming without
               looking, which is how this bar is actually used. */
            className={[
              'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5',
              active ? 'text-selected' : 'text-grey-500',
            ].join(' ')}
          >
            <Icon />
            <span className="text-[11px]">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
