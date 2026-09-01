import 'server-only';
import { purgeGalleryPictures } from './attachments';

import { attachments, boxItems, boxes, db } from '@gtd/db';
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { hasSyncScopes } from '@/lib/auth/google';
import { getGrant } from '@/lib/auth/token';
import { canClassify } from '@/lib/box/classify';
import { enqueueBoxJob } from '@/lib/box/queue';
import { FORMAT_BY_MIME } from '@/lib/text-formats';
import {
  createGoogleFile,
  createResumableSession,
  copyFile,
  createTextFile,
  ensureFolder,
  ensureLabel,
  getFile,
  getLabel,
  moveFile,
  renameLabel,
  renameFile,
  renameFolder,
  trashFile,
} from './client';
import { ROOT, driveNameFor, safeName } from './sync';

export { driveNameFor };

export class BoxError extends Error {}

/** `GTD/Box/<name>` — beside Projects and Inbox, under the one root. */
const BOX_CONTAINER = 'Box';

async function requireDrive() {
  const grant = await getGrant();
  if (!grant?.refreshToken || !hasSyncScopes(grant.scope)) {
    throw new BoxError('Drive is not connected. Connect it on the Google page first.');
  }
}

/**
 * The box's Drive folder, made if it doesn't exist and renamed if the box has
 * been renamed since.
 *
 * Called from the ingest path rather than from the rename action, which is
 * what keeps the "never call Google inside a request" rule intact: renaming a
 * box writes one row, and the next document to arrive reconciles Drive. The
 * ingest request is already a Google call by definition — it is carrying a
 * file — so one more costs nothing there and blocks no one.
 */
/**
 * Put a box document's file in the folder its box now owns.
 *
 * The mirror of `moveAttachmentFile`, for the other table that owns a Drive
 * file — and needed for the same reason. Filing a capture into a box hands the
 * `drive_file_id` straight to the `box_items` row and deletes the attachment,
 * so the row lands in the box while the bytes stay in `GTD/Inbox`; moving a
 * document between boxes did the same thing one folder over. Either way the
 * app said one thing and Drive said another, which is the state this app is
 * built to never be in.
 *
 * `ensureBoxFolder` is the destination, so the box's folder is created the
 * first time a document wants one — the same on-demand rule projects follow —
 * and a folder deleted in Drive is remade rather than failing the move.
 *
 * A note, a link or a place has no file at all, and neither does a document
 * whose upload never finished. Both return without a Google call.
 */
/**
 * Trash a deleted box's Drive folder — the same tidy-up a deleted project gets.
 *
 * Only ever called once its documents have been moved out and Drive has
 * confirmed it, because they are *inside* this folder until then and trashing
 * it would take them along. That is the opposite of `trashProjectFolder`, whose
 * files are individually trashed on purpose.
 *
 * Trashed, never deleted, like everything this app removes.
 */
export async function trashBoxFolder(folderId: string | null): Promise<void> {
  if (!folderId) return;

  try {
    await trashFile(folderId);
  } catch {
    // Deleting the box is what was asked for, and it has happened.
  }
}

/**
 * A second, independent copy of a document in another box.
 *
 * The bytes are copied in Drive rather than shared, because two entries
 * pointing at one file would mean throwing either away trashed the other's
 * document — and a copy exists precisely so the two can be treated separately.
 *
 * Returns the new Drive id, or null when there was nothing to copy: a note, a
 * link or a place has no file, and copying one is only a row.
 */
/** A gallery's `drive_file_id` is a folder, and Drive will not copy one. */
const GALLERY_MIME = 'application/vnd.google-apps.folder';

export type CopiedFile = {
  driveFileId: string | null;
  /**
   * For a gallery: each picture, already copied into the new folder, ready to
   * be given rows of its own. Empty for everything else.
   */
  pictures: { sourceId: string; driveFileId: string; name: string }[];
};

export async function copyBoxItemFile(
  item: {
    id: string;
    driveFileId: string | null;
    name: string;
    mimeType: string | null;
  },
  toBoxId: string,
): Promise<CopiedFile> {
  if (!item.driveFileId) return { driveFileId: null, pictures: [] };

  const into = await ensureBoxFolder(toBoxId);

  /*
   * A gallery is a *folder*, and Drive's copy does not copy folders — it
   * refuses outright. So a gallery is rebuilt: a new folder, then each picture
   * copied into it. Without this, copying a gallery would leave an entry
   * pointing at nothing, which is the sort of half-success that is worse than a
   * refusal.
   *
   * The pictures are handed back rather than written here, because they need
   * `attachments` rows parented on the *new* gallery — and this module has no
   * business knowing what a copy of a box entry looks like.
   */
  if (item.mimeType === GALLERY_MIME) {
    const folder = await ensureFolder(safeName(item.name) || 'Gallery', into);

    /*
     * Its pictures are `attachments` parented on the gallery's own id — that is
     * what lets a gallery reuse the whole file path — so they are found by that
     * id. `parent_id` is a plain uuid addressing several tables, so this cannot
     * be a join.
     */
    const rows = await db
      .select({
        id: attachments.id,
        driveFileId: attachments.driveFileId,
        name: attachments.name,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.parentType, 'gallery'),
          eq(attachments.parentId, item.id),
          isNotNull(attachments.driveFileId),
        ),
      );

    const pictures: CopiedFile['pictures'] = [];

    for (const picture of rows) {
      if (!picture.driveFileId) continue;
      pictures.push({
        sourceId: picture.id,
        driveFileId: await copyFile(picture.driveFileId, picture.name, folder),
        name: picture.name,
      });
    }

    return { driveFileId: folder, pictures };
  }

  return {
    driveFileId: await copyFile(item.driveFileId, item.name, into),
    pictures: [],
  };
}

export async function moveBoxItemFile(itemId: string): Promise<void> {
  const [row] = await db
    .select({ driveFileId: boxItems.driveFileId, boxId: boxItems.boxId })
    .from(boxItems)
    .where(eq(boxItems.id, itemId))
    .limit(1);

  if (!row?.driveFileId) return;

  /*
   * A gallery's `drive_file_id` is a *folder*, and moving it takes its
   * pictures with it — which is what should happen, since they are what the
   * gallery is. Nothing special to do.
   */
  await moveFile(row.driveFileId, await ensureBoxFolder(row.boxId));
}

export async function ensureBoxFolder(boxId: string): Promise<string> {
  const [box] = await db
    .select({
      name: boxes.name,
      driveFolderId: boxes.driveFolderId,
    })
    .from(boxes)
    .where(eq(boxes.id, boxId))
    .limit(1);

  if (!box) throw new BoxError('That box no longer exists.');

  const wanted = safeName(box.name) || 'Box';

  if (box.driveFolderId) {
    const existing = await getFile(box.driveFolderId);

    // Deleted in Drive: make a new one rather than failing the upload. The
    // documents already filed keep their own ids and are unaffected — this
    // folder is only where the *next* one lands.
    if (existing && !existing.trashed) {
      if (existing.name !== wanted) await renameFolder(box.driveFolderId, wanted);
      return box.driveFolderId;
    }
  }

  const root = await ensureFolder(ROOT);
  const container = await ensureFolder(BOX_CONTAINER, root);
  const folderId = await ensureFolder(wanted, container);

  await db
    .update(boxes)
    .set({ driveFolderId: folderId, updatedAt: new Date() })
    .where(eq(boxes.id, boxId));

  return folderId;
}

/**
 * Step one of ingest: open a Drive session pointed at the box's folder.
 *
 * The same three-step shape as an attachment upload — session, PUT, complete —
 * because it solves the same problem: the bytes must not travel through a
 * serverless function with a 4.5 MB body cap. Here the thing holding the bytes
 * is an Apps Script rather than a browser, which is why no origin is passed.
 */
export async function startBoxUpload(
  boxId: string,
  name: string,
  mimeType: string,
  /**
   * The origin that will send the bytes, or null for a server-to-server
   * caller like the Apps Script.
   *
   * Drive binds the session to whichever origin opened it and enforces that
   * with CORS — so a browser PUT to a session opened with no origin is
   * refused, while a script's PUT carrying no Origin at all is fine whatever
   * the session was opened with. Both are real callers here: the script feeds
   * the boxes, and the app itself needs to be able to put a document straight
   * in. Passing null for a browser cost me a "Failed to fetch" that looked
   * exactly like a bug in the upload and was in fact this.
   */
  origin: string | null,
): Promise<string> {
  await requireDrive();

  const folderId = await ensureBoxFolder(boxId);

  return createResumableSession(
    safeName(name) || 'Document',
    mimeType || 'application/octet-stream',
    folderId,
    origin,
  );
}

/**
 * Step two: record the document and queue it to be read.
 *
 * Name, type and size are read back from Drive rather than trusted from the
 * request, exactly as `completeUpload` does — and `drive.file` does the
 * authorising, since an id for a file this app did not create comes back null.
 *
 * `capturedAt` is the *original* file's date where the caller knows it, so
 * importing a backlog of scans files each one under the day it arrived instead
 * of burying a year of documents under today.
 */
/**
 * What a message brought with it, when the thing being filed is an email.
 *
 * The body is already in Drive by the time this is called — it went up as
 * HTML like any other file. These are the facts that are *not* in the file:
 * who sent it, when they sent it, and where the original still lives. A
 * rendered message has all three somewhere in its markup and none of them
 * reliably, which is why the bridge reads them from Gmail and passes them.
 */
/** The message id out of a Gmail permalink, which ends in exactly that. */
export function messageIdFrom(permalink: string | null | undefined): string | null {
  const tail = (permalink ?? '').split('/').pop() ?? '';
  return /^[A-Za-z0-9_-]{8,}$/.test(tail) ? tail : null;
}

export type EmailFacts = {
  subject: string;
  from: string;
  /** ISO. The sent date, which is also the day it should file under. */
  date?: string;
  /** Back to the real thing, which is where you reply from. */
  permalink?: string;
  /**
   * Gmail's own message id, stored so the bridge can ask whether this has been
   * filed before rather than removing the label to remember.
   */
  messageId?: string;
  /** Gmail’s own one-line preview, good enough to be the summary. */
  snippet?: string;
  /** The body as text, so search can see inside it without a model. */
  text?: string;
};

export async function completeBoxUpload(
  boxId: string,
  driveFileId: string,
  capturedAt?: Date,
  email?: EmailFacts,
  /**
   * The date printed on the document, when the caller already knows it.
   *
   * Normally this is something the reading works out. A backlog being brought
   * across is the exception: the files were named with their date years ago,
   * and that is better evidence than anything a model will infer — and it is
   * there *before* the reading, so the feed is right the moment it arrives
   * rather than after forty model calls.
   *
   * A reading may still correct it, which is the right precedence: the page
   * itself beats a filename.
   */
  docDate?: string,
): Promise<{ id: string; name: string }> {
  const file = await getFile(driveFileId);
  if (!file) throw new BoxError('That upload could not be found in Drive.');

  const mimeType = file.mimeType ?? 'application/octet-stream';
  const size = file.size ? Number(file.size) : null;

  // Ingest is retried by hand and by script, so the same file arriving twice
  // is a real possibility. The Drive id is the identity: a second complete for
  // one already recorded returns the existing row rather than a duplicate.
  const [existing] = await db
    .select({ id: boxItems.id, name: boxItems.name })
    .from(boxItems)
    .where(eq(boxItems.driveFileId, file.id))
    .limit(1);

  if (existing) return existing;

  /**
   * A voice note is filed, not read.
   *
   * There is no speech provider wired up, so queueing audio would manufacture
   * a failure for a file that is perfectly fine — the same call the enrichment
   * queue makes. It goes in as `ready` with its filename, which is honest:
   * nothing is pending, there is simply nothing to read. Play it in the feed.
   */
  const readable = canClassify(mimeType);

  /**
   * An email is filed read, not queued.
   *
   * Everything a document is queued to discover, a message already states:
   * the subject is a better title than a model would write, the sender and
   * the date are facts rather than readings, and Gmail’s own snippet is a
   * serviceable summary. Paying to have a mailbox summarised, message by
   * message, would be the app spending money to learn what the message
   * already said.
   *
   * Tags are the one thing it misses, and they are one press of "Read it
   * again" away on the pane — which is the right shape, because whether an
   * email is worth tagging is a judgement about that email.
   */
  const queue = readable && !email;

  const [row] = await db
    .insert(boxItems)
    .values({
      boxId,
      kind: email ? 'email' : 'document',
      driveFileId: file.id,
      name: file.name,
      mimeType,
      sizeBytes: Number.isFinite(size) ? size : null,
      status: queue ? 'pending' : 'ready',
      ...(capturedAt ? { capturedAt } : {}),
      // Only when given. The reading fills it otherwise, and an email's own
      // branch below sets it from the sent date.
      ...(docDate ? { docDate } : {}),
      ...(email
        ? {
            title: email.subject || file.name,
            description: emailSummary(email),
            url: email.permalink ?? null,
            /*
             * Falls back to the tail of the permalink, which is where the id
             * has always been — every message filed before this column existed
             * is therefore still recognisable without a backfill.
             */
            sourceId: email.messageId ?? messageIdFrom(email.permalink),
            docDate: email.date ? email.date.slice(0, 10) : null,
            text: email.text ?? null,
            /*
             * The vector is generated from `search_text`, never from
             * `text` — the rule this table carries a warning about. An
             * email whose body was stored and not indexed would be the one
             * kind of entry search could not see into, which is the
             * opposite of the point of filing it.
             */
            searchText: [emailSummary(email), email.text ?? ""]
              .filter(Boolean)
              .join("\n")
              .slice(0, 100_000) || null,
          }
        : {}),
    })
    .returning({ id: boxItems.id, name: boxItems.name });

  if (queue) await enqueueBoxJob(row.id);

  return row;
}

/**
 * The line under an email’s subject in the feed.
 *
 * Who it is from first, because in a list of messages that is what tells
 * them apart — twenty from the same sender is a different problem from
 * twenty from twenty people. Gmail’s snippet follows when there is one; it
 * is the first line of the body with the quoting stripped, which is exactly
 * what a summary of an email should be and costs nothing to obtain.
 */
function emailSummary(email: EmailFacts): string {
  return [email.from, email.snippet].filter(Boolean).join(' — ').slice(0, 500);
}

/**
 * Make an empty document straight into a box.
 *
 * A box is where you keep things, so almost everything in one arrives from
 * somewhere else — a scanner, a share sheet, a paste. This is the exception
 * that turned out to matter: a page of notes, a spreadsheet of figures, a
 * letter you are about to write. Filing it *first* and writing it afterwards
 * is the order a box wants, because the alternative is composing it somewhere
 * else and remembering to put it here.
 *
 * Written as `ready` with no job queued, which is the same call
 * `createGoogleDocument` makes on the other side of the app: an empty document
 * has nothing to read, and paying a model to confirm that is a strange way to
 * spend money. It gets read the first time anything asks for it to be, by
 * which point there will be something in it.
 */
export async function createBoxDocument(
  boxId: string,
  mimeType: string,
  name: string,
): Promise<{ id: string; name: string; driveFileId: string; mimeType: string }> {
  await requireDrive();

  const format = FORMAT_BY_MIME[mimeType];

  // The extension is what `formatOf` reads first, so a `.tex` without one
  // opens as an unrecognised file in the very pane that just created it.
  const base = safeName(name) || 'Untitled';
  const title = format ? `${base}.${format.extension}` : base;

  const folderId = await ensureBoxFolder(boxId);

  const created = format
    ? await createTextFile(title, format.mime, folderId, format.starter)
    : await createGoogleFile(title, mimeType, folderId);

  const [row] = await db
    .insert(boxItems)
    .values({
      boxId,
      kind: 'document',
      driveFileId: created.id,
      // `name` *is* the name Drive holds — that is the whole basis on which
      // `renameBoxFiles` decides a title has drifted from the file. Setting it
      // to what Drive just told us is what keeps the sweep quiet until the
      // document is actually retitled.
      name: created.name ?? title,
      mimeType: format ? format.mime : mimeType,
      sizeBytes: format ? new TextEncoder().encode(format.starter).length : null,
      status: 'ready',
      title: base,
    })
    .returning({ id: boxItems.id, name: boxItems.name });

  return {
    id: row.id,
    name: row.name ?? title,
    driveFileId: created.id,
    mimeType: format ? format.mime : mimeType,
  };
}

/**
 * Remove a document, and send its file to Drive's bin.
 *
 * A box is meant to keep things, so this is not the main path — but a blank
 * page, a duplicate scan or a photograph of the desk are all real, and a box
 * you cannot take rubbish out of stops being one you trust. Trashed rather
 * than deleted, and only ever a file this app uploaded: Drive holds it for 30
 * days, which is the difference between a mistake and a loss.
 */
export async function deleteBoxItem(itemId: string): Promise<void> {
  const [row] = await db
    .delete(boxItems)
    .where(eq(boxItems.id, itemId))
    .returning({ driveFileId: boxItems.driveFileId, kind: boxItems.kind });

  if (!row) return;

  /*
   * A gallery takes its pictures with it, exactly as it does on the attachment
   * side. Its members are attachments parented on this row's id, and
   * `parent_id` carries no foreign key, so nothing cascades — without this,
   * throwing away a gallery would leave its photographs as rows pointing at an
   * id that names nothing.
   */
  if (row.kind === 'gallery') await purgeGalleryPictures(itemId);

  if (!row.driveFileId) return;

  try {
    await trashFile(row.driveFileId);
  } catch {
    // The row is already gone and the file is recoverable from Drive's bin.
    // Failing here would leave you unable to tidy the box because of a
    // problem at Google's end.
  }
}

/**
 * Throw away what has reached the end of its life.
 *
 * Some documents have a known shelf life the moment they arrive — the receipt
 * proving a card bill was paid is worth three months and nothing after — and
 * deciding that then is far easier than reviewing a thousand of them later.
 * Nothing expires unless you say so; the column is null by default, which is
 * what a box is for.
 *
 * Through `deleteBoxItem`, so it is exactly the same operation as pressing
 * "throw away" by hand: the row goes and the Drive file is *trashed*, never
 * deleted. That matters more here than anywhere else in the app, because this
 * is the one deletion nobody is watching — and Drive keeps a binned file for
 * thirty days, so a date set wrongly in March is still recoverable in April.
 *
 * `<=` today rather than `<`: a document set to expire on a date should be
 * gone on that date, not the day after.
 */
export async function expireBoxItems(limit = 50): Promise<number> {
  const due = await db
    .select({ id: boxItems.id })
    .from(boxItems)
    .where(
      and(
        isNotNull(boxItems.expiresAt),
        lte(boxItems.expiresAt, new Date().toISOString().slice(0, 10)),
      ),
    )
    .limit(limit);

  for (const row of due) await deleteBoxItem(row.id);

  return due.length;
}

/**
 * Make Drive call a document what the box calls it.
 *
 * A scan arrives named by whatever produced it — a camera's timestamp, a
 * scanner's counter — and is then read and given a real title. Until now that
 * title lived only here, so the box knew the document as "MFG Marlborough Road
 * Fuel Receipt" and Drive still knew it as an upload filename. Anyone opening
 * the Drive folder saw none of the work.
 *
 * This is one-way sync doing exactly what it says, not an exception to it: the
 * app owns a document's title and pushes it out. It is the mirror image of
 * `refreshGoogleNames`, which pulls in the names of Docs-editor files — those
 * are renamed by typing in a title bar and the app offers no other way, so
 * Google owns them. Both rules come from the same question, and the answers
 * differ because the answer to "who renames this" differs. Docs-native files
 * are excluded here for that reason, not overlooked.
 *
 * Drift is found without asking Google anything. `box_items.name` is by
 * definition the name Drive holds, so a title that no longer agrees with it is
 * the whole test — no per-file read, and nothing to do on a tick where nothing
 * has been renamed.
 *
 * A file whose rename fails is skipped rather than failing the sweep. The
 * usual cause is a document removed from Drive by hand, which is not a reason
 * to stop renaming the other forty.
 */
export async function renameBoxFiles(limit = 50): Promise<number> {
  const grant = await getGrant();
  if (!grant?.refreshToken || !hasSyncScopes(grant.scope)) return 0;

  const rows = await db
    .select({
      id: boxItems.id,
      name: boxItems.name,
      title: boxItems.title,
      docDate: boxItems.docDate,
      driveFileId: boxItems.driveFileId,
    })
    .from(boxItems)
    .where(
      and(
        eq(boxItems.status, 'ready'),
        isNotNull(boxItems.driveFileId),
        isNotNull(boxItems.title),
        /*
         * Docs-editor files are excluded because Google owns their names — you
         * rename one by typing in its title bar. A *folder* is not that: a
         * gallery's folder is named by this app and by nothing else, so it must
         * come through or a renamed gallery keeps its old folder name for ever.
         */
        sql`coalesce(${boxItems.mimeType}, '') not like 'application/vnd.google-apps.%'
            or ${boxItems.mimeType} = 'application/vnd.google-apps.folder'`,
      ),
    );

  /*
   * Every candidate is fetched and the *renames* are what is capped, which
   * is the other way round from how this started.
   *
   * `.limit(50)` on the query bounded the wrong thing: it took the first
   * fifty rows with a title and a file, in whatever order Postgres felt
   * like, and most of those are already named correctly. Past fifty
   * documents the sweep could spend its whole budget confirming names that
   * were fine and never reach the one that had drifted — quietly, and more
   * so the fuller the box got.
   *
   * The cost is five columns over every document in every box, once a tick.
   * The alternative is expressing `driveNameFor` a second time in SQL, and
   * two definitions of one name is the trap this file already warns about.
   */
  let renamed = 0;

  for (const row of rows) {
    const wanted = driveNameFor(row.title!, row.name, row.docDate);
    if (!wanted || wanted === row.name) continue;
    if (renamed >= limit) break;

    try {
      await renameFile(row.driveFileId!, wanted);
    } catch (error) {
      /*
       * Reported, not swallowed.
       *
       * This was a bare `continue`, so a rename that could never succeed —
       * a withdrawn grant, a file trashed in Drive — failed silently on
       * every tick for ever, and the only symptom was a folder whose names
       * never caught up. A log line is not much, but it is the difference
       * between a thing you can find and a thing you cannot.
       */
      console.error('rename failed for box item', row.id, error);
      continue;
    }

    // Written after Drive agrees, never before: this column is the record of
    // what Drive holds, and setting it first would mean a failed rename left
    // the app certain of a name that was never applied — and never trying
    // again, because the drift it looks for would be gone.
    await db.update(boxItems).set({ name: wanted }).where(eq(boxItems.id, row.id));
    renamed += 1;
  }

  return renamed;
}

/**
 * The Gmail label that files a message into this box.
 *
 * `GTD/Box/<name>`, which sits with the labels the app already makes rather
 * than at the top of a label list. Put it on a message in Gmail and the bridge
 * files that message here on its next run, then archives the thread — so a
 * message you have filed leaves your inbox, which is most of the point.
 *
 * **Made on request, not with the box.** The rest of the app creates
 * containers when there is something to put in them, and a label has no such
 * moment: it must exist *before* you can apply it, and the wanting is the
 * pressing. So this is a control somebody uses once per box.
 *
 * Renamed rather than remade when the box's name changes, and only for a box
 * that already has one — the same reconcile-on-the-way-past the Drive folder
 * gets, so a rename stays one row written and no Google call in the request
 * that wrote it.
 */
/**
 * Carry a box's new name out to the containers it already has.
 *
 * Renaming a box wrote one row and nothing else, on the reasoning that
 * `ensureBoxFolder` reconciles Drive the next time a document is filed there.
 * That is fine for Drive and was quietly wrong for Gmail, because the label is
 * not on any path that runs again: `ensureBoxLabel` is called from a button and
 * nowhere else, so a renamed box kept a label named after what it used to be —
 * for ever, if you never pressed that button again.
 *
 * **And a stale label misfiles mail rather than merely looking untidy.** The
 * bridge reads the box out of the *label's* name and the ingest route matches
 * it against `boxes.name`; when nothing matches it falls back to the default
 * box. So after a rename, every message labelled for that box was quietly
 * landing in the Feed — not lost, but filed somewhere nobody chose, with
 * nothing anywhere saying so.
 *
 * Renames only, and only what exists. Creating either container here would
 * break the rule both are built on — a folder is made when there is a file to
 * put in it, a label when you ask for one — and renaming a box is neither of
 * those moments.
 */
export async function renameBoxContainers(boxId: string): Promise<void> {
  const [box] = await db
    .select({
      name: boxes.name,
      driveFolderId: boxes.driveFolderId,
      gmailLabelId: boxes.gmailLabelId,
    })
    .from(boxes)
    .where(eq(boxes.id, boxId))
    .limit(1);

  if (!box) return;

  const folderName = safeName(box.name) || 'Box';

  if (box.driveFolderId) {
    try {
      const existing = await getFile(box.driveFolderId);

      // A folder deleted or binned in Drive is left alone: `ensureBoxFolder`
      // makes a fresh one when there is next something to put in it, and
      // reviving this one would resurrect whatever else is in the bin with it.
      if (existing && !existing.trashed && existing.name !== folderName) {
        await renameFolder(box.driveFolderId, folderName);
      }
    } catch {
      // The next ingest reconciles it. A rename in the app must not fail
      // because of something at Google's end.
    }
  }

  if (box.gmailLabelId) {
    const wanted = `${ROOT}/Box/${folderName}`;

    try {
      const existing = await getLabel(box.gmailLabelId);

      if (existing && existing.name !== wanted) {
        // Gmail "moves" a label by renaming its path, and the parents have to
        // exist first — the same trap `ensureBoxLabel` documents.
        await ensureLabel(`${ROOT}/Box`);
        await renameLabel(box.gmailLabelId, wanted);
      }
    } catch {
      // Pressing "Make a Gmail label" on the box reconciles it by hand.
    }
  }
}

export async function ensureBoxLabel(boxId: string): Promise<string> {
  const [box] = await db
    .select({ name: boxes.name, gmailLabelId: boxes.gmailLabelId })
    .from(boxes)
    .where(eq(boxes.id, boxId))
    .limit(1);

  if (!box) throw new BoxError('That box no longer exists.');

  const wanted = `${ROOT}/Box/${safeName(box.name) || 'Box'}`;

  if (box.gmailLabelId) {
    const existing = await getLabel(box.gmailLabelId);

    if (existing) {
      // Gmail "moves" a label by renaming its path, and the parents have to
      // exist first or the rename produces a flat label literally called
      // "GTD/Box/Thing" instead of a nested one.
      if (existing.name !== wanted) {
        await ensureLabel(`${ROOT}/Box`);
        await renameLabel(box.gmailLabelId, wanted);
      }

      return box.gmailLabelId;
    }
    // Deleted in Gmail. Make a new one rather than failing: the messages
    // already filed are unaffected, and this only decides where the next one
    // is labelled from.
  }

  const labelId = await ensureLabel(wanted);

  await db.update(boxes).set({ gmailLabelId: labelId }).where(eq(boxes.id, boxId));

  return labelId;
}

/** What the label for this box is called, whether or not it has been made. */
export function boxLabelName(name: string): string {
  return `${ROOT}/Box/${safeName(name) || 'Box'}`;
}
