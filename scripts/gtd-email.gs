/**
 * GTD EMAIL — the bridge that files a labelled message into a box.
 *
 * A SECOND FILE in the same Apps Script project as `big-box-feed.gs`. Add it
 * with the + beside Files; do not paste it over anything. It shares that
 * script's two properties (APP_ORIGIN, BOX_INGEST_SECRET) and touches none of
 * its settings — your FOLDERS list is not read here and not written here.
 *
 * WHAT IT DOES
 * You label a message in Gmail. On its next run this renders that message to
 * HTML, uploads it through the app's own credentials, and tells the app who it
 * was from, when it was sent and where the original lives. Then it takes the
 * label off, so the same message is never filed twice.
 *
 * WHY A LABEL AND NOT A LINK
 * Because a Gmail URL does not contain a usable id. The `#inbox/FMfcgz…` on the
 * end of one is a permalink for Gmail's own interface; the API and this script
 * both want the message id, and there is no way to turn one into the other. A
 * label is also simply better to use: it is two taps on a phone, in the app you
 * are already reading the message in.
 *
 * WHY A SCRIPT AND NOT THE APP
 * Reading a message body needs `gmail.readonly`, which Google classes as a
 * *restricted* scope: an app holding one needs annual security assessment to be
 * published, or has its refresh token expired every seven days if it stays in
 * testing — and that token is the same one Drive sync and the calendar run on.
 * This script is not a published app. It is yours, bound to your account,
 * reading your own mail, and it needs no verification at all. That is the same
 * asymmetry the scanner bridge already relies on, used a second time.
 */

// --- SETUP ------------------------------------------------------------------
// Nothing to add if `big-box-feed.gs` is already working: this reads the same
// two Script Properties. Then:
//   1. Run `authoriseGmail` once, by hand, and grant Gmail access.
//   2. Run `fileLabelledEmails` once, by hand, to check it.
//   3. Add a time-driven trigger on `fileLabelledEmails`.

/**
 * The label you put on a message to file it.
 *
 * Created for you the first time this runs. Nested under GTD so it sits with
 * the labels the app already makes rather than at the top of your label list.
 */
const EMAIL_LABEL = 'GTD/Relevant';

/**
 * Which box labelled messages go into.
 *
 * Matched on the box's name in the app, case-insensitively, exactly as the
 * scanner bridge matches its folders. A name the app doesn't know falls back to
 * the default box rather than failing — a message filed in the wrong box is
 * fixable and one rejected at the door is gone.
 *
 * One box for everything, on purpose. Sorting mail by subject is what the tags
 * and the search are for; a label per box would mean deciding where a message
 * belongs at the moment you are least interested in the question.
 */
const EMAIL_BOX = 'Feed';

/**
 * Remove the label once filed.
 *
 * This is what stops a message being filed twice, so leaving it on means every
 * run files every labelled message again. Set it false only while you are
 * watching the log to see what would happen.
 */
const REMOVE_LABEL_WHEN_DONE = true;

/** A trigger gets six minutes; stop well before it is taken away mid-message. */
const BUDGET_MS = 4 * 60 * 1000;

/** Threads per run. A backlog drains over several runs rather than one long one. */
const MAX_THREADS = 25;

// --- MAIN -------------------------------------------------------------------

function fileLabelledEmails() {
  const startedAt = Date.now();
  const props = PropertiesService.getScriptProperties();
  const origin = (props.getProperty('APP_ORIGIN') || '').replace(/\/+$/, '');
  const secret = props.getProperty('BOX_INGEST_SECRET');

  if (!origin || !secret) {
    Logger.log('Set APP_ORIGIN and BOX_INGEST_SECRET in Script Properties first.');
    return;
  }

  const label = GmailApp.getUserLabelByName(EMAIL_LABEL);
  if (!label) {
    GmailApp.createLabel(EMAIL_LABEL);
    Logger.log('Created the label "' + EMAIL_LABEL + '". Put it on a message and run this again.');
    return;
  }

  const threads = label.getThreads(0, MAX_THREADS);
  Logger.log(threads.length + ' thread(s) labelled ' + EMAIL_LABEL);

  var filed = 0;

  for (var t = 0; t < threads.length; t++) {
    if (Date.now() - startedAt > BUDGET_MS) {
      Logger.log('Out of time; the rest keep their label and go next run.');
      break;
    }

    const thread = threads[t];

    try {
      /*
       * Every message in the thread, not just the last.
       *
       * A thread is a conversation and the useful part is rarely the final
       * reply on its own — the quote at the bottom of it is a rendering of
       * what came before, not the thing itself, and it is routinely trimmed.
       * Filing each message means the search can find whichever one actually
       * said the thing.
       */
      const messages = thread.getMessages();

      for (var m = 0; m < messages.length; m++) {
        if (fileMessage(origin, secret, messages[m])) filed++;
      }

      if (REMOVE_LABEL_WHEN_DONE) thread.removeLabel(label);
    } catch (e) {
      // Keeps its label, so the next run tries again. Usually the app being
      // redeployed mid-run.
      Logger.log('Failed on "' + thread.getFirstMessageSubject() + '": ' + e);
    }
  }

  Logger.log(filed + ' message(s) filed into "' + EMAIL_BOX + '"');
}

function fileMessage(origin, secret, message) {
  const subject = message.getSubject() || '(no subject)';
  const sent = message.getDate();

  /*
   * The filename leads with the date, matching the convention the scanner
   * bridge already writes into these folders. A hundred messages sorted by the
   * first letter of a subject is not a filing system.
   */
  const name = isoDay(sent) + ' ' + safeName(subject) + '.html';

  const html = renderMessage(message, subject, sent);
  const blob = Utilities.newBlob(html, 'text/html', name);

  if (blob.getBytes().length > 40 * 1024 * 1024) {
    Logger.log('Skipping "' + subject + '" — larger than this script can forward.');
    return false;
  }

  const open = post(origin, secret, {
    step: 'open',
    box: EMAIL_BOX,
    name: name,
    mimeType: 'text/html',
  });

  if (!open.uploadUrl) throw new Error('no upload session: ' + JSON.stringify(open));

  const put = UrlFetchApp.fetch(open.uploadUrl, {
    method: 'put',
    contentType: 'text/html',
    payload: blob.getBytes(),
    muteHttpExceptions: true,
  });

  if (put.getResponseCode() !== 200 && put.getResponseCode() !== 201) {
    throw new Error('upload failed: ' + put.getResponseCode() + ' ' + put.getContentText().slice(0, 200));
  }

  const uploaded = JSON.parse(put.getContentText());

  const done = post(origin, secret, {
    step: 'complete',
    box: EMAIL_BOX,
    driveFileId: uploaded.id,
    /*
     * Filed under the day it was *sent*, not the day you got round to
     * labelling it. The feed is ordered by arrival and a month of correspondence
     * labelled in one sitting would otherwise all land under today, which is
     * the one arrangement that makes it impossible to find anything.
     */
    capturedAt: sent.toISOString(),
    email: {
      subject: subject,
      from: message.getFrom(),
      date: sent.toISOString(),
      // Gmail's own permalink. Not an API id — this is for a human to click.
      permalink: 'https://mail.google.com/mail/u/0/#all/' + message.getId(),
      snippet: (message.getPlainBody() || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      // The body as text, so the app can index it without reading the markup
      // or paying a model to look at a message that already says what it says.
      text: (message.getPlainBody() || '').slice(0, 100000),
    },
  });

  if (!done.ok) throw new Error('complete failed: ' + JSON.stringify(done));

  Logger.log('  filed ' + name);
  return true;
}

/**
 * The message as a page.
 *
 * A header block of the things you would want at a glance, then the body as
 * Gmail rendered it. `getBody()` is HTML for almost everything; a plain-text
 * message gets escaped and wrapped so it still reads as a document rather than
 * as one long line.
 *
 * Remote images are left exactly as they are, and that is safe here rather than
 * merely tolerated: the app shows this file in a frame with `sandbox=""`, which
 * denies scripts and gives it an opaque origin. A tracking pixel in a filed
 * message does not fire when you read it in the app, which is a better outcome
 * than it gets in most mail clients.
 */
function renderMessage(message, subject, sent) {
  var body = message.getBody();

  if (!body || body.indexOf('<') === -1) {
    body = '<pre style="white-space:pre-wrap;font:inherit">' +
      escapeHtml(message.getPlainBody() || '') + '</pre>';
  }

  const rows = [
    ['From', message.getFrom()],
    ['To', message.getTo()],
    ['Cc', message.getCc()],
    ['Date', Utilities.formatDate(sent, Session.getScriptTimeZone(), "d MMMM yyyy 'at' HH:mm")],
  ]
    .filter(function (row) { return row[1]; })
    .map(function (row) {
      return '<tr><th style="text-align:left;padding:2px 12px 2px 0;font-weight:600;white-space:nowrap;vertical-align:top">' +
        row[0] + '</th><td style="padding:2px 0">' + escapeHtml(row[1]) + '</td></tr>';
    })
    .join('');

  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<title>' + escapeHtml(subject) + '</title></head><body>' +
    '<h1 style="font:600 20px/1.3 system-ui,sans-serif;margin:0 0 12px">' + escapeHtml(subject) + '</h1>' +
    '<table style="font:13px/1.5 system-ui,sans-serif;margin:0 0 20px;border-collapse:collapse">' + rows + '</table>' +
    '<hr style="border:0;border-top:1px solid #ddd;margin:0 0 20px">' +
    body +
    '</body></html>';
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `2026-08-26`, in the script's own timezone. */
function isoDay(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Deliberately the same rule as `safeName` in the app.
 *
 * The app owns a document's title and sweeps Drive to make the filename match
 * it — so if this named the file by a different rule, every message would be
 * filed and then immediately renamed, once, for nothing. Same replacements,
 * same length. Only the slash characters are removed, because they are the two
 * a path cannot contain; everything else is a legal filename and stripping it
 * would be tidying someone's subject line.
 */
function safeName(text) {
  return String(text).replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Message';
}

function post(origin, secret, payload) {
  const response = UrlFetchApp.fetch(origin + '/api/box/ingest', {
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
 * Run this once, by hand, before adding a trigger.
 *
 * Apps Script asks for the scopes a script actually uses, and it works that out
 * from the code — so Gmail access is not requested until something calls
 * GmailApp. This calls it, harmlessly, so the consent screen appears while you
 * are watching rather than silently failing inside a trigger at three in the
 * morning.
 */
function authoriseGmail() {
  const label = GmailApp.getUserLabelByName(EMAIL_LABEL) || GmailApp.createLabel(EMAIL_LABEL);
  Logger.log('Gmail is authorised. Label "' + EMAIL_LABEL + '" exists with ' +
    label.getThreads(0, 1).length + ' thread(s) waiting.');
  Logger.log('Filing into the "' + EMAIL_BOX + '" box.');
}
