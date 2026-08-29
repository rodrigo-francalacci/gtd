'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { setEmoji, type EmojiTarget } from '@/lib/actions';
import { EMOJI_GROUPS, findGroups } from '@/lib/emoji-groups';

/**
 * Choose a row's emoji by hand.
 *
 * The model is a starting point, not an authority — it will call the kitchen
 * extension a saucepan, and you are the one who has to recognise that row at a
 * glance for the next six months. So anything it chose can be overruled, and a
 * row it skipped can be given one without asking it at all.
 *
 * **The field is the picker.** Every platform this runs on already has an emoji
 * keyboard — Win+. on Windows, Ctrl+Cmd+Space on a Mac, the smiley key on a
 * phone — and shipping a searchable grid of eighteen hundred glyphs to
 * duplicate one that is a keystroke away would be a quarter of a megabyte to
 * answer a question the operating system answers better. Typing, pasting and
 * the system picker all land in the same box.
 *
 * The groups above it are not a substitute for that, and are not trying to be a
 * complete set. They are the glyphs that come up over and over in a personal
 * system, close enough to hand that the common case never needs a keyboard —
 * grouped by *what a row is* rather than by what the picture shows, because a
 * to-do list files a car beside an MOT and a tank of fuel while Unicode files it
 * under travel.
 *
 * Each group shows its first row until you open it, so the panel says what kinds
 * of thing are on offer before it says how many.
 */

export function EmojiPicker({
  target,
  id,
  emoji,
  label = 'emoji',
}: {
  target: EmojiTarget;
  id: string;
  /** What it is now, or null. */
  emoji: string | null;
  /** What this row is, for the button's own description. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  /**
   * Which group is showing, or null for the shortlist.
   *
   * Closed by default. Twelve glyphs answer most of it, and opening onto a
   * hundred and ninety would make the common case slower to serve the rare one.
   */
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const shut = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    // Next tick, or the very press that opened this closes it again.
    const id_ = setTimeout(() => {
      document.addEventListener('pointerdown', shut);
      document.addEventListener('keydown', key);
    }, 0);

    return () => {
      clearTimeout(id_);
      document.removeEventListener('pointerdown', shut);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const save = (next: string | null) => {
    setError(null);
    startTransition(async () => {
      const result = await setEmoji(target, id, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft('');
      setQuery('');
      setGroup(null);
      setOpen(false);
    });
  };

  return (
    <div className="relative inline-flex" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        title={emoji ? `Change the ${label}` : `Choose an ${label}`}
        className={[
          'flex h-6 w-6 items-center justify-center rounded-sm leading-none',
          emoji
            ? 'hover:bg-grey-150'
            : // A dashed outline where there is nothing yet: it has to look like
              // somewhere to put something, not like an empty gap.
              'border border-dashed border-grey-300 text-[10px] text-grey-400 hover:border-grey-500 hover:text-grey-600',
        ].join(' ')}
      >
        {emoji ?? '+'}
      </button>

      {open ? (
        <div className="absolute left-0 top-7 z-40 w-[15rem] rounded-sm border border-grey-300 bg-paper p-2 shadow-lg">
          {/*
            The group being read, or all of them.

            Grouped by *what a row is* rather than by what the glyph depicts —
            Unicode files a car under travel, a to-do list files it beside an MOT
            and a tank of fuel, and the second is what you are looking for while
            scanning. The search matches group names for the same reason: no
            dictionary of "grinning face with sweat" is shipped, which is most of
            the weight of an emoji picker and none of its use here.
          */}
          <div className="mb-1.5 flex items-center gap-1">
            {group ? (
              <button
                type="button"
                onClick={() => setGroup(null)}
                className="shrink-0 rounded-sm px-1 text-[11px] text-grey-500 hover:bg-grey-150 hover:text-grey-800"
              >
                ‹
              </button>
            ) : null}

            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setGroup(null);
              }}
              placeholder={group ?? 'Search groups…'}
              aria-label="Search emoji groups"
              className="min-w-0 flex-1 rounded-sm border border-grey-300 bg-paper px-1.5 py-0.5 text-[16px] text-grey-800 placeholder:text-[11px] placeholder:text-grey-400 focus:border-selected focus:outline-none md:text-[12px]"
            />
          </div>

          <div className="max-h-56 overflow-y-auto">
            {(group
              ? EMOJI_GROUPS.filter((g) => g.name === group)
              : findGroups(query)
            ).map((section) => {
              // Collapsed to its first row until opened, so the panel shows the
              // shape of the whole vocabulary rather than the start of one part.
              const showing =
                group === section.name || query.trim() !== ''
                  ? section.emoji
                  : section.emoji.slice(0, 6);

              return (
                <div key={section.name} className="mb-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setGroup(group === section.name ? null : section.name)
                    }
                    className="mb-0.5 block w-full px-0.5 text-left text-[10px] uppercase tracking-wider text-grey-500 hover:text-grey-800"
                  >
                    {section.name}
                  </button>

                  <div className="grid grid-cols-6 gap-0.5">
                    {showing.map((glyph) => (
                      <button
                        key={glyph}
                        type="button"
                        disabled={pending}
                        onClick={() => save(glyph)}
                        className={[
                          'flex h-7 items-center justify-center rounded-sm leading-none hover:bg-grey-150 disabled:opacity-40',
                          glyph === emoji ? 'bg-grey-200' : '',
                        ].join(' ')}
                      >
                        {glyph}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {findGroups(query).length === 0 ? (
              <p className="px-0.5 py-1 text-[11px] text-grey-400">
                No group called that. The field below takes any emoji.
              </p>
            ) : null}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.trim()) save(draft.trim());
            }}
            className="mt-2 flex items-center gap-1"
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
              placeholder="or any emoji"
              aria-label="Type or paste an emoji"
              /* 16px, or iOS Safari zooms the page in when it takes focus. */
              className="min-w-0 flex-1 rounded-sm border border-grey-300 bg-paper px-1.5 py-1 text-[16px] text-grey-800 placeholder:text-[12px] placeholder:text-grey-400 focus:border-selected focus:outline-none md:text-[13px]"
            />
            <button
              type="submit"
              disabled={pending || !draft.trim()}
              className="shrink-0 rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-40"
            >
              Set
            </button>
          </form>

          {emoji ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => save(null)}
              className="mt-1.5 text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800 disabled:opacity-40"
            >
              Remove it
            </button>
          ) : null}

          {error ? <p className="mt-1 text-[11px] text-stale">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
