'use client';

import { useTransition } from 'react';
import { setBoxView } from '@/lib/actions';
import type { BoxView } from '@/lib/pane';
import { IconViewGallery, IconViewSimple } from './icons';

/**
 * List or gallery, beside the density switch it deliberately isn't part of.
 *
 * The densities answer "how much does each row say"; this answers "do I want
 * to look at these or read them", which only a box can be asked.
 *
 * The key is which box is being answered *about*. Without one this was a single
 * setting shared by every box, so turning the pictures on for a box of scans
 * turned them on for a box of correspondence that has none — the same mistake
 * density made before it was keyed per list.
 */
export function BoxViewToggle({ view, viewKey }: { view: BoxView; viewKey: string }) {
  const [pending, startTransition] = useTransition();

  const options: { value: BoxView; label: string; Icon: typeof IconViewSimple }[] = [
    { value: 'list', label: 'List', Icon: IconViewSimple },
    { value: 'gallery', label: 'With pictures', Icon: IconViewGallery },
  ];

  return (
    <div className={['flex items-center gap-0.5', pending ? 'opacity-50' : ''].join(' ')}>
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={view === value}
          onClick={() => startTransition(() => void setBoxView(value, viewKey))}
          className={[
            'rounded-sm p-1',
            view === value
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
