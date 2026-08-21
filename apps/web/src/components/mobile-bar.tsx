'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { IconBox, IconCalendar, IconInbox, IconNow } from './icons';

/**
 * The fixed footer: the menu, and the places worth one tap.
 *
 * Phone only — a desktop has the whole sidebar on screen and needs neither.
 *
 * Five, and no more. At 390px a sixth leaves each target around 60px wide,
 * which is under a thumb rather than under a fingertip aimed at it; the rest of
 * the app is one tap further away behind the menu, which is the right price for
 * the things you reach for once a week. These five are the ones you reach for
 * standing up: somewhere to put a thought, what you could do, what is booked,
 * and what you are keeping.
 */
const SHORTCUTS = [
  // `/m`, not `/inbox`: capture on a phone is its own screen — the whole
  // display as the field, the camera and microphone as first-class buttons,
  // and the destination chosen before you type. The inbox list is where you
  // go to *process* captures, which is a different job and a slower one.
  { href: '/m', label: 'Capture', icon: IconInbox },
  { href: '/now', label: 'Now', icon: IconNow },
  { href: '/calendar', label: 'Calendar', icon: IconCalendar },
  // `/m/boxes`, not `/box`: that is the manager, where vocabularies and Drive
  // folders are set up. From a phone you want to open a box, not configure one.
  { href: '/m/boxes', label: 'Boxes', icon: IconBox },
];

export function MobileBar({
  onOpenMenu,
  menuIcon,
}: {
  onOpenMenu: () => void;
  menuIcon: ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <nav
      className="z-30 flex shrink-0 border-t border-grey-200 bg-grey-100 md:hidden"
      // A modern phone paints its home indicator over the bottom of the
      // screen. Without this the labels sit underneath it.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-grey-500"
      >
        {menuIcon}
        <span className="text-[10px]">Menu</span>
      </button>

      {SHORTCUTS.map(({ href, label, icon: Icon }) => {
        // A box's own page lives under /box/<id>, so the Boxes shortcut has to
        // match its children too — but nothing here carries a query, and
        // `/box?box=` is the tag editor rather than a box.
        const active =
          (pathname === href || pathname.startsWith(`${href}/`)) && !params.get('filter');

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5',
              active ? 'text-selected' : 'text-grey-500',
            ].join(' ')}
          >
            <Icon />
            <span className="text-[10px]">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
