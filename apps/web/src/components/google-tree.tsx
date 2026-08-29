'use client';

import { useState } from 'react';
import type { TreeNode } from '@gtd/db';

/**
 * A project's Drive folder and Gmail label, navigable without leaving the app.
 *
 * One component for both, because a folder holding folders and files and a label
 * holding sub-labels and messages are the same thing to somebody reading down
 * them. Gmail has no tree of its own — `GTD/Projects/Kitchen/Quotes` is a label
 * whose *name* contains slashes — so the script rebuilds one, and by the time it
 * arrives here the two are the same shape.
 *
 * **It is an index, not a mirror.** The app cannot read either of these: that
 * needs restricted scopes it deliberately does not hold. What it has is a
 * snapshot posted by the Apps Script, so the age is shown, always, and anything
 * you open goes to Drive or Gmail — the copy that cannot be out of date.
 *
 * **Everything opens where it lives**, in a new tab, as a real link. Not an
 * embed: on a phone, Android and iOS hand a `drive.google.com` or
 * `mail.google.com` navigation to the installed app, and neither an iframe nor
 * `window.open` is a navigation they will claim. An anchor also behaves the way
 * every other link on the machine does.
 *
 * That is the opposite of the attachment rule — plain click previews, modified
 * click leaves — and it is the same reasoning reaching a different answer. There
 * the app owns the bytes and can show them; here it owns nothing, because these
 * are the files it has no scope to read. There is no version of them that
 * belongs in our pane.
 */

/**
 * Which of Google's marks a node wears.
 *
 * A folder and a Gmail label are both containers and get the folder, which is
 * grey in Google's own set and so claims nothing about being a Drive folder
 * specifically. A message gets `message/rfc822`, which is a red envelope. Every
 * file gets its own type, and a type Google has never heard of still answers —
 * with the generic blue page, which is the right answer and saves the caller
 * from having to know what is on the list.
 */
function glyphType(node: TreeNode): string {
  if (node.kind === 'folder' || node.kind === 'label') {
    return 'application/vnd.google-apps.folder';
  }

  if (node.kind === 'message') return 'message/rfc822';

  return node.mimeType || 'application/octet-stream';
}

/**
 * The mark for one node — Google's, in Google's colours.
 *
 * These rows are files this app cannot open and does not hold, and the one
 * useful thing it can say about each is what kind of thing it is. Google's own
 * icons say it without being read: everyone who has opened Drive knows the blue
 * page, the green grid and the red PDF, and the tree is trying to look like the
 * place the files actually are.
 *
 * Requested at 32 and drawn at 16, so it stays sharp on a phone, and served
 * through our own origin — see `/api/google-icon`.
 *
 * `alt=""` because the row's text is already the name: a screen reader
 * announcing "PDF icon" before every filename is noise, and the kind is in the
 * extension anyway. Fixed dimensions so a slow or missing icon leaves the row
 * the shape it will end up, rather than reflowing the whole tree as they land.
 */
function NodeGlyph({ node }: { node: TreeNode }) {
  const type = glyphType(node);

  return (
    /*
     * A plain `img`. `next/image` exists to resize and re-encode photographs,
     * and would put a 300-byte PNG through an optimiser that bills per source
     * image to hand back something no smaller — over a URL that is already
     * ours and already cached for a year.
     */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/google-icon?type=${encodeURIComponent(type)}&size=32`}
      alt=""
      width={16}
      height={16}
      className="block h-4 w-4"
      draggable={false}
    />
  );
}

/** Bytes, in the shortest form that is still honest. */
function size(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Row({ node, depth }: { node: TreeNode; depth: number }) {
  // Open at the top, closed below it: the first level is what you came to see,
  // and everything expanded is a wall.
  const [open, setOpen] = useState(depth === 0);

  const branch = node.kind === 'folder' || node.kind === 'label';
  const kids = node.children ?? [];

  return (
    <li>
      <div
        className="group flex items-center gap-1.5 rounded-sm py-0.5 pr-1 text-[12px] hover:bg-grey-150"
        style={{ paddingLeft: `${depth * 0.85 + 0.25}rem` }}
      >
        {branch ? (
          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            className="w-3 shrink-0 text-[9px] text-grey-400 hover:text-grey-700"
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        <span className="shrink-0">
          <NodeGlyph node={node} />
        </span>

        {node.url && !branch ? (
          /*
           * A real link, opened in a new tab — not an embed and not
           * `window.open`, and the difference is what makes this work on a
           * phone. Android and iOS hand a `drive.google.com` or
           * `mail.google.com` navigation to the installed app; a scripted popup
           * is not a navigation and an iframe is not either, so both stay in the
           * browser. An anchor also behaves the way every other link on the
           * machine does — middle-click, ctrl-click, open in a new window.
           *
           * This is deliberately the opposite of the attachment rule, where a
           * plain click previews and only a modified one leaves. There, the app
           * owns the bytes and can show them; here it owns nothing — these are
           * files it has no scope to read — so there is no version of this file
           * that belongs in our pane. Drive and Gmail are where it lives.
           */
          <a
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-left text-grey-800 hover:text-selected hover:underline"
            title={node.name}
          >
            {node.name}
          </a>
        ) : (
          <span className="min-w-0 flex-1 truncate text-grey-700" title={node.name}>
            {node.name}
            {node.url ? (
              // A folder expands here and opens *there*: the arrow is the
              // navigation, this is the way out to the real thing.
              <a
                href={node.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1.5 text-[10px] text-grey-400 opacity-0 hover:text-selected group-hover:opacity-100"
                title={`Open ${node.name} in ${node.kind === 'label' ? 'Gmail' : 'Drive'}`}
              >
                ↗
              </a>
            ) : null}
          </span>
        )}

        {node.from ? (
          <span className="hidden shrink-0 truncate text-[10px] text-grey-400 sm:inline sm:max-w-[9rem]">
            {node.from.replace(/\s*<[^>]*>$/, '')}
          </span>
        ) : null}

        {size(node.size) ? (
          <span className="shrink-0 tabular-nums text-[10px] text-grey-400">
            {size(node.size)}
          </span>
        ) : null}
      </div>

      {branch && open ? (
        <ul>
          {kids.map((child) => (
            <Row key={`${child.kind}:${child.id}`} node={child} depth={depth + 1} />
          ))}

          {kids.length === 0 && !node.more ? (
            <li
              className="py-0.5 text-[11px] text-grey-400"
              style={{ paddingLeft: `${(depth + 1) * 0.85 + 1.4}rem` }}
            >
              Empty
            </li>
          ) : null}

          {node.more ? (
            /* The difference between "holds four things" and "here are four of
               them", which a reader cannot otherwise tell. */
            <li
              className="py-0.5 text-[11px] text-grey-400"
              style={{ paddingLeft: `${(depth + 1) * 0.85 + 1.4}rem` }}
            >
              …and {node.more} more, not listed
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

export function GoogleTree({
  drive,
  gmail,
  fetchedAt,
  error,
}: {
  drive: TreeNode | null;
  gmail: TreeNode | null;
  fetchedAt: Date | null;
  error: string | null;
}) {
  const [side, setSide] = useState<'drive' | 'gmail'>(drive ? 'drive' : 'gmail');

  if (!drive && !gmail) {
    return (
      <p className="p-4 text-[12px] leading-relaxed text-grey-500">
        Nothing has been walked yet. Run <em>Project folders</em> in the bridge
        panel — the app cannot read a Drive folder it did not fill, or the
        messages under a label, so an Apps Script does it and posts back what it
        found.
      </p>
    );
  }

  const tree = side === 'drive' ? drive : gmail;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-grey-200 bg-grey-50 px-3 py-1.5">
        <div className="flex items-center gap-0.5">
          {(['drive', 'gmail'] as const).map((which) => {
            const has = which === 'drive' ? drive : gmail;
            if (!has) return null;

            return (
              <button
                key={which}
                type="button"
                onClick={() => setSide(which)}
                aria-pressed={side === which}
                className={[
                  'rounded-sm px-2 py-0.5 text-[11px]',
                  side === which
                    ? 'bg-grey-200 font-medium text-grey-800'
                    : 'text-grey-500 hover:text-grey-800',
                ].join(' ')}
              >
                {which === 'drive' ? 'Files' : 'Email'}
              </button>
            );
          })}
        </div>

        {/*
          How old this is, always. It is a snapshot posted by a script rather
          than something the app can look up, and a navigator that does not say
          when it was taken invites you to believe an empty folder is empty.
        */}
        {fetchedAt ? (
          <span className="text-[10px] text-grey-400">
            as of {fetchedAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        ) : null}

        {error ? (
          <span className="text-[10px] text-stale" title={error}>
            last walk had trouble
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tree ? (
          <ul>
            <Row node={tree} depth={0} />
          </ul>
        ) : null}
      </div>
    </div>
  );
}
