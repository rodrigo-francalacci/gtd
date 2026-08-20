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
 * Which folder feeds which box.
 *
 * `box` is matched on the box's name in the app, case-insensitively. A name the
 * app doesn't know falls back to the default box rather than failing — a
 * document filed in the wrong box is fixable, a document rejected at the door
 * is gone.
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

    Logger.log('Scanning ' + folder.getName() + ' -> box "' + config.box + '"');

    const files = folder.getFiles();
    var sent = 0;

    while (files.hasNext()) {
      const file = files.next();

      try {
        if (ingestFile(origin, secret, config.box, file, config.folderId, startedAt)) sent++;
      } catch (e) {
        // Left where it is, so the next run tries again. A failure here is
        // usually the app being redeployed mid-run.
        Logger.log('Failed on ' + file.getName() + ': ' + e);
      }
    }

    Logger.log('  ' + sent + ' filed');
  });
}

function ingestFile(origin, secret, box, file, sourceFolderId, startedAt) {
  const name = file.getName();

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

  const open = post(origin, secret, {
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

  const done = post(origin, secret, {
    step: 'complete',
    box: box,
    driveFileId: uploaded.id,
    // The date the scan was made, so a backlog files under the days it
    // actually arrived instead of burying years of letters under today.
    capturedAt: file.getDateCreated().toISOString(),
  });

  if (!done.ok) throw new Error('complete failed: ' + JSON.stringify(done));

  Logger.log('  filed ' + name);

  // Filed first, read second, and never the other way round: the document is
  // safe the moment `complete` returns, and a model that is slow or down must
  // not cost us the file. A failure here leaves it queued, which is exactly
  // where it would have been anyway.
  if (READ_ON_INGEST && Date.now() - startedAt < READ_BUDGET_MS) {
    try {
      post(origin, secret, { step: 'read', itemId: done.id });
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

function post(origin, secret, payload) {
  // The read endpoint is its own route because it needs a longer time limit
  // than an ingest step does.
  const path = payload.step === 'read' ? '/api/box/read' : '/api/box/ingest';

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
