'use client';

import Link from 'next/link';
import { useState } from 'react';
import { documentLabel, mapUrl, type BoxItemRow } from '@/lib/queries.shared';
import { AudioClip } from './audio-clip';
import { EntryTypeIcon } from './entry-type-icon';
import { IconAudio, IconDocument, IconLink, IconPlace } from './icons';
import { Linkified } from './linkified';
import { NoteText, type ResolvedLinks } from './note-text';
import { IconPin } from './icons';

const printed = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
});

/**
 * One entry, with its picture: thumbnail left, everything else right.
 *
 * A row rather than a tile in a grid. Two entries side by side halve the width
 * available to the summary, which is the part that tells you whether this is
 * the document you're after — and a scan's thumbnail only has to be big enough
 * to recognise a shape, not to read. So the picture stays small and fixed and
 * the text gets the rest of the line.
 *
 * The thumbnail is Drive's own rendering, so a PDF shows its first page.
 */
export function DocumentGalleryRow({
  item,
  href,
  selected,
  links,
}: {
  item: BoxItemRow;
  href: string;
  selected: boolean;
  /**
   * What the internal links in this note point at. Resolved by the page, once
   * for the whole list - two hundred rows must not ask two hundred questions.
   */
  links?: ResolvedLinks;
}) {
  const [failed, setFailed] = useState(false);
  const label = documentLabel(item);
  const unread = item.kind === 'document' && item.status !== 'ready';
  const audio = item.mimeType?.startsWith('audio/') ? `/api/box/${item.id}/file` : null;

  const size = item.sizeBytes
    ? item.sizeBytes >= 1024 * 1024
      ? `${(item.sizeBytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(item.sizeBytes / 1024))} KB`
    : null;

  /**
   * The row is a container with the navigation link stretched across it, not
   * an anchor wrapping everything.
   *
   * An entry can hold real links of its own — the page it points at, a map,
   * an address inside a note — and an `<a>` inside an `<a>` is invalid HTML.
   * React says so and then hydration fails, because the browser silently
   * re-parents the inner one and the tree it built stops matching the server's.
   *
   * So: one absolutely-positioned link for the click target, and the content
   * left *unpositioned* beneath it. That ordering is the whole trick and it is
   * easy to get backwards — I did: giving the content `relative` made it
   * positioned too, and two positioned siblings paint in DOM order, so the
   * content covered the link and swallowed every click. Only the padding
   * between the blocks still selected the row.
   *
   * Interactive children are the exception and need `relative z-10` to come
   * back above the overlay.
   */
  return (
    <div
      className={[
        'relative flex gap-3 border-b border-grey-200 px-3 py-2.5',
        /*
         * A note reads as a message here too. It is the line you *wrote*, where
         * everything around it was filed, sent, scanned or pasted — the same
         * distinction the day's journal line carries, so it takes the same
         * token rather than a fifth colour.
         */
        selected
          ? 'bg-selected-bg'
          : item.kind === 'note'
            ? 'bg-journal-bg'
            : 'hover:bg-grey-100',
      ].join(' ')}
    >
      <Link href={href} aria-label={label} className="absolute inset-0" />
      {/* Fixed square, so every row starts its text at the same place — a
          ragged left edge down a column of entries is the thing that makes a
          list tiring to scan. A note has no picture and gets none. */}
      {item.kind !== 'note' ? (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-grey-100">
          {item.kind === 'location' ? (
            <span className="text-grey-400">
              <IconPlace />
            </span>
          ) : item.kind === 'link' && !item.imageUrl ? (
            <span className="text-grey-400">
              <IconLink />
            </span>
          ) : audio ? (
            // A microphone, not the generic page. The page is also what a
            // failed render falls back to, so using it here made a perfectly
            // good recording look like something that had gone wrong.
            <span className="text-grey-500">
              <IconAudio />
            </span>
          ) : item.kind === 'event' ? (
            /*
             * A milestone has no file and so no thumbnail, and an empty frame
             * in a wall of pictures reads as one that failed to load. The flag
             * fills the tile instead — larger than a row icon, because here it
             * is doing a picture's job.
             */
            <span className="flex h-full w-full items-center justify-center bg-grey-100 text-grey-500 [&>svg]:h-6 [&>svg]:w-6">
              <EntryTypeIcon item={item} />
            </span>
          ) : failed ? (
            <span className="text-grey-400">
              <IconDocument />
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- proxied bytes
            <img
              // 320 rather than the 56 this box renders at: Drive fits the
              // *longest* edge to the number, so a till receipt comes back
              // barely 80px wide at 200 and looks soft on a dense screen.
              src={`/api/box/${item.id}/thumbnail?size=320`}
              alt=""
              loading="lazy"
              onError={() => setFailed(true)}
              // Top-aligned: a document's identity is its head — the
              // letterhead, the shop name — and centring a tall scan crops
              // exactly that off.
              className="h-full w-full object-cover object-top"
            />
          )}
        </span>
      ) : null}

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={[
            'text-[13px] leading-snug',
            item.kind === 'note' ? 'whitespace-pre-wrap' : 'truncate',
            item.kind === 'note' && item.noteDense !== false ? 'note-tight' : '',
            unread
              ? 'italic text-grey-500'
              : selected
                ? 'font-medium text-grey-900'
                : 'text-grey-800',
          ].join(' ')}
        >
          {item.kind === 'note' ? (
            // The rich note where there is one, the plain mirror otherwise —
            // the same rule the list row follows, because a box in pictures
            // view is still pane two.
            item.notes ? (
              <NoteText doc={item.notes} links={links} />
            ) : (
              <Linkified text={item.description ?? ''} />
            )
          ) : (
            label
          )}
        </span>

        {item.description && item.kind !== 'note' ? (
          <span className="line-clamp-2 text-[11px] leading-relaxed text-grey-500">
            {item.description}
          </span>
        ) : unread ? (
          <span className="text-[11px] text-grey-400">waiting to be read</span>
        ) : item.status === 'failed' && item.kind === 'document' ? (
          <span className="text-[11px] text-stale">could not be read</span>
        ) : null}

        {audio ? (
          // Above the overlay, so pressing play doesn't also select the row
          // and scroll the pane out from under what you are listening to.
          <span className="relative z-10 mt-1 block">
            <AudioClip src={audio} className="h-8 w-full max-w-sm" />
          </span>
        ) : null}

        {item.kind === 'link' && item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 truncate text-[11px] text-selected underline underline-offset-2"
          >
            {hostOf(item.url)}
          </a>
        ) : null}

        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-grey-400">
          {size ? <span className="tabular-nums">{size}</span> : null}

          {item.docDate ? (
            <span className="tabular-nums">
              {printed.format(new Date(item.docDate))}
            </span>
          ) : null}

          {item.kind === 'location' && item.lat !== null && item.lng !== null ? (
            <a
              href={mapUrl(item.lat, item.lng)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="relative z-10 tabular-nums underline underline-offset-2 hover:text-grey-700"
            >
              {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
            </a>
          ) : null}

          {item.tags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-sm bg-grey-200 px-1 py-px text-[10px] text-grey-600"
              title={tag.category}
            >
              {tag.name}
            </span>
          ))}

          {/* On the right with the other flags: a mark in front of the title
            indents the rows that have one and leaves the left edge ragged. */}
        {item.pinned ? (
          <span className="shrink-0 text-grey-400" title="Pinned to the top">
            <IconPin />
          </span>
        ) : null}

        {item.linkCount > 0 ? (
            <span className="text-grey-400">
              <IconLink />
            </span>
          ) : null}
        </span>
      </span>
    </div>
  );
}

/** The site, which is what you actually recognise a link by. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
