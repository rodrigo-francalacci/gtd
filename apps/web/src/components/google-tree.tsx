'use client';

import { useState } from 'react';
import type { TreeNode } from '@gtd/db';
import { useFilePreview } from './file-preview';
import {
  IconDocument,
  IconEnvelope,
  IconImage,
  IconProject,
  IconSheet,
} from './icons';

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
 * A file opens *in the pane* rather than a tab, through Drive's own preview
 * embed. That runs off the browser's Google session rather than the app's OAuth
 * token, which is exactly how the Docs editor already embeds here — and it is
 * what makes this worth building at all, because a navigator that sends you to
 * another tab for every file is a worse bookmark.
 */

/**
 * The mark for one node.
 *
 * A component rather than a function returning one, which is not a style
 * preference: choosing a component *during* render gives the compiler a new
 * type on every pass, and it says so. Picking inside the render is the same
 * decision made where it is allowed to be made.
 */
function NodeGlyph({ node }: { node: TreeNode }) {
  if (node.kind === 'folder' || node.kind === 'label') return <IconProject />;
  if (node.kind === 'message') return <IconEnvelope />;

  const mime = node.mimeType ?? '';
  if (mime.startsWith('image/')) return <IconImage />;
  if (mime.includes('spreadsheet') || mime === 'text/csv') return <IconSheet />;
  return <IconDocument />;
}

/** Bytes, in the shortest form that is still honest. */
function size(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Row({ node, depth }: { node: TreeNode; depth: number }) {
  const preview = useFilePreview();
  // Open at the top, closed below it: the first level is what you came to see,
  // and everything expanded is a wall.
  const [open, setOpen] = useState(depth === 0);

  const branch = node.kind === 'folder' || node.kind === 'label';
  const kids = node.children ?? [];

  const openIt = () => {
    if (!node.url) return;

    if (node.kind === 'message') {
      // A message is read in Gmail. There is no embed for one, and the stored
      // copy this app keeps is of *filed* messages, which these are not.
      window.open(node.url, '_blank', 'noopener,noreferrer');
      return;
    }

    preview.open({
      id: `drive:${node.id}`,
      name: node.name,
      mimeType: node.mimeType ?? null,
      src: '',
      driveFileId: node.id,
      driveUrl: node.url,
      /*
       * Drive's own preview, which renders far more formats than a browser will
       * and needs no scope from us — it runs off whichever Google account the
       * browser is signed into. A permission prompt here is the wrong-account
       * case, not a broken link.
       */
      embedUrl: `https://drive.google.com/file/d/${node.id}/preview`,
    });
  };

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

        <span className="shrink-0 text-grey-400">
          <NodeGlyph node={node} />
        </span>

        {node.url && !branch ? (
          <button
            type="button"
            onClick={openIt}
            className="min-w-0 flex-1 truncate text-left text-grey-800 hover:text-selected hover:underline"
            title={node.name}
          >
            {node.name}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-grey-700" title={node.name}>
            {node.name}
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
