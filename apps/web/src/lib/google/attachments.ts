import 'server-only';

import { attachments, actions, boxItems, db, listItems, lists, projects } from '@gtd/db';
import type { AttachmentKind, AttachmentParentType } from '@gtd/db';
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
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
  folderChildIds,
  moveFile,
  renameFile,
  trashFile,
  uploadFile,
} from './client';
import { ensureActionFolder } from './action-folders';
import { settleFolderRace } from './folder-race';
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
/** Where a list keeps its files: `GTD/Lists/<name>`. */
const LISTS = 'Lists';

/**
 * A list's Drive folder, made the first time something needs one.
 *
 * A list item with no project used to land in `GTD/Inbox` along with every
 * loose capture — so a photograph of something on the Purchases list was filed
 * under a name that says the opposite of where it belongs, and opening Drive
 * showed no Purchases folder at all. The app said one thing and Drive said
 * another, which is the state this app exists not to be in.
 *
 * **A list gets a folder because it is a container**: an item belongs to
 * exactly one, so there is a single right answer to where its file goes. The
 * sidebar's other entries are *views* — the same action shows in "What can I do
 * now" and in "File actions" — and a file can only be in one folder, so a
 * folder per view would be a lie dressed as tidiness. That is the line, and it
 * is why loose actions still go to the inbox folder rather than getting a
 * container invented for them.
 *
 * On demand, never on create, for the reason a project's is: most lists never
 * hold a file, and making a folder for every one fills an account with empty
 * containers named after things nobody attached anything to.
 *
 * Checked before it is trusted, and raced-for safely — the same two rules the
 * project folder learned, both the hard way.
 */
async function listFolder(listId: string): Promise<string | null> {
  const [list] = await db
    .select({ name: lists.name, driveFolderId: lists.driveFolderId })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);

  if (!list) return null;

  if (list.driveFolderId) {
    const existing = await getFile(list.driveFolderId);
    if (existing && !existing.trashed) return list.driveFolderId;
  }

  const root = await ensureFolder(ROOT);
  const container = await ensureFolder(LISTS, root);
  const folderId = await ensureFolder(safeName(list.name) || 'List', container);

  const [won] = await db
    .update(lists)
    .set({ driveFolderId: folderId })
    .where(
      and(
        eq(lists.id, listId),
        list.driveFolderId === null
          ? isNull(lists.driveFolderId)
          : eq(lists.driveFolderId, list.driveFolderId),
      ),
    )
    .returning({ id: lists.id });

  if (won) return folderId;

  const [now] = await db
    .select({ driveFolderId: lists.driveFolderId })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);

  return settleFolderRace(folderId, now?.driveFolderId ?? null);
}

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

  /*
   * No project, but it is on a list — so there *is* a container, and the list
   * is it. This has to come before the inbox fallback: a list item with no
   * project used to be indistinguishable from a loose capture here, which is
   * how a photograph of something on the Purchases list ended up filed under
   * `GTD/Inbox` with no Purchases folder anywhere in Drive.
   */
  /*
   * An action with no project has a container of its own now.
   *
   * It used to land in `GTD/Inbox`, which said the opposite of what is true:
   * the inbox holds what has not been decided about, and a promoted action is
   * a decision already taken. It simply has nothing above it.
   */
  if (!projectId && parentType === 'action') {
    const own = await ensureActionFolder(parentId);
    if (own) return own;
  }

  if (!projectId && parentType === 'list_item') {
    const onList = await listFolder(
      (
        await db
          .select({ listId: listItems.listId })
          .from(listItems)
          .where(eq(listItems.id, parentId))
          .limit(1)
      )[0]?.listId ?? '',
    );

    if (onList) return onList;
  }

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

  /*
   * The stored folder, but only if it is still there.
   *
   * This used to be returned unchecked, and a folder deleted in Drive then made
   * every upload to that project succeed **into the bin**: Drive accepts a
   * parent that is trashed, so the app reported the file as attached, the row
   * pointed at it, and it was invisible — until Drive emptied the bin after
   * thirty days and took it for good. Silent, and the worst way for a mistake
   * to behave.
   *
   * A box has always checked (`ensureBoxFolder`), so this is the same rule
   * arriving where it was missing rather than a new idea. Making a fresh folder
   * does not contradict one-way sync: the documents already filed keep their
   * own ids and are unaffected, and this only decides where the *next* one
   * lands — the alternative is refusing to accept a file at all.
   *
   * One `getFile` per upload, which is nothing beside the bytes.
   */
  if (project.driveFolderId) {
    const existing = await getFile(project.driveFolderId);
    if (existing && !existing.trashed) return project.driveFolderId;
  }

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

  /*
   * Written only if nobody has changed it since it was read.
   *
   * Two tabs attaching to the same folderless project both got here, both made
   * a folder, and one upload went into the folder the row does not point at.
   * There are no transactions here, so this single conditional statement is the
   * referee: exactly one caller can match, and the others adopt what it wrote.
   *
   * Compared against the value that was *read*, not against null — the branch
   * above deliberately falls through when the stored folder has been trashed in
   * Drive, and demanding null there would refuse to replace it and send the
   * upload back into the bin, which is the bug that check exists to prevent.
   */
  const [won] = await db
    .update(projects)
    .set({ driveFolderId: folderId })
    .where(
      and(
        eq(projects.id, projectId),
        project.driveFolderId === null
          ? isNull(projects.driveFolderId)
          : eq(projects.driveFolderId, project.driveFolderId),
      ),
    )
    .returning({ id: projects.id });

  if (won) return folderId;

  const [now] = await db
    .select({ driveFolderId: projects.driveFolderId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  return settleFolderRace(folderId, now?.driveFolderId ?? null);
}

/**
 * Put every attachment where its row now says it belongs.
 *
 * `reconcileBoxFiles` for the other table that owns files. A box document and
 * an attachment drift for the same reason — something moved in the app and the
 * file did not — and neither had anything that would notice afterwards.
 *
 * **`attachmentFolder` is asked, rather than the answer being worked out
 * again here.** Restating "where does this file go" would be a second
 * definition of the rule that already exists, and the two would disagree the
 * first time either changed — the trap this codebase has been caught by more
 * than once. Memoised per parent, because a project with six files asks the
 * same question six times and the answer cannot differ.
 *
 * One listing per destination rather than a read per file, exactly as the box
 * sweep does it: a file missing from the contents of the folder it should be in
 * is precisely the set that needs moving.
 */
export async function reconcileAttachmentFiles(limit = 50): Promise<number> {
  const rows = await db
    .select({
      id: attachments.id,
      name: attachments.name,
      driveFileId: attachments.driveFileId,
      parentType: attachments.parentType,
      parentId: attachments.parentId,
    })
    .from(attachments)
    .where(isNotNull(attachments.driveFileId));

  /** Where each distinct parent's files belong, asked once per parent. */
  const wanted = new Map<string, string | null>();
  /** What each destination folder holds, listed once per folder. */
  const contents = new Map<string, Set<string>>();
  let moved = 0;

  for (const row of rows) {
    if (moved >= limit) break;
    if (!row.driveFileId) continue;

    /*
     * A gallery's members are already inside the gallery's own folder, and that
     * folder is itself an attachment this loop will place. Asking where a
     * picture goes would send it to the project instead, emptying every gallery
     * in the app — so they are left to travel with the folder that holds them.
     */
    if (row.parentType === 'gallery') continue;

    const key = `${row.parentType}:${row.parentId}`;
    if (!wanted.has(key)) {
      try {
        wanted.set(key, await attachmentFolder(row.parentType, row.parentId));
      } catch (error) {
        console.error('could not work out where a file belongs', row.name, error);
        wanted.set(key, null);
      }
    }

    const destination = wanted.get(key);
    if (!destination) continue;

    let inFolder = contents.get(destination);
    if (!inFolder) {
      try {
        inFolder = await folderChildIds(destination);
      } catch (error) {
        console.error('could not list a destination folder', destination, error);
        contents.set(destination, new Set());
        continue;
      }
      contents.set(destination, inFolder);
    }

    if (inFolder.has(row.driveFileId)) continue;

    try {
      await moveFile(row.driveFileId, destination);
      inFolder.add(row.driveFileId);
      moved += 1;
    } catch (error) {
      // Logged, never swallowed: a move that can never succeed would otherwise
      // fail silently on every tick with nothing to show but a folder that
      // never catches up.
      console.error('could not move an attachment', row.name, error);
    }
  }

  return moved;
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
        /*
         * The brackets are load-bearing.
         *
         * Without them this fragment goes into the enclosing `and()` as a bare
         * `or`, and SQL binds `and` tighter — so the whole predicate collapsed
         * to "(everything else AND not a Google type) OR is a folder", and
         * *every* gallery folder matched whether or not its name disagreed with
         * Drive. The symptom was a sweep that reported one rename on every
         * tick, for ever, renaming one folder to the name it already had: a
         * wasted Drive write a day, and a count in which a real rename was
         * indistinguishable from the noise.
         */
        sql`(coalesce(${attachments.mimeType}, '') not like 'application/vnd.google-apps.%'
             or ${attachments.mimeType} = 'application/vnd.google-apps.folder')`,
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
