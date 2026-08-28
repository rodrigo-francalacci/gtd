'use client';

import type { TreeNode } from '@gtd/db';
import { GoogleTree } from './google-tree';
import { useFilePreview } from './file-preview';

/**
 * Open a project's Drive folder and Gmail label in the preview pane.
 *
 * The pane is where you look at things, and this is a thing to look at — a whole
 * folder rather than one file. Rendering it there rather than inline in the
 * detail pane is the same call the file preview makes: a tree is tall, and a
 * detail pane already has a project's whole life in it.
 *
 * The pane takes a `PreviewFile`, which describes bytes or a page. A tree is
 * neither, so it is handed over as `node` — a rendered element the pane shows as
 * it is. That is a third kind rather than a special case: anything the app can
 * render and wants a tall column for can now use the pane, which is what the
 * pane is.
 */
export function BrowseGoogle({
  projectTitle,
  drive,
  gmail,
  fetchedAt,
  error,
}: {
  projectTitle: string;
  drive: TreeNode | null;
  gmail: TreeNode | null;
  fetchedAt: string | null;
  error: string | null;
}) {
  const preview = useFilePreview();

  if (!drive && !gmail) return null;

  return (
    <button
      type="button"
      onClick={() =>
        preview.open({
          id: `tree:${projectTitle}`,
          name: projectTitle,
          mimeType: null,
          src: '',
          driveFileId: null,
          driveUrl: null,
          node: (
            <GoogleTree
              drive={drive}
              gmail={gmail}
              fetchedAt={fetchedAt ? new Date(fetchedAt) : null}
              error={error}
            />
          ),
        })
      }
      className="rounded-sm bg-grey-200 px-2 py-0.5 text-[11px] text-grey-700 hover:bg-grey-300"
    >
      Browse files &amp; email
    </button>
  );
}
