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
//   2. Run `syncEmails` once, by hand, to check it.
//   3. Add a time-driven trigger on `syncEmails`.
//
// `syncEmails` does both halves: the messages you labelled in Gmail, and the
// ones asked for from the app by pasting an id, a Message-ID or a search.

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

// --- REQUESTS ---------------------------------------------------------------

/**
 * The other way in: messages asked for from the app.
 *
 * Labelling is the main path and needs nothing here. This covers the case
 * where you are at a desk with the message open and pasting what you are
 * already looking at is less friction than reaching for the label menu.
 *
 * The app cannot look a message up — it holds `gmail.labels` and nothing more.
 * It writes down that you asked, and this claims the request, resolves it
 * against Gmail, and reports back what happened. Add it to the same trigger as
 * `fileLabelledEmails`, or run `syncEmails` which does both.
 */
function fetchRequestedEmails() {
  const startedAt = Date.now();
  const props = PropertiesService.getScriptProperties();
  const origin = (props.getProperty('APP_ORIGIN') || '').replace(/\/+$/, '');
  const secret = props.getProperty('BOX_INGEST_SECRET');

  if (!origin || !secret) {
    Logger.log('Set APP_ORIGIN and BOX_INGEST_SECRET in Script Properties first.');
    return;
  }

  const claimed = postTo(origin, secret, '/api/box/email', { step: 'claim', limit: 10 });
  const requests = claimed.requests || [];

  Logger.log(requests.length + ' request(s) waiting');

  for (var i = 0; i < requests.length; i++) {
    if (Date.now() - startedAt > BUDGET_MS) {
      Logger.log('Out of time; the rest stay pending.');
      break;
    }

    const request = requests[i];
    /*
     * The ids, not a count. A request asked for from a project has to be
     * cited on it once the message exists, and that linking happens in the
     * app — this script knows about Gmail and Drive, not about which project
     * a message is evidence for.
     */
    var itemIds = [];
    var note = null;

    try {
      const messages = findMessages(request.query);

      if (messages.length === 0) {
        note = 'Gmail found nothing for that.';
      } else {
        for (var m = 0; m < messages.length && m < 20; m++) {
          const id = fileMessage(origin, secret, messages[m], request.box);
          if (id && typeof id === 'string') itemIds.push(id);
        }
        if (messages.length > 20) note = 'Matched ' + messages.length + ' messages; filed the first 20.';
      }
    } catch (e) {
      note = String(e).slice(0, 300);
      Logger.log('Failed on "' + request.query + '": ' + e);
    }

    postTo(origin, secret, '/api/box/email', {
      step: 'resolve',
      id: request.id,
      itemIds: itemIds,
      note: note,
    });

    Logger.log('  ' + request.query + ' -> ' + itemIds.length + ' filed' + (note ? ' (' + note + ')' : ''));
  }
}

/**
 * Work out what you pasted, by asking Gmail rather than by guessing.
 *
 * Three shapes, tried in the order that a wrong answer is cheapest:
 *
 * 1. A **message or thread id** — sixteen or more hex characters. This is what
 *    the API understands, and it is what "Show original" puts in its URL.
 *    Tried as a message first and then as a thread, because the two id spaces
 *    look identical and only Gmail knows which it is.
 * 2. An **RFC822 Message-ID** — `<something@mail.gmail.com>`, also from "Show
 *    original". Gmail searches on it directly with `rfc822msgid:`.
 * 3. Anything else is treated as a **Gmail search**, which is the shape that
 *    turns out to be most useful: `from:sam worktop` finds the thread you were
 *    thinking of without you having to open it at all.
 *
 * The modern `FMfcgz…` permalink is refused by the app before it ever reaches
 * here, because that id belongs to Gmail’s own interface and no API accepts
 * it. If Google ever changes that, this is where it would be handled.
 */
function findMessages(query) {
  const text = String(query).trim();

  if (/^[0-9a-f]{16,}$/i.test(text)) {
    try {
      const message = GmailApp.getMessageById(text);
      if (message) return [message];
    } catch (e) {
      // Not a message id. It may still be a thread id.
    }

    try {
      const thread = GmailApp.getThreadById(text);
      if (thread) return thread.getMessages();
    } catch (e) {
      // Neither. Fall through and let it be searched for.
    }
  }

  const search = /^<[^>]+>$/.test(text)
    ? 'rfc822msgid:' + text.replace(/^<|>$/g, '')
    : text;

  const threads = GmailApp.search(search, 0, 5);
  var messages = [];

  for (var t = 0; t < threads.length; t++) {
    messages = messages.concat(threads[t].getMessages());
  }

  return messages;
}

/** Both halves, for one trigger. */
function syncEmails() {
  fileLabelledEmails();
  fetchRequestedEmails();
}

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

function fileMessage(origin, secret, message, box) {
  const intoBox = box || EMAIL_BOX;
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
    box: intoBox,
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
    box: intoBox,
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
  // The row id, so a request asked for from a project can be linked to it.
  // A count would close the request and leave the citation unwritten.
  return done.id || true;
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

/** The ingest route, which is what most of this script talks to. */
function post(origin, secret, payload) {
  return postTo(origin, secret, '/api/box/ingest', payload);
}

function postTo(origin, secret, path, payload) {
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
