/**
 * BIG BOX FEED — the bridge between Drive's scanner and the GTD app.
 *
 * Paste this into a standalone Apps Script project, set the two script
 * properties below, map your scan folders to boxes, and add a time-driven
 * trigger on `processFeedFolders`.
 *
 * WHAT IT DOES
 * Watches the folders you scan into. For each new file it asks the app to open
 * a Drive upload session, PUTs the bytes straight to Google, and tells the app
 * where they landed. The app then reads the document, names it, summarises it,
 * dates it and tags it — all of which used to live in this script and no
 * longer does.
 *
 * WHY IT STILL EXISTS
 * The app holds Drive's `drive.file` scope, which grants access only to files
 * the app itself created. It therefore cannot see anything the Drive scanner
 * saves — and the scope that could, `drive.readonly`, can read every file in
 * the account and drags the app into Google's verification. Re-uploading each
 * scan through the app's own credentials makes the document app-created, so
 * the narrow scope keeps working and you keep the Drive scanner, whose
 * crop-and-deshadow is the thing that makes a photographed letter readable.
 *
 * This script needs no API key of its own any more. The old version called
 * OpenAI from here; that work now happens in the app, where the tag vocabulary
 * lives and can be edited.
 */

// --- SETUP ------------------------------------------------------------------
// Project Settings > Script Properties, add:
//   APP_ORIGIN         https://your-app.vercel.app   (no trailing slash)
//   BOX_INGEST_SECRET  the same value as the app's BOX_INGEST_SECRET
// Keep the secret out of this file: anything pasted here ends up in the script's
// revision history, and in any chat you paste the file into.

/**
 * Which folder feeds what.
 *
 * `box` is matched on the box's name in the app, case-insensitively. A name the
 * app doesn't know falls back to the default box rather than failing — a
 * document filed in the wrong box is fixable, a document rejected at the door
 * is gone.
 *
 * `inbox: true` is the other destination, and it is a different *kind* of
 * answer rather than another box. A box is for keeping; the inbox is a queue to
 * be emptied. Half of what goes through a scanner is not a thing to file but a
 * thing to do — a letter from the council is a to-do with a piece of paper
 * attached — and filing one in a box means clarifying it back out later, which
 * is the model upside down. Scan into a folder wired this way instead and it
 * arrives as a capture with its file already on it, waiting to be turned into
 * an action, a project or a list item.
 *
 *   { folderId: 'PASTE_THE_FOLDER_ID', inbox: true },
 *
 * The id is the last part of the folder's URL in Drive. Nothing is classified
 * and nothing is read: what a capture *is* gets decided by you, at clarify
 * time, which is the whole point of it landing there.
 */
const FOLDERS = [
  { folderId: '1OQ1JoO0BPY0ub6oRhpXKMhyzT98ltlrA', box: 'Feed' },
  { folderId: '1o404XcD1kKjioeNxBkHpeQV18OfKlX1E', box: 'Shopping Receipts' },
  { folderId: '1UZXjx3dXPUsmWyYO4kapzuyIf_sPYWfh', box: 'Fuel Receipts' },
];

/**
 * What happens to the original once the app has its copy.
 *
 * 'move'  — into a "Filed" subfolder of the same scan folder. Nothing is ever
 *           deleted, at the cost of keeping two copies in Drive.
 * 'trash' — to Drive's bin, which holds it for 30 days. The app's copy becomes
 *           the only one after that.
 *
 * 'move' is the default because it cannot lose anything. Switch to 'trash' once
 * you have watched it work for a week and trust it.
 */
const AFTER_INGEST = 'move';

/** Apps Script tops out at 50 MB per request; Drive scans are far below this. */
const MAX_BYTES = 45 * 1024 * 1024;

/**
 * Ask the app to read each document as it is filed, rather than leaving it for
 * the cron.
 *
 * The reading itself stays in the app — the tag vocabulary, the prompt and the
 * validation live where they can be edited, and a second copy here would drift
 * the first time a tag is added. This only asks.
 *
 * Bounded by time, not by count. A trigger gets six minutes total and a scan
 * takes the better part of ten seconds to read, so a backlog would be cut off
 * mid-run. Past the budget, files are still filed and simply left queued —
 * the cron takes them, or "Read the N waiting" does.
 */
const READ_ON_INGEST = true;
const READ_BUDGET_MS = 3 * 60 * 1000;

// --- MAIN -------------------------------------------------------------------

/**
 * What `processFeedFolders` *would* do, writing nothing.
 *
 * The reason this exists is that bringing a backlog across is a one-way move
 * with an expensive mistake in it: get the dates wrong and a year of documents
 * files under today, which is not something you fix by hand at two hundred
 * rows. So the dates are shown first, in a list you read, and only then does
 * anything happen.
 *
 * It touches nothing — no upload, no archive move, no request to the app. The
 * only thing it needs the app for is nothing at all, which is also why it is
 * safe to press at any time.
 */
function previewFeedFolders() {
  var total = 0;
  var fromName = 0;

  FOLDERS.forEach(function (config) {
    var folder;
    try {
      folder = DriveApp.getFolderById(config.folderId);
    } catch (e) {
      Logger.log('Cannot open folder ' + config.folderId + ': ' + e);
      return;
    }

    Logger.log(
      '— ' +
        folder.getName() +
        ' → ' +
        (config.inbox ? 'the inbox' : 'box "' + config.box + '"') +
        ' —',
    );

    const files = folder.getFiles();

    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName();
      const dated = datedFrom(name, file);
      const named = dated.docDate !== null;

      total++;
      if (named) fromName++;

      /*
       * Everything the app would be told, so the shape of a description can
       * be checked before two hundred of them are written — and so it is
       * plain which files cost a model call and which do not.
       */
      Logger.log(
        '  ' + name +
        '\n      arrives  ' + dated.capturedAt.slice(0, 10) +
        (named ? '  (from the name)' : '  (from Drive — no date in the name)') +
        '\n      title    ' + (dated.title || '(none — the AI will write one)') +
        '\n      summary  ' + (dated.description
          ? '“' + dated.description.slice(0, 90) + (dated.description.length > 90 ? '…”' : '”')
          : '(nothing in the file’s Drive description)') +
        '\n      reading  ' + (dated.title ? 'skipped — nothing to pay for' : 'yes, one model call'),
      );
    }
  });

  Logger.log(
    total + ' file(s): ' + fromName + ' dated from the name and filed without a ' +
    'model call, ' + (total - fromName) + ' dated from Drive and read as usual.',
  );
  Logger.log('Nothing was written. Run “File scans” when this looks right.');
}

function processFeedFolders() {
  const startedAt = Date.now();
  const props = PropertiesService.getScriptProperties();
  const origin = (props.getProperty('APP_ORIGIN') || '').replace(/\/+$/, '');
  const secret = props.getProperty('BOX_INGEST_SECRET');

  if (!origin || !secret) {
    Logger.log('Set APP_ORIGIN and BOX_INGEST_SECRET in Script Properties first.');
    return;
  }

  FOLDERS.forEach(function (config) {
    var folder;
    try {
      folder = DriveApp.getFolderById(config.folderId);
    } catch (e) {
      Logger.log('Cannot open folder ' + config.folderId + ': ' + e);
      return;
    }

    Logger.log(
      'Scanning ' +
        folder.getName() +
        ' -> ' +
        (config.inbox ? 'the inbox' : 'box "' + config.box + '"'),
    );

    const files = folder.getFiles();
    var sent = 0;

    while (files.hasNext()) {
      const file = files.next();

      try {
        if (ingestFile(origin, secret, config, file, startedAt)) sent++;
      } catch (e) {
        // Left where it is, so the next run tries again. A failure here is
        // usually the app being redeployed mid-run.
        Logger.log('Failed on ' + file.getName() + ': ' + e);
      }
    }

    Logger.log('  ' + sent + ' filed');
  });
}

/**
 * What date a file should be filed under, and why the filename wins.
 *
 * `getDateCreated` is the ordinary answer and is right for a scan that has just
 * appeared. It is *wrong* for a backlog being brought across: a file **copied**
 * into the watched folder is created today, so a folder holding three years of
 * correspondence would file every document under this morning — one day
 * containing everything, which is the single arrangement that makes a feed
 * useless. Moving a file preserves its date and copying does not, and nobody
 * should have to know that to get their history across intact.
 *
 * So a leading `YYYY-MM-DD` in the name wins. It is there because somebody put
 * it there, which makes it better evidence than a filesystem timestamp — and it
 * is the convention this app's own Drive names already follow, so a document
 * that has been through here once carries its date home.
 *
 * Used for **both** dates: the day it arrived and the day it was written. For a
 * backlog those are usually the same, and being roughly right about the printed
 * date immediately beats being empty until a model reads it. A reading may then
 * correct the printed date, which is the right precedence — the page beats the
 * filename.
 */
function datedFrom(name, file) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(name || '');

  if (match) {
    const day = match[1] + '-' + match[2] + '-' + match[3];

    /*
     * A name of this shape was written by something that had already read the
     * document — this app, or the process before it — so the title is the rest
     * of the name and the summary is in Drive's own description field. Sending
     * them means the model is never called: it would be paying to work out what
     * is written on the file already.
     *
     * The extension goes, because a title is not a filename. `-> Description`
     * is stripped from the front of the description for the same reason: it is
     * a label from whatever wrote it, not part of what the document says.
     */
    const title = (name || '')
      .slice(day.length)
      .replace(/\.[A-Za-z0-9]{1,8}$/, '')
      .replace(/^[\s\-–—:]+/, '')
      .trim();

    var description = '';
    try {
      description = (file.getDescription() || '')
        // Tolerant of however the label was written: "-> Description",
        // "--> Description:", "Description -", "Description:" and bare.
        // Guessing narrowly here would leave the word sitting at the front of
        // every summary in the box.
        .replace(/^[\s>\-–—]*Description[\s>\-–—:]*/i, '')
        .trim();
    } catch (e) {
      // A file we cannot read a description from is not a failure; it just
      // means the app gets a title and no summary.
    }

    /*
     * Midday, deliberately. A bare date is midnight UTC, which in a timezone
     * behind Greenwich is the *previous evening* — and the feed cuts its days
     * in the server's timezone, so the document would head a day it did not
     * arrive on. Midday is far from either edge.
     */
    return {
      capturedAt: new Date(day + 'T12:00:00Z').toISOString(),
      docDate: day,
      // Only a real title counts. A file called "2026-01-30.pdf" and nothing
      // else has nothing to say, and should still be read.
      title: title || null,
      description: description || null,
    };
  }

  return {
    capturedAt: file.getDateCreated().toISOString(),
    docDate: null,
    title: null,
    description: null,
  };
}

function ingestFile(origin, secret, config, file, startedAt) {
  const name = file.getName();
  const box = config.box;
  const sourceFolderId = config.folderId;
  const toInbox = config.inbox === true;

  if (file.getSize() > MAX_BYTES) {
    Logger.log('Skipping ' + name + ' — larger than this script can forward.');
    return false;
  }

  // A Google Doc has no bytes to send. They are not what a scanner produces,
  // so this is a folder someone has put something else in.
  if (file.getMimeType().indexOf('application/vnd.google-apps') === 0) {
    Logger.log('Skipping ' + name + ' — Docs-editor files have no bytes.');
    return false;
  }

  const open = postFeed(origin, secret, toInbox, {
    step: 'open',
    box: box,
    name: name,
    mimeType: file.getMimeType(),
    // The folder this came from. The app refuses it if it is a folder the app
    // files *into* — watching one of those is a loop that copies every
    // document back into itself on every run, filling a Drive rather than
    // failing. FOLDERS must list the folders you scan into.
    sourceFolderId: sourceFolderId,
  });

  if (!open.uploadUrl) throw new Error('no upload session: ' + JSON.stringify(open));

  // Straight to Google. The bytes never travel through the app, which is what
  // keeps a big scan from hitting its request body limit.
  const put = UrlFetchApp.fetch(open.uploadUrl, {
    method: 'put',
    contentType: file.getMimeType(),
    payload: file.getBlob().getBytes(),
    muteHttpExceptions: true,
  });

  if (put.getResponseCode() !== 200 && put.getResponseCode() !== 201) {
    throw new Error('upload failed: ' + put.getResponseCode() + ' ' + put.getContentText().slice(0, 200));
  }

  const uploaded = JSON.parse(put.getContentText());

  const dated = datedFrom(name, file);

  const done = postFeed(origin, secret, toInbox, {
    step: 'complete',
    box: box,
    // The inbox needs it too: the capture's own label is the filename, since
    // that is the only thing that tells one scan from another in a queue of
    // twenty. `/api/box/ingest` ignores it at this step.
    name: name,
    driveFileId: uploaded.id,
    // The date the scan was made, so a backlog files under the days it
    // actually arrived instead of burying years of letters under today.
    capturedAt: dated.capturedAt,
    // And the printed date, when the filename carries one. See `datedFrom`.
    docDate: dated.docDate,
    /*
     * A title and summary already written down beside the file, which is what
     * makes a backlog free to bring across. See `knownFacts`: sending a title
     * is what tells the app not to read the document.
     */
    title: dated.title,
    description: dated.description,
  });

  if (!done.ok) throw new Error('complete failed: ' + JSON.stringify(done));

  Logger.log('  filed ' + name);

  // Filed first, read second, and never the other way round: the document is
  // safe the moment `complete` returns, and a model that is slow or down must
  // not cost us the file. A failure here leaves it queued, which is exactly
  // where it would have been anyway.
  //
  // Never for a capture. There is nothing to read it *for*: a capture carries
  // no tags, no title and no summary, because deciding what it is is exactly
  // what clarifying does — by hand, later, which is the point of it landing in
  // the inbox rather than in a box.
  if (!toInbox && READ_ON_INGEST && Date.now() - startedAt < READ_BUDGET_MS) {
    try {
      postFeed(origin, secret, false, { step: 'read', itemId: done.id });
      Logger.log('    read');
    } catch (e) {
      Logger.log('    queued for later: ' + e);
    }
  }

  archive(file);
  return true;
}

/** Get the original out of the way, so the next run doesn't send it again. */
function archive(file) {
  if (AFTER_INGEST === 'trash') {
    file.setTrashed(true);
    return;
  }

  const parents = file.getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

  const existing = parent.getFoldersByName('Filed');
  const filed = existing.hasNext() ? existing.next() : parent.createFolder('Filed');

  file.moveTo(filed);
}

/**
 * Named `postFeed`, not `post`, and that is load-bearing.
 *
 * Apps Script has no modules: every `.gs` file in a project is concatenated
 * into one global scope, so two files declaring `function post(...)` are two
 * declarations of one name and the later one silently wins. `gtd-email.gs` has
 * always had a `post` of its own, which was survivable while both took the
 * same three arguments — the worst it did was send this script's "read" step
 * to the ingest path.
 *
 * Adding a fourth parameter here ended that: every scan went out as
 * `JSON.stringify(false)`, the app found no filename in it, and every file
 * came back `400 No filename.` while the run reported "Completed". Nothing in
 * either file looks wrong on its own, which is what makes this worth a name
 * nobody else will pick rather than a comment asking them not to.
 */
function postFeed(origin, secret, toInbox, payload) {
  // Three routes, one secret. The read endpoint is its own because it needs a
  // longer time limit than an ingest step does; the inbox is its own because a
  // capture is not a document — nothing about it is classified, so none of the
  // box route's box-resolving, loop-refusing or title-carrying applies.
  const path =
    payload.step === 'read'
      ? '/api/box/read'
      : toInbox
        ? '/api/inbox/ingest'
        : '/api/box/ingest';

  const response = UrlFetchApp.fetch(origin + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const text = response.getContentText();

  if (response.getResponseCode() !== 200) {
    throw new Error(response.getResponseCode() + ': ' + text.slice(0, 300));
  }

  return JSON.parse(text);
}

/**
 * Run this once by hand before adding a trigger.
 *
 * It sends nothing: it just proves the app is reachable and the secret is
 * right, which are the two things that go wrong.
 */
function testConnection() {
  const props = PropertiesService.getScriptProperties();
  const origin = (props.getProperty('APP_ORIGIN') || '').replace(/\/+$/, '');
  const secret = (props.getProperty('BOX_INGEST_SECRET') || '').trim();

  if (!origin) return Logger.log('APP_ORIGIN is not set in Script Properties.');
  if (!secret) return Logger.log('BOX_INGEST_SECRET is not set in Script Properties.');

  // The length, never the value: enough to spot a truncated paste or a stray
  // newline, and safe to leave in a log you might screenshot.
  Logger.log('Calling ' + origin + '/api/box/ingest with a ' + secret.length + '-character secret');

  const response = UrlFetchApp.fetch(origin + '/api/box/ingest', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify({ step: 'open' }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  Logger.log(code + ': ' + response.getContentText());

  // 400 "No filename" is the good answer: the request was authenticated and
  // understood, and only the payload was deliberately empty.
  if (code === 400) Logger.log('Connected. The 400 above is expected — nothing was sent to file.');
  if (code === 401) Logger.log('Not authorised. The "why" in the response above says which end is wrong.');
  if (code === 404) Logger.log('No such route. Check APP_ORIGIN, and that the app has been deployed since the Big Box was added.');
}
