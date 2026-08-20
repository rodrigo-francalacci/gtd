'use client';

import { Fragment } from 'react';

/**
 * Plain text with its web addresses made clickable.
 *
 * Notes are stored as text, not as a document — they are messages, and the
 * editor's machinery would be a heavy way to write one line. But a note with
 * a link in it that you cannot click is a note you end up copying out of by
 * hand, which is the same complaint that made the note editor's links
 * clickable in the first place.
 *
 * Split rather than replaced: building HTML from a user's text and handing it
 * to `dangerouslySetInnerHTML` is how a note becomes a script. Every piece
 * here goes through React as a value, so the worst a hostile string can do is
 * look odd.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

export function Linkified({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));

    // Trailing punctuation is nearly always the sentence's, not the address's.
    const raw = match[0].replace(/[.,;:!?]+$/, '');

    parts.push(
      <a
        key={`${start}-${raw}`}
        href={raw}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={(e) => e.stopPropagation()}
        className="text-selected underline underline-offset-2"
      >
        {raw}
      </a>,
    );

    last = start + raw.length;
  }

  if (last < text.length) parts.push(text.slice(last));

  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  );
}
