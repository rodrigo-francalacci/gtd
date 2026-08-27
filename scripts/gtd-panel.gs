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
      id: 'syncEmails',
      title: 'Sync email',
      detail:
        'Files the messages you have labelled GTD/Relevant, then fetches the ones ' +
        'asked for from the app.',
      needs: 'gtd-email.gs',
    },
    {
      id: 'fileLabelledEmails',
      title: 'Labelled only',
      detail: 'Just the GTD/Relevant label. Useful when you know that is all there is.',
      needs: 'gtd-email.gs',
    },
    {
      id: 'fetchRequestedEmails',
      title: 'Requested only',
      detail: 'Just the ids and searches waiting in the app.',
      needs: 'gtd-email.gs',
    },
    {
      id: 'processFeedFolders',
      title: 'File scans',
      detail: 'Sweeps the scan folders into their boxes.',
      needs: 'big-box-feed.gs',
    },
    {
      id: 'testConnection',
      title: 'Test the connection',
      detail:
        'Sends nothing. Proves the app is reachable and the secret is right, which ' +
        'are the two things that go wrong.',
      needs: 'big-box-feed.gs',
    },
    {
      id: 'authoriseGmail',
      title: 'Authorise Gmail',
      detail: 'Run once, before the first sync, to grant this script access to your mail.',
      needs: 'gtd-email.gs',
    },
  ];
}

function doGet() {
  const template = HtmlService.createTemplate(PANEL_HTML);
  template.jobs = panelJobs();

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
'  pre { margin:10px 0 0; padding:8px 10px; background:var(--wash); border-radius:3px;' +
'        font:12px/1.5 ui-monospace, Menlo, monospace; white-space:pre-wrap;' +
'        word-break:break-word; max-height:16rem; overflow:auto; }' +
'  pre.bad { color:#b3261e; }' +
'  footer { margin-top:22px; font-size:11px; color:var(--quiet); }' +
'</style>' +
'<main>' +
'  <h1>GTD bridges</h1>' +
'  <p class="sub">Run one now instead of waiting for the trigger.</p>' +
'  <ul>' +
'    <? for (var i = 0; i < jobs.length; i++) { ?>' +
'      <li>' +
'        <div class="row">' +
'          <strong><?= jobs[i].title ?></strong>' +
'          <span><?= jobs[i].detail ?></span>' +
'          <button id="b-<?= jobs[i].id ?>" onclick="go(\'<?= jobs[i].id ?>\')">Run</button>' +
'        </div>' +
'        <pre id="o-<?= jobs[i].id ?>" hidden></pre>' +
'      </li>' +
'    <? } ?>' +
'  </ul>' +
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
