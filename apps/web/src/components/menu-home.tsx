'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** The address `AppShell` treats as the phone's home screen. */
export const MENU_PATH = '/menu';

/**
 * Renders nothing, and moves a desktop on to Now.
 *
 * The server cannot tell a phone from a desktop — the difference is a width,
 * and the width is known only to the browser — so the choice is made here,
 * against the same 768px the shell's layout turns on. Replace rather than
 * push, so Back from Now does not land on an empty address that would only
 * send you forward again.
 *
 * On a phone this does nothing at all: the navigation beside it is the page.
 */
export function MenuHome() {
  const router = useRouter();

  useEffect(() => {
    if (window.matchMedia('(min-width: 768px)').matches) router.replace('/now');
  }, [router]);

  return null;
}
