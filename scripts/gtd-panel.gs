/**
 * GTD PANEL — a page with buttons, for running the bridges before the trigger.
 *
 * A THIRD FILE in the same Apps Script project as `big-box-feed.gs` and
 * `gtd-email.gs`. Add it with the + beside Files. It defines no settings of its
 * own and changes none of theirs — it only calls their functions.
 *
 * WHY THIS EXISTS
 * A time trigger runs when it runs. Everything here is something you want to
 * happen *now*: you have just scanned a receipt, or labelled a message, or
 * pasted an id into the app and would like to see it arrive rather than find
 * out in an hour. The alternative is opening the script editor, finding the
 * right function in a dropdown, and pressing Run — which works and is four
 * clicks and a page you have to know your way around.
 *
 * DEPLOYING IT
 *   Deploy ▸ New deployment ▸ Web app
 *     Execute as        Me
 *     Who has access    Only myself
 *   Copy the /exec URL it gives you and paste it on the app's Google page.
 *
 * "Only myself" matters. This page runs your scripts with your Gmail and your
 * Drive; anyone who could open it could file things into your account. There is
 * no secret in the URL and there does not need to be — Google checks who you
 * are before the page is served.
 *
 * REDEPLOYING
 * Editing a file does not change what a deployment serves. After any change
 * here or in the other two files: Deploy ▸ Manage deployments ▸ the pencil ▸
 * Version: New version ▸ Deploy. The URL stays the same.
 */

/**
 * What the page can run.
 *
 * Declared as data rather than as a row of hand-written buttons so the page and
 * the dispatcher cannot disagree about what exists — adding an entry here is the
 * whole of adding a button.
 *
 * `needs` names the other file a job lives in. A project with only the scanner
 * bridge pasted in should say so plainly rather than failing with a reference
 * error the first time the button is pressed.
 */
function panelJobs() {
  return [
    {
      id: 'syncEverything',
      group: 'Everything',
      primary: true,
      title: 'Sync everything',
      detail:
        'Scans in, then email, then the project listings, then the app’s own tick. ' +
        'The one button — the rest are here so you can run a step on its own.',
      needs: 'this file',
    },
    {
      id: 'installDailyTrigger',
      group: 'Once, to set up',
      title: 'Run this daily',
      detail:
        'Installs a time trigger that runs “Sync everything” once a day, so none ' +
        'of this needs pressing. Safe to press twice — it replaces the old one.',
      needs: 'this file',
    },
    {
      id: 'removeDailyTrigger',
      group: 'Once, to set up',
      title: 'Stop running daily',
      detail: 'Removes that trigger. Nothing else changes.',
      needs: 'this file',
    },
    {
      id: 'syncEmails',
      group: 'One at a time',
      title: 'Sync email',
      detail:
        'Files the messages you have labelled GTD/Relevant, then fetches the ones ' +
        'asked for from the app.',
      needs: 'gtd-email.gs',
    },
    {
      id: 'fileLabelledEmails',
      group: 'One at a time',
      title: 'Labelled only',
      detail: 'Just the GTD/Relevant label. Useful when you know that is all there is.',
      needs: 'gtd-email.gs',
    },
    {
      id: 'fetchRequestedEmails',
      group: 'One at a time',
      title: 'Requested only',
      detail: 'Just the ids and searches waiting in the app.',
      needs: 'gtd-email.gs',
    },
    {
      id: 'processFeedFolders',
      group: 'One at a time',
      title: 'File scans',
      detail: 'Sweeps the scan folders into their boxes.',
      needs: 'big-box-feed.gs',
    },
    {
      id: 'walkProjectTrees',
      group: 'One at a time',
      title: 'Project folders',
      detail:
        'Walks each project’s Drive folder and Gmail label and posts the listing ' +
        'to the app, so you can navigate them in the preview pane. The app holds ' +
        'no scope that could read either.',
      needs: 'gtd-project-tree.gs',
    },
    {
      id: 'syncDriveNames',
      group: 'One at a time',
      title: 'Sync filenames',
      detail:
        'Asks the app to push its titles out to Drive, so a document renamed in ' +
        'the app is renamed in the folder too. Also drains the sync, enrichment ' +
        'and reading queues — it is the same tick the daily cron runs.',
      needs: 'this file',
    },
    {
      id: 'testConnection',
      group: 'Once, to set up',
      title: 'Test the connection',
      detail:
        'Sends nothing. Proves the app is reachable and the secret is right, which ' +
        'are the two things that go wrong.',
      needs: 'big-box-feed.gs',
    },
    {
      id: 'authoriseGmail',
      group: 'Once, to set up',
      title: 'Authorise Gmail',
      detail: 'Run once, before the first sync, to grant this script access to your mail.',
      needs: 'gtd-email.gs',
    },
  ];
}

/**
 * Everything, in the order that makes each step useful to the next.
 *
 * Scans first, because a document has to exist before anything can read or
 * rename it. Then email. Then the project listings, which are a picture of
 * folders the earlier steps may have just added to. Then the app's own tick
 * last, because that is what drains the queues the first three filled — moving
 * files into the folders their rows now name, pushing titles out to Drive,
 * reading what arrived.
 *
 * One failing step must not stop the rest: they are independent, and a Gmail
 * hiccup should not mean the scans stay unfiled. Each is reported, and the
 * whole thing says at the end whether anything went wrong.
 */
function syncEverything() {
  const steps = [
    ['Scans', 'processFeedFolders'],
    ['Email', 'syncEmails'],
    ['Project listings', 'walkProjectTrees'],
    ['The app’s own tick', 'syncDriveNames'],
  ];

  var failed = 0;

  for (var i = 0; i < steps.length; i++) {
    const label = steps[i][0];
    const name = steps[i][1];

    Logger.log('— ' + label + ' —');

    // A project with only some of the files pasted in should say which is
    // missing rather than dying on a reference error.
    if (typeof this[name] !== 'function') {
      Logger.log('  skipped: ' + name + ' is not in this project');
      continue;
    }

    try {
      this[name]();
    } catch (e) {
      failed++;
      Logger.log('  FAILED: ' + e);
    }
  }

  Logger.log(failed === 0 ? 'All steps finished.' : failed + ' step(s) failed — see above.');
}

/** How often the trigger runs, and at what hour. Google picks the minute. */
const DAILY_HOUR = 4;

/**
 * Run `syncEverything` once a day, without anybody pressing anything.
 *
 * The app's own half already runs daily on Vercel's cron. This is the other
 * half: nothing in Apps Script runs on its own until a trigger exists, and
 * until now there was no code that made one — so the bridges only ever ran when
 * a button was pressed, which is a thing to remember rather than a thing that
 * happens.
 *
 * Replaces rather than adds. Pressing this twice is the most likely thing
 * anybody will do, and two triggers would mean two runs racing each other into
 * the same boxes.
 */
function installDailyTrigger() {
  removeDailyTrigger();

  ScriptApp.newTrigger('syncEverything').timeBased().everyDays(1).atHour(DAILY_HOUR).create();

  Logger.log('Installed. “Sync everything” will run daily at about ' + DAILY_HOUR + ':00.');
}

function removeDailyTrigger() {
  const all = ScriptApp.getProjectTriggers();
  var removed = 0;

  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === 'syncEverything') {
      ScriptApp.deleteTrigger(all[i]);
      removed++;
    }
  }

  Logger.log(removed === 0 ? 'There was no daily trigger.' : 'Removed ' + removed + '.');
  return removed;
}

/** Whether a daily run is set up, for the page to say so without guessing. */
function dailyTriggerInstalled() {
  const all = ScriptApp.getProjectTriggers();

  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === 'syncEverything') return true;
  }

  return false;
}

function doGet() {
  const template = HtmlService.createTemplate(PANEL_HTML);
  template.jobs = panelJobs();
  // Said on the page rather than left to be remembered.
  template.daily = dailyTriggerInstalled();

  return template
    .evaluate()
    .setTitle('GTD bridges')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    /*
     * Embeddable, so the app can put it in a pane if that turns out to be
     * wanted. It is opened in a tab today: a web app served from a different
     * origin has its own sign-in behaviour, and a login redirect inside an
     * iframe is a blank rectangle with nothing to click.
     */
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Run one job and hand back what it logged.
 *
 * The functions this calls all report through `Logger`, which is exactly right
 * for the script editor and invisible from a web page — so this reads the log
 * back out afterwards. `Logger.getLog()` is scoped to one execution, and each
 * `google.script.run` call is its own execution, so what comes back is this
 * run's output and nothing else.
 *
 * The name is checked against `panelJobs` rather than being called directly.
 * Whatever the page sends is a string from a browser, and `this[name]()` on an
 * unchecked string is a way to run any function in the project.
 */
/**
 * Ask the app to run the tick the cron would have run.
 *
 * The rename sweep lives in the *app*, not here — it is the app that knows what
 * a document is called, and `drive.file` lets it rename what it created, so
 * there was never a reason to give this script the job. What the panel adds is a
 * way to say *now*, because on a Hobby plan the cron runs daily: a document
 * retitled at two in the afternoon otherwise sits in Drive under its old name
 * until the following morning.
 *
 * `CRON_SECRET` rather than `BOX_INGEST_SECRET`, because that endpoint checks
 * the one Vercel sends. It is a second property to set and there is no way
 * around that — the alternative is bolting a rename onto an endpoint that has
 * nothing to do with renaming, so that one secret covers both.
 */
function syncDriveNames() {
  const props = PropertiesService.getScriptProperties();
  const origin = (props.getProperty('APP_ORIGIN') || '').replace(/\/+$/, '');
  const secret = (props.getProperty('CRON_SECRET') || '').trim();

  if (!origin) {
    Logger.log('APP_ORIGIN is not set in this script’s properties.');
    return;
  }

  if (!secret) {
    Logger.log(
      'CRON_SECRET is not set in this script’s properties. It is the same value ' +
      'as CRON_SECRET in the app’s environment — the endpoint checks the token ' +
      'Vercel sends, which is a different secret from BOX_INGEST_SECRET.',
    );
    return;
  }

  const response = UrlFetchApp.fetch(origin + '/api/cron/sync', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + secret },
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code === 401) {
    Logger.log('Refused: CRON_SECRET here does not match the app’s.');
    return;
  }

  if (code !== 200) {
    Logger.log('The app answered ' + code + ': ' + body.slice(0, 400));
    return;
  }

  /*
   * The reply is the tick's own tally — how many jobs drained, how many files
   * were renamed. Printed rather than summarised, because when this is pressed
   * it is usually to find out whether something happened.
   */
  Logger.log(body.slice(0, 1000));
}

function panelRun(id) {
  const jobs = panelJobs();
  var job = null;

  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i].id === id) job = jobs[i];
  }

  if (!job) return { ok: false, log: 'No such job: ' + id };

  const fn = this[job.id];

  if (typeof fn !== 'function') {
    return {
      ok: false,
      log:
        'That needs ' + job.needs + ', which is not in this Apps Script project. ' +
        'Add it with the + beside Files and paste the file in.',
    };
  }

  const startedAt = Date.now();

  try {
    fn();
    return {
      ok: true,
      log: (Logger.getLog() || 'Finished, with nothing to report.') +
        '\n— ' + Math.round((Date.now() - startedAt) / 100) / 10 + 's',
    };
  } catch (e) {
    // The log first: what it managed before it failed is usually the useful
    // half, and the exception on its own rarely says which file it was on.
    return { ok: false, log: (Logger.getLog() || '') + '\n' + e };
  }
}

/**
 * The page.
 *
 * A template string rather than a separate HTML file, so the whole panel is one
 * thing to paste. Everything is inline for the same reason — and because a
 * stylesheet fetched from anywhere else is a request this page has no need to
 * make.
 *
 * Dark by default via `prefers-color-scheme`, since it will usually be opened
 * from an app that is.
 */
var PANEL_HTML =
'<!doctype html>' +
'<style>' +
'  :root { color-scheme: light dark; --paper:#fff; --ink:#1a1a1a; --line:#e2e2e2; --quiet:#7a7a7a; --wash:#f4f4f4; }' +
'  @media (prefers-color-scheme: dark) {' +
'    :root { --paper:#17181a; --ink:#e6e6e4; --line:#34353a; --quiet:#94969d; --wash:#232427; }' +
'  }' +
'  * { box-sizing: border-box; }' +
'  body { margin:0; padding:20px 16px 40px; background:var(--paper); color:var(--ink);' +
'         font:14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }' +
'  main { max-width: 34rem; margin: 0 auto; }' +
'  h1 { font-size:13px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;' +
'       color:var(--quiet); margin:0 0 2px; }' +
'  p.sub { margin:0 0 20px; font-size:12px; color:var(--quiet); }' +
'  ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }' +
'  li { border:1px solid var(--line); border-radius:4px; padding:10px 12px; }' +
'  .row { display:flex; align-items:baseline; gap:10px; }' +
'  .row strong { font-size:13px; font-weight:600; }' +
'  .row span { flex:1 1 auto; min-width:0; font-size:12px; color:var(--quiet); }' +
'  button { flex:0 0 auto; border:1px solid var(--line); background:var(--wash); color:inherit;' +
'           border-radius:3px; padding:5px 12px; font:inherit; font-size:12px; cursor:pointer; }' +
'  button:hover:enabled { border-color:var(--quiet); }' +
'  button:disabled { opacity:.45; cursor:default; }' +
'  button.primary { background:#1a73e8; border-color:#1a73e8; color:#fff; font-weight:600; }' +
'  button.primary:hover:enabled { background:#1765cc; border-color:#1765cc; }' +
'  h2 { margin:22px 0 6px; font-size:11px; text-transform:uppercase; letter-spacing:.08em;' +
'       color:var(--quiet); font-weight:600; }' +
'  pre { margin:10px 0 0; padding:8px 10px; background:var(--wash); border-radius:3px;' +
'        font:12px/1.5 ui-monospace, Menlo, monospace; white-space:pre-wrap;' +
'        word-break:break-word; max-height:16rem; overflow:auto; }' +
'  pre.bad { color:#b3261e; }' +
'  footer { margin-top:22px; font-size:11px; color:var(--quiet); }' +
'</style>' +
'<main>' +
'  <h1>GTD bridges</h1>' +
'  <p class="sub">' +
'    <? if (daily) { ?>' +
'      Running on its own once a day. Press something here to make it happen now.' +
'    <? } else { ?>' +
'      <strong>Nothing here runs on its own yet.</strong> Press &#8220;Run this daily&#8221; below once, and it will.' +
'    <? } ?>' +
'  </p>' +
/*
 * Grouped, in the order you meet them: the one button, then the parts it is
 * made of for when a step needs running alone, then the things you do once and
 * forget. A flat list of nine made the important one indistinguishable from the
 * diagnostics.
 */
'  <? var groups = ["Everything", "One at a time", "Once, to set up"];' +
'     for (var g = 0; g < groups.length; g++) { ?>' +
'    <h2><?= groups[g] ?></h2>' +
'    <ul>' +
'      <? for (var i = 0; i < jobs.length; i++) {' +
'           if (jobs[i].group !== groups[g]) continue; ?>' +
'        <li>' +
'          <div class="row">' +
'            <strong><?= jobs[i].title ?></strong>' +
'            <span><?= jobs[i].detail ?></span>' +
'            <button id="b-<?= jobs[i].id ?>" class="<?= jobs[i].primary ? "primary" : "" ?>" onclick="go(\'<?= jobs[i].id ?>\')">Run</button>' +
'          </div>' +
'          <pre id="o-<?= jobs[i].id ?>" hidden></pre>' +
'        </li>' +
'      <? } ?>' +
'    </ul>' +
'  <? } ?>' +
'  <footer>Changed a script? Deploy &#9656; Manage deployments &#9656; edit &#9656; New version.</footer>' +
'</main>' +
'<script>' +
'  function go(id) {' +
'    var button = document.getElementById("b-" + id);' +
'    var out = document.getElementById("o-" + id);' +
'    button.disabled = true;' +
'    button.textContent = "Running";' +
'    out.hidden = false;' +
'    out.className = "";' +
'    out.textContent = "…";' +
'    google.script.run' +
'      .withSuccessHandler(function (r) { done(id, r.log, !r.ok); })' +
'      .withFailureHandler(function (e) { done(id, String(e), true); })' +
'      .panelRun(id);' +
'  }' +
'  function done(id, text, bad) {' +
'    var button = document.getElementById("b-" + id);' +
'    var out = document.getElementById("o-" + id);' +
'    button.disabled = false;' +
'    button.textContent = "Run";' +
'    out.className = bad ? "bad" : "";' +
'    out.textContent = (text || "").trim() || "Nothing to report.";' +
'  }' +
'</script>';
