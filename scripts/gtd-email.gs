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
 * Which box `GTD/Relevant` goes into.
 *
 * Matched on the box's name in the app, case-insensitively, exactly as the
 * scanner bridge matches its folders. A name the app doesn't know falls back to
 * the default box rather than failing — a message filed in the wrong box is
 * fixable and one rejected at the door is gone.
 *
 * This is the "I do not want to decide" label, and it stays: sorting mail by
 * subject is what the tags and the search are for, and most messages are filed
 * at the moment you are least interested in the question.
 */
const EMAIL_BOX = 'Feed';

/**
 * Where the per-box labels live.
 *
 * Anything under here is a box by name: `GTD/Box/Receipts` files into the box
 * called Receipts. Make them from the app — right-click a box in the sidebar —
 * so that the app knows the label exists and can tell you what it is called.
 * A label made by hand still works, as long as the name matches a box.
 *
 * The point of a label per box is that a message you are keeping for reference
 * can be filed *where it belongs* in one gesture, in the app you are already
 * reading it in, without opening the app at all.
 */
const BOX_LABEL_PREFIX = 'GTD/Box/';

/**
 * Archive the thread once its messages are filed.
 *
 * Filing a message is the moment it stops needing to be in an inbox: that is
 * the whole point of putting it somewhere you can find it again. Set this
 * false if you would rather do it yourself.
 *
 * **Archiving it yourself first works either way**, which is worth knowing: a
 * Gmail label has nothing to do with the inbox, so `getThreads` on a label
 * finds threads you have already archived. Label it, archive it, and the next
 * run still files it — this then finds nothing left to archive and moves on.
 */
const ARCHIVE_WHEN_DONE = true;

/**
 * Remove the label once filed. **Off, and it should stay off.**
 *
 * This used to be how a message avoided being filed twice: file it, take the
 * label off, and the next run finds nothing to do. It worked, and it meant the
 * label you had just put a message into emptied itself — so Gmail could not be
 * browsed the way the Drive folders can, which is most of the point of having a
 * label per box.
 *
 * What stops a second filing now is the app: it records the Gmail message id of
 * everything it has filed, and this asks before uploading. The app is the record
 * of what is in a box, so the app is the right thing to ask — and the label is
 * left alone for ever, exactly as a file stays in its Drive folder.
 *
 * Turn it on only if you want the old behaviour back.
 */
const REMOVE_LABEL_WHEN_DONE = false;

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

  /*
   * Every label that files somewhere: the general one, then one per box.
   *
   * Built as a list rather than handled separately, so the time budget and the
   * failure handling below cover all of them equally — a slow box should eat
   * into the same six minutes as any other, not get its own.
   */
  const sources = [];

  const general = GmailApp.getUserLabelByName(EMAIL_LABEL);
  if (general) {
    sources.push({ label: general, box: EMAIL_BOX });
  } else {
    GmailApp.createLabel(EMAIL_LABEL);
    Logger.log('Created the label "' + EMAIL_LABEL + '". Put it on a message and run this again.');
  }

  const all = GmailApp.getUserLabels();

  for (var i = 0; i < all.length; i++) {
    const name = all[i].getName();

    if (name.indexOf(BOX_LABEL_PREFIX) !== 0) continue;

    const boxName = name.slice(BOX_LABEL_PREFIX.length);

    // `GTD/Box` itself is the container the app nests these under, not a box.
    if (!boxName || boxName.indexOf('/') >= 0) continue;

    sources.push({ label: all[i], box: boxName });
  }

  if (sources.length === 0) return;

  /*
   * Which labels this run will look at, always, before it looks at any of them.
   *
   * Logged unconditionally rather than only when something is found, because
   * the question this answers is "is the script I am running the one that knows
   * about box labels" — and the version that did not know printed nothing at
   * all, which is indistinguishable from finding no mail. A line naming the
   * labels tells you which script you are running in one glance.
   */
  Logger.log(
    'Watching ' + sources.length + ' label(s): ' +
      sources
        .map(function (s) { return s.label.getName() + ' -> ' + s.box; })
        .join(', '),
  );

  var filed = 0;
  var skipped = 0;

  for (var srcIndex = 0; srcIndex < sources.length; srcIndex++) {
    const source = sources[srcIndex];

    /*
     * Threads carrying the label, archived or not.
     *
     * A Gmail label is independent of the inbox, so this finds messages you
     * have already archived yourself — label it, archive it, forget it, and the
     * next run still files it. That is the ordinary way to use this.
     */
    const threads = source.label.getThreads(0, MAX_THREADS);
    if (threads.length === 0) continue;

    Logger.log(threads.length + ' thread(s) on ' + source.label.getName());

    for (var t = 0; t < threads.length; t++) {
      if (Date.now() - startedAt > BUDGET_MS) {
        Logger.log('Out of time; the rest keep their label and go next run.');
        return;
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

        /*
         * Ask the app which of these it already has, in one call for the whole
         * thread rather than one per message. Anything it names is skipped —
         * that is what replaced taking the label off.
         *
         * A failed check is treated as "none filed", which risks a duplicate
         * rather than a silent miss. Of the two, filing something twice is the
         * one you can see and undo.
         */
        const ids = messages.map(function (msg) { return msg.getId(); });
        const already = alreadyFiled(origin, secret, ids, source.box);

        for (var m = 0; m < messages.length; m++) {
          if (already[messages[m].getId()]) {
            skipped++;
            continue;
          }
          if (fileMessage(origin, secret, messages[m], source.box)) filed++;
        }

        /*
         * Archived first, then unlabelled. Both are cheap and neither can be
         * undone by a failure above — we only reach here once every message in
         * the thread is in the box.
         *
         * A thread you had already archived is unaffected: this is a no-op on
         * one that is not in the inbox.
         */
        if (ARCHIVE_WHEN_DONE) thread.moveToArchive();
        // Off by default now — see the constant. The label stays put.
        if (REMOVE_LABEL_WHEN_DONE) thread.removeLabel(source.label);

        /*
         * And make the thread's box labels say what the app says.
         *
         * Moving an entry to another box, copying it into a second one, or
         * throwing it away are all things the app can do to its own records and
         * cannot do to Gmail — it holds `gmail.labels`, which manages labels but
         * cannot put one on a message. So it says what should be true and this
         * puts it right.
         *
         * Deleting matters most: with the label no longer removed on filing, a
         * thrown-away entry whose label stayed would simply be filed again on
         * the next run. Asking for the complete set means "none" is an answer,
         * and the label goes.
         */
        relabel(origin, secret, thread, ids);
      } catch (e) {
        // Keeps its label, so the next run tries again. Usually the app being
        // redeployed mid-run.
        Logger.log('Failed on "' + thread.getFirstMessageSubject() + '": ' + e);
      }
    }
  }

  Logger.log(filed + ' message(s) filed, ' + skipped + ' already in a box');
}

/**
 * Which of these message ids the app already holds, as a lookup.
 *
 * One request for a whole thread. A failure comes back empty, which risks
 * filing something twice rather than silently missing it — and a duplicate is
 * visible in the box and can be thrown away, where a miss is a message you go
 * looking for in a year and do not find.
 */
function alreadyFiled(origin, secret, ids, box) {
  const seen = {};
  if (!ids.length) return seen;

  try {
    const answer = postTo(origin, secret, '/api/box/filed', { ids: ids, box: box });
    const filed = (answer && answer.filed) || [];
    for (var i = 0; i < filed.length; i++) seen[filed[i]] = true;
  } catch (e) {
    Logger.log('  could not check what is already filed: ' + e);
  }

  return seen;
}

/**
 * Make a thread's `GTD/Box/*` labels match what the app holds.
 *
 * Only labels under `GTD/Box/` are touched. Everything else on the thread —
 * your own labels, `GTD/Relevant`, whatever Gmail put there — is left exactly
 * alone, because none of it is this script's business.
 *
 * A failed lookup changes nothing rather than guessing: the labels stay as they
 * are and the next run tries again, which is the same rule the filing follows.
 */
function relabel(origin, secret, thread, messageIds) {
  var wanted;

  try {
    const answer = postTo(origin, secret, '/api/box/relabel', { ids: messageIds });
    if (!answer || !answer.ok) return;
    wanted = answer.labels || [];
  } catch (e) {
    Logger.log('  could not check labels: ' + e);
    return;
  }

  const want = {};
  for (var i = 0; i < wanted.length; i++) want[wanted[i]] = true;

  const have = {};
  const current = thread.getLabels();
  for (var j = 0; j < current.length; j++) {
    const name = current[j].getName();
    if (name.indexOf(BOX_LABEL_PREFIX) === 0) have[name] = current[j];
  }

  for (var name in want) {
    if (!have[name]) {
      thread.addLabel(GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name));
      Logger.log('  + ' + name);
    }
  }

  for (var had in have) {
    if (!want[had]) {
      thread.removeLabel(have[had]);
      Logger.log('  − ' + had);
    }
  }
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
