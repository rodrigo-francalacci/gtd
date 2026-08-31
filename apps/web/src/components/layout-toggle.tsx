'use client';

import { useTransition } from 'react';
import { setListLayout } from '@/lib/actions';
import type { ListLayout } from '@/lib/view-prefs';
import { IconViewCompact, IconCalendar, IconImpact } from './icons';

/**
 * List, or timeline.
 *
 * A list is what you have arranged — dragged into the order you would do or
 * buy them in, which is most of what a list is for. A timeline is the same
 * rows read as a history: what you were thinking about in March, grouped by
 * the day you wrote it down.
 *
 * Both are useful and neither replaces the other, which is exactly why this is
 * a switch rather than a sort option: choosing "arrival" under a sort menu
 * would throw away the manual order, and this leaves it untouched and simply
 * looks past it.
 *
 * Beside the density switch, because they are the same kind of choice about
 * the same pane — and stored the same way, per list, so a purchases list read
 * as a timeline stays one while the shopping list next to it does not.
 */
export function LayoutToggle({
  layout,
  viewKey,
  /**
   * Whether to offer the impact grouping.
   *
   * Only a purchases list has one, and a control that offers an arrangement
   * the rows cannot take is a control that has to explain itself.
   */
  impact = false,
}: {
  layout: ListLayout;
  viewKey: string;
  impact?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const options: { value: ListLayout; label: string; Icon: typeof IconCalendar }[] = [
    { value: 'list', label: 'Your order', Icon: IconViewCompact },
    { value: 'timeline', label: 'By the day it arrived', Icon: IconCalendar },
    ...(impact
      ? [{ value: 'impact' as const, label: 'By what it would do', Icon: IconImpact }]
      : []),
  ];

  return (
    <div className={['flex items-center gap-0.5', pending ? 'opacity-50' : ''].join(' ')}>
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={layout === value}
          onClick={() => startTransition(() => void setListLayout(viewKey, value))}
          className={[
            'rounded-sm p-1',
            layout === value
              ? 'bg-grey-200 text-grey-800'
              : 'text-grey-400 hover:text-grey-600',
          ].join(' ')}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}
