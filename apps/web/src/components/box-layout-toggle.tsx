'use client';

import { useTransition } from 'react';
import { setBoxLayoutChoice } from '@/lib/actions';
import type { BoxView, ViewMode } from '@/lib/pane';
import { IconViewCompact, IconViewGallery, IconViewSimple } from './icons';

/**
 * How a box is looked at: pictures, columns, or titles.
 *
 * One control where there were two. A box used to carry the three densities
 * *and* a separate list/pictures switch beside them — but `comfortable`, which
 * wraps each row's metadata onto a second line, is answering the same question
 * the pictures answer and answering it worse. A scan is recognised by its shape
 * long before its title is read, and a second line of metadata is neither the
 * shape nor the title.
 *
 * So the middle answer goes and the two controls become one. The slot that
 * frees is where the tag button now sits, which is the thing you actually reach
 * for in a box.
 *
 * **Only in a box.** Every other list keeps all three densities: a list of
 * actions has no pictures to offer, so comfortable is a real answer there and
 * removing it would be taking something away to tidy something else.
 */
export function BoxLayoutToggle({
  view,
  mode,
  viewKey,
}: {
  view: BoxView;
  mode: ViewMode;
  viewKey: string;
}) {
  const [pending, startTransition] = useTransition();

  /*
   * Pictures wins whatever the density says, because in a gallery the density
   * is not read at all — so a box on pictures must not also light up a density
   * button and claim to be in two states at once.
   */
  const current: 'pictures' | 'compact' | 'titles' =
    view === 'gallery' ? 'pictures' : mode === 'simple' ? 'titles' : 'compact';

  const options = [
    { value: 'pictures', label: 'With pictures', Icon: IconViewGallery },
    { value: 'compact', label: 'Compact list', Icon: IconViewCompact },
    { value: 'titles', label: 'Titles only', Icon: IconViewSimple },
  ] as const;

  return (
    <div className={['flex items-center gap-0.5', pending ? 'opacity-50' : ''].join(' ')}>
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={current === value}
          onClick={() => startTransition(() => void setBoxLayoutChoice(viewKey, value))}
          className={[
            'rounded-sm p-1',
            current === value
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
