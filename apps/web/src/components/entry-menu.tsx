'use client';

import {
  clarifyInboxItem,
  deleteDocument,
  renameCapture,
  setBoxItemPinned,
  updateDocument,
} from '@/lib/actions';
import { RowMenu } from './row-menu';
import { copyIdItem } from '@/lib/copy-token';

/**
 * The row menu for the two lists whose pages are Server Components.
 *
 * The sortable lists wrap their own rows, because they are client components
 * already and have the row in hand. A box feed and the inbox are rendered on the
 * server, where a closure cannot be handed to a client component — so the
 * closures live here instead, one thin client wrapper per kind.
 */

/**
 * A box entry: rename it, or throw it away.
 *
 * Throwing away **trashes the Drive file, never deletes it** — the rule the
 * pane's own control follows. A box is for keeping things, so this is rare on
 * purpose; but a blank scan or a duplicate is real, and a box you cannot take
 * rubbish out of stops being one you trust.
 *
 * The description travels with the rename because `updateDocument` writes both
 * and the search text is rebuilt from them together. Sending an empty one would
 * quietly wipe the summary the model wrote.
 */
export function DocumentMenu({
  id,
  name,
  description,
  pinned,
  focusHref,
  children,
}: {
  id: string;
  name: string;
  description: string | null;
  /** Whether it is currently lifted above the days. */
  pinned?: boolean;
  /** Where a double-click opens this entry to work on. */
  focusHref?: string;
  children: React.ReactNode;
}) {
  return (
    <RowMenu
      name={name}
      focusHref={focusHref}
      onRename={(next) => updateDocument(id, next, description ?? '')}
      onDelete={() => deleteDocument(id)}
      deleteLabel="Throw away"
      deleteNote="The file goes to the Drive bin, where you can still get it back."
      /*
       * In the menu rather than on the row: pinning is something you do to an
       * entry a handful of times, and a control on every row would take width
       * from the thing the row exists to show. The same reasoning that put
       * rename and remove here.
       */
      extra={[
        {
          label: pinned ? 'Unpin' : 'Pin to the top',
          run: () => setBoxItemPinned(id, !pinned),
        },
        /*
         * So a note can point at this entry — including from another box, which
         * is most of what the `B` link is for. The token, never the bare uuid:
         * a uuid alone cannot say which table it names.
         */
        copyIdItem('boxItem', id),
      ]}
    >
      {children}
    </RowMenu>
  );
}

/**
 * A capture: renamed on its first line, and trashed rather than deleted.
 *
 * Renaming looked at first as though it contradicted "raw capture is
 * immutable". It does not, and the distinction matters: that rule constrains
 * the *app* — the suggester must never rewrite what you wrote, and clarifying
 * must stamp its outcome beside the original instead of editing it. It exists so
 * the machine cannot quietly change your words. It was never an argument for
 * stopping the author fixing their own typo, and a queue you cannot correct a
 * mis-tap in has a permanent piece of grit in it.
 *
 * Only the first line moves. A capture is one `raw_text` — title, blank line,
 * note — and the title is what a list shows; the note underneath is left alone.
 *
 * "Trash it" is the clarify outcome of the same name, not a delete. The row
 * stays, marked as dealt with, which is what keeps the evidence — and what keeps
 * a photograph attached to the capture rather than stranded.
 */
export function CaptureMenu({
  id,
  name,
  focusHref,
  children,
}: {
  id: string;
  name: string;
  /** Where a double-click opens the desk — this queue, with everywhere it goes. */
  focusHref?: string;
  children: React.ReactNode;
}) {
  return (
    <RowMenu
      name={name}
      focusHref={focusHref}
      onRename={(next) => renameCapture(id, next)}
      onDelete={() => clarifyInboxItem(id, { kind: 'trashed' })}
      deleteLabel="Trash it"
      deleteNote="It leaves the inbox and is kept as trashed, with anything attached to it."
    >
      {children}
    </RowMenu>
  );
}
