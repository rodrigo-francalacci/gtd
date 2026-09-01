import 'server-only';

import { attachments, actions, boxItems, db, listItems, projects } from '@gtd/db';
import type { AttachmentKind, AttachmentParentType } from '@gtd/db';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { getGrant } from '@/lib/auth/token';
import { hasSyncScopes } from '@/lib/auth/google';
import { enqueueEnrichment } from '@/lib/enrich/queue';
import { FORMAT_BY_MIME } from '@/lib/text-formats';
import type { MediaFacts } from '@/lib/media-facts';
import { MAX_UPLOAD_BYTES } from '@/lib/upload';
import {
  createGoogleFile,
  createResumableSession,
  createTextFile,
  ensureFolder,
  getFile,
  moveFile,
  renameFile,
  trashFile,
  uploadFile,
} from './client';
import { ROOT, containerPath, safeName } from './sync';

/**
 * Re-exported so existing callers keep reading it from here. The number itself
 * lives in `lib/upload.ts`, which the capture box can import — this module is
 * `server-only`, and the limit has to be known on both sides so an oversized
 * file is refused before it spends a minute uploading, with a sentence you can
 * act on rather than a platform-level 413.
 */
export { MAX_UPLOAD_BYTES };

export class AttachmentError extends Error {}

/** Where an unfiled capture lands, so nothing is ever uploaded to the root. */
const INBOX = 'Inbox';

function kindFor(mimeType: string): AttachmentKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * The Drive folder of a gallery, which may be an attachment or a box entry.
 *
 * Two tables and one id, because `parent_id` has always been a bare uuid
 * addressing several of them. Asked in the order that is cheapest to be wrong
 * about: most galleries hang off a project.
 */
async function galleryFolder(galleryId: string): Promise<string | null> {
  const [asAttachment] = await db
    .select({ driveFileId: attachments.driveFileId })
    .from(attachments)
    .where(and(eq(attachments.id, galleryId), eq(attachments.kind, 'gallery')))
    .limit(1);

  if (asAttachment?.driveFileId) return asAttachment.driveFileId;

  const [asBoxItem] = await db
    .select({ driveFileId: boxItems.driveFileId })
    .from(boxItems)
    .where(and(eq(boxItems.id, galleryId), eq(boxItems.kind, 'gallery')))
    .limit(1);

  return asBoxItem?.driveFileId ?? null;
}

/**
 * Put a file where its row now says it belongs.
 *
 * A capture's photograph goes up before anything is decided about it, so it
 * lands in `GTD/Inbox` — which is the honest answer at the time and the wrong
 * one a minute later, once clarifying has said this is the quote for the
 * kitchen. Until now the row moved and the file did not: the app showed it on
 * the project and Drive went on holding it in the inbox, so the folder you open
 * in a year — which is the whole reason files follow the project — was missing
 * exactly the things that arrived as captures.
 *
 * `attachmentFolder` answers where it should be, which is what makes this
 * correct for every outcome rather than only the ones with a project: an action
 * resolves to its project, a project to itself, a list item or a standalone
 * action to `GTD/Inbox`, and a finished project to its year in the archive. It
 * also creates the project's folder if this is the first file to want one,
 * which is the on-demand rule already.
 *
 * Idempotent both ways round. `moveFile` returns without a call when the file
 * is already there, so a job that runs twice costs one metadata read, and a
 * file whose row has moved on again is simply put wherever it now belongs.
 */
export async function moveAttachmentFile(attachmentId: string): Promise<void> {
  const [row] = await db
    .select({
      driveFileId: attachments.driveFileId,
      parentType: attachments.parentType,
      parentId: attachments.parentId,
      kind: attachments.kind,
    })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  // Deleted, or never had a file. Neither is an error and neither is retryable.
  if (!row?.driveFileId) return;

  /*
   * A gallery *is* a folder, and moving a folder moves everything in it — which
   * is right, and is why this is allowed rather than skipped. Its pictures are
   * parented on the gallery, so `attachmentFolder` sends each of them into the
   * gallery itself and they never need moving on their own.
   */
  await moveFile(row.driveFileId, await attachmentFolder(row.parentType, row.parentId));
}

/**
 * The Drive folder a file attached to this thing belongs in.
 *
 * An action's files go to its project's folder rather than a folder of their
 * own — the project is the unit you go looking in months later, and a folder
 * per action would bury it. Anything with no project goes to `GTD/Inbox`.
 */
/**
 * Exported because a gallery has to land in exactly the place a file would.
 *
 * Working the folder out a second time in the gallery code is how the two would
 * drift — one of them learning about the archive container and the other not,
 * which is the bug this module already fixed once.
 */
export async function attachmentFolder(
  parentType: AttachmentParentType,
  parentId: string,
): Promise<string> {
  /*
   * A gallery is a folder in Drive, so its members go straight into it and
   * there is nothing else to work out. This has to come first: a gallery on an
   * action would otherwise fall through to the action's project and every
   * picture would land beside the folder instead of in it.
   */
  if (parentType === 'gallery') {
    const folderId = await galleryFolder(parentId);
    if (folderId) return folderId;

    // The gallery row is gone, or was never given a folder. Better in the
    // inbox than nowhere: the bytes are already on their way.
    return ensureFolder(INBOX, await ensureFolder(ROOT));
  }

  const projectId =
    parentType === 'project'
      ? parentId
      : // A capture is unfiled by definition — deciding where it belongs is
        // what clarifying is for, and it hasn't happened yet. `GTD/Inbox` is
        // the honest answer rather than a guess.
        parentType === 'inbox_item'
        ? null
        : parentType === 'action'
          ? (
              await db
                .select({ projectId: actions.projectId })
                .from(actions)
                .where(eq(actions.id, parentId))
                .limit(1)
            )[0]?.projectId
          : (
              await db
                .select({ projectId: listItems.projectId })
                .from(listItems)
                .where(eq(listItems.id, parentId))
                .limit(1)
            )[0]?.projectId;

  const root = await ensureFolder(ROOT);
  if (!projectId) return ensureFolder(INBOX, root);

  const [project] = await db
    .select({
      title: projects.title,
      status: projects.status,
      completedAt: projects.completedAt,
      driveFolderId: projects.driveFolderId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return ensureFolder(INBOX, root);
  if (project.driveFolderId) return project.driveFolderId;

  /*
   * This is where a project's Drive folder comes from.
   *
   * Not a fallback for a project that predates the connection any more — this
   * is the ordinary path. A project is a decision, not a filing cabinet, and
   * making a folder for every one of them fills an account with empty
   * containers named after things somebody thought about once. Attaching a file
   * is the moment there is something to put in one, so that is the moment it
   * is made.
   *
   * A Google call inside a request, under the same exception the upload itself
   * is: the caller is already going to Drive with the bytes, and one folder
   * lookup in front of that is not what makes it slow. Queueing it would mean
   * having nowhere to put the file that is already in flight.
   *
   * **The container follows the project's status**, which the older version of
   * this got wrong: it always used `Projects`, so a file attached to something
   * finished last year landed beside the live work instead of under
   * `Archive/<year>`. `containerPath` owns that decision for Drive and Gmail
   * alike, so asking it here is what keeps the two from disagreeing.
   */
  let container = root;
  for (const segment of containerPath(project.status, project.completedAt)) {
    container = await ensureFolder(segment, container);
  }

  const folderId = await ensureFolder(safeName(project.title), container);

  await db
    .update(projects)
    .set({ driveFolderId: folderId })
    .where(eq(projects.id, projectId));

  return folderId;
}

/**
 * Put a file in Drive and record it against the thing it belongs to.
 *
 * This is the one place the app calls Google inside a request. Everything else
 * enqueues, but an upload *is* the payload — queueing it would mean storing
 * the bytes somewhere first, and Drive is the only somewhere there is.
 */
export async function uploadAttachment(
  parentType: AttachmentParentType,
  parentId: string,
  file: File,
): Promise<{ id: string; name: string }> {
  const grant = await getGrant();
  if (!grant?.refreshToken || !hasSyncScopes(grant.scope)) {
    throw new AttachmentError(
      'Drive is not connected. Connect it on the Google page first.',
    );
  }

  if (file.size === 0) throw new AttachmentError('That file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AttachmentError(
      `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ` +
        `${MAX_UPLOAD_BYTES / 1024 / 1024} MB — put it in the project's Drive ` +
        'folder directly and link it instead.',
    );
  }

  const folderId = await attachmentFolder(parentType, parentId);
  const mimeType = file.type || 'application/octet-stream';

  const uploaded = await uploadFile(
    safeName(file.name),
    mimeType,
    await file.arrayBuffer(),
    folderId,
  );

  const [row] = await db
    .insert(attachments)
    .values({
      parentType,
      parentId,
      kind: kindFor(mimeType),
      driveFileId: uploaded.id,
      name: uploaded.name ?? file.name,
      // Drive holds exactly this, so the two start in step and the rename
      // sweep has nothing to do until one of them changes.
      driveName: uploaded.name ?? file.name,
      mimeType,
      sizeBytes: file.size,
    })
    .returning({ id: attachments.id, name: attachments.name });

  // Reading the file happens afterwards, in the worker. Capture never waits
  // on a model any more than it waits on Drive.
  await enqueueEnrichment(row.id, mimeType);

  return row;
}

/**
 * Step one of a direct upload: pick the folder and open a Drive session.
 *
 * The browser sends the bytes itself, so nothing here is limited by Vercel's
 * 4.5 MB body cap — which is the whole reason this path exists beside
 * `uploadAttachment`. That one stays for small files and for anything that
 * would rather do a single request.
 */
export async function startUploadSession(
  parentType: AttachmentParentType,
  parentId: string,
  name: string,
  mimeType: string,
  origin: string,
): Promise<string> {
  const grant = await getGrant();
  if (!grant?.refreshToken || !hasSyncScopes(grant.scope)) {
    throw new AttachmentError(
      'Drive is not connected. Connect it on the Google page first.',
    );
  }

  const folderId = await attachmentFolder(parentType, parentId);
  return createResumableSession(
    safeName(name),
    mimeType || 'application/octet-stream',
    folderId,
    origin,
  );
}

/**
 * Step two: record the file the browser just uploaded.
 *
 * The name, type and size come from *Google*, not from the request. The client
 * supplies only an id, and `getFile` both confirms the file exists and settles
 * what it actually is — a browser that lied about a 4 KB text file being a
 * 40 MB PDF cannot make our row disagree with Drive.
 *
 * `drive.file` is doing quiet work here too: it can only see files this app
 * created, so an id belonging to anything else comes back null and is refused.
 */
export async function completeUpload(
  parentType: AttachmentParentType,
  parentId: string,
  driveFileId: string,
  /**
   * What the browser read off the file before sending it.
   *
   * Trusted, unlike the name and size, and the difference is worth stating:
   * those are read back from Drive because a client could otherwise make our
   * row disagree with the file, and it matters that it cannot. A caption
   * saying a photograph is 4032 pixels wide has nothing to protect — the worst
   * a wrong one does is mislabel a picture you are looking at.
   *
   * The alternative is fetching every photograph back out of Drive to measure
   * it, which for a gallery of forty is forty downloads for a caption.
   */
  facts?: MediaFacts,
): Promise<{ id: string; name: string }> {
  const file = await getFile(driveFileId);
  if (!file) {
    throw new AttachmentError('That upload could not be found in Drive.');
  }

  const mimeType = file.mimeType ?? 'application/octet-stream';
  const size = file.size ? Number(file.size) : null;

  const [row] = await db
    .insert(attachments)
    .values({
      parentType,
      parentId,
      kind: kindFor(mimeType),
      driveFileId: file.id,
      name: file.name,
      driveName: file.name,
      mimeType,
      sizeBytes: Number.isFinite(size) ? size : null,
      width: facts?.width ?? null,
      height: facts?.height ?? null,
      takenAt: facts?.takenAt ? new Date(facts.takenAt) : null,
      latitude: facts?.latitude ?? null,
      longitude: facts?.longitude ?? null,
    })
    .returning({ id: attachments.id, name: attachments.name });

  await enqueueEnrichment(row.id, mimeType);

  return row;
}

/**
 * Make an empty document on this project, action or list item.
 *
 * The counterpart to uploading, and it now covers two kinds of empty. A Google
 * Doc, Sheet or deck has no bytes at all — it is metadata and whatever Google
 * keeps behind it — so `createGoogleFile` is the whole call. A markdown, LaTeX
 * or HTML file is an ordinary file that happens to be nearly empty, so it is
 * created *with* its starter text in one multipart request.
 *
 * Both land in the same folder an upload would, and both come back as an
 * attachment row indistinguishable from any other. What differs afterwards is
 * only where they are edited: Google's formats open their own editor in the
 * preview pane, and these open ours.
 */
export async function createGoogleDocument(
  parentType: AttachmentParentType,
  parentId: string,
  mimeType: string,
  name: string,
): Promise<{ id: string; name: string; driveFileId: string }> {
  const grant = await getGrant();
  if (!grant?.refreshToken || !hasSyncScopes(grant.scope)) {
    throw new AttachmentError(
      'Drive is not connected. Connect it on the Google page first.',
    );
  }

  const format = FORMAT_BY_MIME[mimeType];

  /*
   * The extension is part of the name for a text file and meaningless for a
   * Google one. It matters more than it looks: `formatOf` reads the name first
   * precisely because a type header cannot be trusted, so a `.tex` created
   * without its extension would come back from Drive as an unrecognised file
   * and open in the wrong view.
   */
  const base = safeName(name) || 'Untitled';
  const title = format ? `${base}.${format.extension}` : base;

  const folderId = await attachmentFolder(parentType, parentId);

  const created = format
    ? await createTextFile(title, format.mime, folderId, format.starter)
    : await createGoogleFile(title, mimeType, folderId);

  const [row] = await db
    .insert(attachments)
    .values({
      parentType,
      parentId,
      kind: 'file',
      driveFileId: created.id,
      name: created.name ?? title,
      driveName: created.name ?? title,
      mimeType,
      // A Docs-editor file has no size on our side — Google stores it. A text
      // file has exactly the starter text in it, which is what Drive reports
      // back, so the row is right from the moment it is written rather than
      // saying "—" until something else happens to touch it.
      sizeBytes: format ? new TextEncoder().encode(format.starter).length : null,
    })
    .returning({
      id: attachments.id,
      name: attachments.name,
      driveFileId: attachments.driveFileId,
    });

  // Nothing to read in an empty document. It gets queued the first time the
  // enrichment backfill runs after you have actually written something.
  return { ...row, driveFileId: created.id };
}

/**
 * Pull Docs and Sheets names back from Google.
 *
 * This looks like it contradicts one-way sync, and doesn't. For a project
 * folder the app owns the name — the project title is the source of truth and
 * a rename in Drive is drift to report. For a document, Google owns it: you
 * rename a doc by typing in its title bar, and this app offers no other way to
 * do it. Holding a stale copy of a name whose only editor is elsewhere would
 * be the app pretending to own something it doesn't.
 *
 * Only Docs-editor files. An uploaded file's name is the name it was uploaded
 * with, and the app is the one that set it.
 */
export async function refreshGoogleNames(limit = 50): Promise<number> {
  const grant = await getGrant();
  if (!grant?.refreshToken || !hasSyncScopes(grant.scope)) return 0;

  const rows = await db
    .select({
      id: attachments.id,
      name: attachments.name,
      driveFileId: attachments.driveFileId,
    })
    .from(attachments)
    /*
     * Docs-editor files only — never folders.
     *
     * Google owns a Doc's name: you rename one by typing in its title bar, and
     * this app offers no other way, so holding a stale copy would be pretending
     * to own something it does not. A *folder* is the opposite — a gallery's
     * folder is named by this app and by nothing else, and it is the push
     * (`renameDriveAttachments`) that is authoritative there.
     *
     * Both sweeps run in the same `Promise.all`, so without this exclusion a
     * renamed gallery would be a race: the push writing the new name to Drive
     * while the pull writes Drive's old name back into the app, and whichever
     * finished last would win.
     */
    .where(
      sql`${attachments.mimeType} like 'application/vnd.google-apps.%'
          and ${attachments.mimeType} <> 'application/vnd.google-apps.folder'`,
    )
    .limit(limit);

  let changed = 0;

  for (const row of rows) {
    if (!row.driveFileId) continue;

    // A file that has been deleted in Drive gets left alone rather than
    // renamed to nothing — losing the label as well would be losing twice.
    const file = await getFile(row.driveFileId);
    if (!file?.name || file.name === row.name) continue;

    await db
      .update(attachments)
      // Both, and that is the point: this is now the name Drive holds *and*
      // the name we want, so the push sweep sees no disagreement and doesn't
      // send Google's own answer straight back to it.
      .set({ name: file.name, driveName: file.name })
      .where(eq(attachments.id, row.id));

    changed += 1;
  }

  return changed;
}

/**
 * Carry a renamed attachment out to Drive.
 *
 * The same arrangement the Big Box uses, and the same reason for it: the app
 * owns the name of a file it uploaded, so renaming it here should rename it
 * there rather than leaving Drive holding `IMG_20260812.jpg` for something
 * this app calls the quote from the kitchen fitter.
 *
 * The one difference is where the two names live. A box document already had
 * somewhere to keep the name it was given — `title` beside `name` — so the
 * disagreement between them *was* the outstanding work. An attachment had only
 * the one column, hence `drive_name`: `name` is what we want, `drive_name` is
 * what Drive is known to hold, and the gap between them is the queue.
 *
 * Docs-editor files are excluded, as they are there. Those are renamed by
 * typing in a title bar, so Google owns the name and `refreshGoogleNames`
 * above pulls it in — pushing here as well would be two systems each
 * overwriting the other on alternate ticks.
 *
 * A null `drive_name` means a row written before this existed: left alone
 * rather than renamed on the strength of a guess about what Drive holds.
 */
export async function renameDriveAttachments(limit = 50): Promise<number> {
  const grant = await getGrant();
  if (!grant?.refreshToken || !hasSyncScopes(grant.scope)) return 0;

  const rows = await db
    .select({
      id: attachments.id,
      name: attachments.name,
      driveFileId: attachments.driveFileId,
    })
    .from(attachments)
    .where(
      and(
        isNotNull(attachments.driveFileId),
        isNotNull(attachments.driveName),
        ne(attachments.name, attachments.driveName),
        /*
         * Docs-editor files are excluded because Google owns their names — you
         * rename one by typing in its title bar. A *folder* is not that: a
         * gallery's folder is named by this app and by nothing else, so it must
         * come through or a renamed gallery keeps its old folder name for ever.
         */
        sql`coalesce(${attachments.mimeType}, '') not like 'application/vnd.google-apps.%'
            or ${attachments.mimeType} = 'application/vnd.google-apps.folder'`,
      ),
    )
    .limit(limit);

  let renamed = 0;

  for (const row of rows) {
    const wanted = safeName(row.name);
    if (!wanted) continue;

    try {
      await renameFile(row.driveFileId!, wanted);
    } catch {
      // Usually a file removed from Drive by hand. Not a reason to stop
      // renaming the rest.
      continue;
    }

    // After Drive agrees, never before — otherwise a failed rename would
    // leave the app certain of a name that was never applied, and the
    // disagreement it retries on would be gone.
    await db
      .update(attachments)
      .set({ driveName: wanted, name: wanted })
      .where(eq(attachments.id, row.id));

    renamed += 1;
  }

  return renamed;
}

/**
 * Remove an attachment. The Drive file goes to the bin, not the void — and
 * only ever the file this app uploaded itself.
 */
/**
 * Trash every picture in a gallery and forget the rows.
 *
 * Here rather than in `google/galleries.ts` for the reason `driveNameFor` moved
 * into `sync.ts`: that module would otherwise have to import this one for
 * `removeAttachment` while this one imports it for the purge, and two modules
 * that need each other are one module wearing two names.
 *
 * One at a time, because each has a Drive file to trash. A failure is quiet on
 * purpose: a picture Drive will not let go of must not stop the other
 * twenty-nine, and the row goes either way.
 */
export async function purgeGalleryPictures(galleryId: string): Promise<void> {
  const pictures = await db
    .delete(attachments)
    .where(and(eq(attachments.parentType, 'gallery'), eq(attachments.parentId, galleryId)))
    .returning({ driveFileId: attachments.driveFileId });

  for (const picture of pictures) {
    if (!picture.driveFileId) continue;

    try {
      await trashFile(picture.driveFileId);
    } catch {
      // Already gone, or Drive is refusing. Recoverable from its bin either
      // way, and the row is the thing that had to go.
    }
  }
}

/**
 * Trash a deleted project's Drive folder.
 *
 * Deleting a project already takes every file with it, one at a time, because
 * `parent_id` is polymorphic and nothing cascades — but the *container* was
 * left standing, so the account slowly filled with empty folders named after
 * projects that no longer exist. That is the on-demand rule not finishing its
 * sentence: a folder is made the first time there is something to put in it,
 * and it should go when there is nothing left and nothing to put there again.
 *
 * **Trashed, never deleted**, like every file this app removes. A folder in the
 * bin can be restored by whoever changes their mind; a folder deleted outright
 * cannot, and this is the one operation here that could take a year of work in
 * one press if it ever reached the wrong id.
 *
 * Called *after* the files have gone, so what is trashed is an empty folder
 * rather than a folder that takes live documents down with it — the opposite
 * order to a gallery, whose pictures are *in* it and are meant to follow.
 *
 * A failure is swallowed for the reason `removeAttachment` swallows one: being
 * unable to delete a project because of a problem at Google's end is worse than
 * an empty folder in a bin you can empty. The folder is also usually already
 * gone by hand, which is a 404 rather than a fault.
 */
export async function trashProjectFolder(folderId: string | null): Promise<void> {
  if (!folderId) return;

  try {
    await trashFile(folderId);
  } catch {
    // Deleting the project is what was asked for, and it has happened.
  }
}

export async function removeAttachment(id: string): Promise<void> {
  const [row] = await db
    .delete(attachments)
    .where(eq(attachments.id, id))
    .returning({
      driveFileId: attachments.driveFileId,
      kind: attachments.kind,
    });

  if (!row) return;

  /*
   * A gallery takes its pictures with it.
   *
   * `parent_id` is polymorphic and carries no foreign key, so nothing
   * cascades and nothing else is going to do this — the same reason deleting a
   * project has to purge its attachments by hand. Without it, removing a
   * gallery would leave thirty rows pointing at an id that names nothing, with
   * their Drive files sitting in a folder no page can reach.
   *
   * Before the folder rather than after, because the folder is what the
   * pictures are in: trashing it first would leave each `trashFile` below
   * acting on something already in the bin.
   */
  if (row.kind === 'gallery') {
    await purgeGalleryPictures(id);
  }

  if (!row.driveFileId) return;

  try {
    await trashFile(row.driveFileId);
  } catch {
    // The row is already gone and the file is recoverable from Drive's bin.
    // Failing the whole action here would leave you unable to detach anything
    // because of a problem at Google's end.
  }
}
