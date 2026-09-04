'use client';

import { useEffect } from 'react';
import type { TreeNode } from '@gtd/db';
import { GoogleTree } from './google-tree';
import { useFilePreview, useOpenFile } from './file-preview';

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
  projectId,
  projectTitle,
  drive,
  gmail,
  fetchedAt,
  error,
}: {
  projectId: string;
  projectTitle: string;
  drive: TreeNode | null;
  gmail: TreeNode | null;
  fetchedAt: string | null;
  error: string | null;
}) {
  const preview = useFilePreview();
  const openFile = useOpenFile();

  const has = Boolean(drive || gmail);

  /*
   * Selecting a project loads its folder, without going to it.
   *
   * The same call a box entry makes about its scan, for the same reason: there
   * is exactly one thing you could want in the pane beside a project, so making
   * you ask for it only tells the app what it already knows. On a desktop the
   * tree simply appears beside the project; on a phone the pane is ready before
   * you swipe to it.
   *
   * `preload`, not `open` — the carousel must not travel. You asked to look at
   * the project; the folder is the thing next to it.
   */
  const { preload } = preview;

  useEffect(() => {
    if (!has) return;

    preload({
      id: `tree:${projectId}`,
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
    });
    /*
     * Keyed on the project, not on the tree object, which is rebuilt on every
     * render. Deliberately *not* clearing on a project with no tree: that would
     * empty a pane you had opened something else into, and "nothing to show" is
     * not a reason to take away what is there.
     *
     * **`preload` must not be in here**, and leaving it in was the whole of a
     * bug that made this pane useless. The provider memoises its api on the
     * open file, so opening *anything* hands out a new `preload` — which ran
     * this effect again, which put the tree back. Clicking an attachment, a
     * linked document or an email therefore replaced the tree for one frame
     * and then lost to it, and the pane looked as though only the tree would
     * ever load. A stale `preload` is not a hazard: every generation of it
     * closes over nothing but `setState`, so they all behave identically.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, has]);

  if (!has) return null;

  return (
    <button
      type="button"
      onClick={() =>
        openFile({
          id: `tree:${projectId}`,
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
