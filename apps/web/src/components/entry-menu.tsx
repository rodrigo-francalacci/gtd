'use client';

import { clarifyInboxItem, deleteDocument, updateDocument } from '@/lib/actions';
import { RowMenu } from './row-menu';

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
  children,
}: {
  id: string;
  name: string;
  description: string | null;
  children: React.ReactNode;
}) {
  return (
    <RowMenu
      name={name}
      onRename={(next) => updateDocument(id, next, description ?? '')}
      onDelete={() => deleteDocument(id)}
      deleteLabel="Throw away"
      deleteNote="The file goes to the Drive bin, where you can still get it back."
    >
      {children}
    </RowMenu>
  );
}

/**
 * A capture: trashed, never renamed.
 *
 * **No rename, and that is the convention rather than an omission.** A raw
 * capture is immutable — the whole design of the inbox is that what you typed
 * is kept exactly as you typed it and the decision is stamped *beside* it, so
 * editing the text here would be the one thing the record is built to prevent.
 * Clarifying is where a capture gets a title, and that title goes on the action
 * or project it becomes.
 *
 * "Trash it" is the clarify outcome of the same name, not a delete. The row
 * stays, marked as dealt with, which is what keeps the evidence — and what keeps
 * a photograph attached to the capture rather than stranded.
 */
export function CaptureMenu({
  id,
  name,
  children,
}: {
  id: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <RowMenu
      name={name}
      onDelete={() => clarifyInboxItem(id, { kind: 'trashed' })}
      deleteLabel="Trash it"
      deleteNote="It leaves the inbox and is kept as trashed, with anything attached to it."
    >
      {children}
    </RowMenu>
  );
}
