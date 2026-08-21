'use client';

import { useEffect } from 'react';
import { recordUse } from '@/lib/use-usage';
import { isUsableType } from '@/lib/usage.shared';

/**
 * One listener for the whole app, instead of a handler on every row.
 *
 * Rows are drawn by a dozen components across five route segments, and
 * threading an onClick through all of them would put a piece of bookkeeping
 * into every one — where it would be forgotten by the next row type somebody
 * adds. A row instead says what it is with `data-use="box_item:<uuid>"`, and
 * this catches the click on the way past.
 *
 * Delegated on the *capture* phase so it still sees clicks that a row handler
 * stops, and mounted in the app shell so it survives every navigation inside
 * it.
 */
export function UsageTracker() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Left and middle only. A right-click opens a menu, which is not yet a
      // decision to look at anything.
      if (event.button !== 0 && event.button !== 1) return;

      const target = (event.target as Element | null)?.closest?.('[data-use]');
      const value = target?.getAttribute('data-use');
      if (!value) return;

      // `type:uuid`. Split on the first colon only — a uuid has none, but
      // being strict here costs nothing and a malformed value should be
      // ignored rather than counted against something arbitrary.
      const separator = value.indexOf(':');
      if (separator < 1) return;

      const type = value.slice(0, separator);
      const id = value.slice(separator + 1);

      if (isUsableType(type) && id) recordUse(type, id);
    };

    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, []);

  return null;
}
