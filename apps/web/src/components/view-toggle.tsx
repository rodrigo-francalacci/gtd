'use client';

import { useTransition } from 'react';
import { setViewMode } from '@/lib/actions';
// Type-only import: erased at compile time, so the server-only module is
// never pulled into the client bundle.
import type { ViewMode } from '@/lib/view-mode';
import { IconViewCompact, IconViewComfortable } from './icons';

/**
 * The density switch, in the same place old Evernote put it — top-right of the
 * list pane header.
 */
export function ViewToggle({ mode }: { mode: ViewMode }) {
  const [pending, startTransition] = useTransition();

  const options: { value: ViewMode; label: string; Icon: typeof IconViewCompact }[] = [
    { value: 'comfortable', label: 'Comfortable view', Icon: IconViewComfortable },
    { value: 'compact', label: 'Compact list view', Icon: IconViewCompact },
  ];

  return (
    <div className={['flex items-center gap-0.5', pending ? 'opacity-50' : ''].join(' ')}>
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={mode === value}
          onClick={() => startTransition(() => void setViewMode(value))}
          className={[
            'rounded-sm p-1',
            mode === value
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
