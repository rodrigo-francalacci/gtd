'use client';

import { useState, useTransition } from 'react';
import { setBoxDayNote } from '@/lib/actions';

/**
 * A line about the day, under the date in a box's feed.
 *
 * Not an entry. The entries below tell you what you *filed* that day — three
 * receipts and a screenshot; this tells you what you were *doing*, which is
 * what you actually search your memory with when hunting for one of them. "Van
 * broke down on the way to the handover" is the thing that makes a fuel
 * receipt from that Tuesday findable a year later.
 *
 * Silent when empty, and that matters more than it sounds: a box shows dozens
 * of days at once, and a placeholder under every one of them would turn a feed
 * you read into a form you have not filled in. Empty days offer a small
 * prompt on hover, which on a touchscreen means the first tap.
 *
 * Optional by construction. Most days will never have one, and a journal you
 * are nagged into keeping is one you stop keeping.
 *
 * It carries the app’s fourth semantic colour, and the reason is the same
 * one that keeps the other three: this is the only line in a box you wrote
 * yourself. Everything under it was filed, sent, scanned or pasted. Greyscale
 * can make it louder or quieter than the entries, which is the one thing it
 * is not — it is a caption on the day, not a stronger or weaker entry.
 */
export function DayJournal({
  day,
  note,
}: {
  /** The ISO day, which is the key every feed already groups by. */
  day: string;
  note: string;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);

  const save = () => {
    setEditing(false);
    if (draft.trim() === note.trim()) return;
    startTransition(async () => {
      await setBoxDayNote(day, draft);
    });
  };

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          // Enter saves; Shift+Enter is a new line. A day's note is usually
          // one sentence, so the common case should not need a second gesture.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
          }
          if (e.key === 'Escape') {
            setDraft(note);
            setEditing(false);
          }
        }}
        rows={2}
        placeholder="What happened today…"
        aria-label={`Journal for ${day}`}
        className="mx-4 mb-1 w-[calc(100%-2rem)] resize-none rounded-sm border border-journal/30 bg-journal-bg px-2 py-1 text-[12px] leading-relaxed text-journal placeholder:text-journal/50 focus:border-journal focus:outline-none"
      />
    );
  }

  if (!note) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mx-4 mb-1 block text-left text-[11px] text-transparent hover:text-journal/60 focus:text-journal/60 focus:outline-none"
      >
        Add a line about this day
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to edit"
      className={[
        'mx-4 mb-1.5 block w-[calc(100%-2rem)] whitespace-pre-wrap rounded-sm px-2 py-1 text-left text-[12px] leading-relaxed',
        // A soft ground rather than only a text colour: the line has to read
        // as a different kind of thing from the rows under it at a glance,
        // and at 12px a hue on its own is barely a signal.
        'bg-journal-bg text-journal/90 hover:text-journal',
        pending ? 'opacity-60' : '',
      ].join(' ')}
    >
      {note}
    </button>
  );
}
