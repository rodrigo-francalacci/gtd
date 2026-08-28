/**
 * GTD — what is inside each project's Drive folder and Gmail label.
 *
 * A third file in the same Apps Script project as the scanner and the email
 * bridge. It reads the same two script properties and touches neither of their
 * settings.
 *
 * ## Why this is a script and not the app
 *
 * The app holds `drive.file` — per-file access to files it created — and
 * `gmail.labels`, which can name labels and cannot open a message. Listing a
 * project folder that you have dropped things into needs `drive.readonly`, and
 * listing the messages under a label needs `gmail.readonly`. Both are
 * *restricted* scopes: published, they need an annual security assessment;
 * unpublished, Google expires the refresh token every seven days — and that is
 * the same token Drive sync and the calendar run on, so the cost is not "the
 * navigator breaks weekly", it is "everything does".
 *
 * This script is bound to one account, reading its own Drive and its own mail,
 * and needs no verification at all. It is the same asymmetry the scanner bridge
 * and the email bridge already run on, used a third time.
 *
 * ## What it does
 *
 * Asks the app which projects have a folder or a label, walks each one, and
 * posts back a tree. The app stores it as a *snapshot* and says how old it is
 * wherever it shows it — opening anything goes to Drive or Gmail, which is the
 * copy that cannot be stale.
 *
 * ## Setting it up
 *
 * 1. Add this file beside `big-box-feed.gs` and `gtd-email.gs`.
 * 2. It uses the same `APP_ORIGIN` and `BOX_INGEST_SECRET` script properties.
 * 3. Run `walkProjectTrees` once by hand to grant Drive and Gmail access.
 * 4. Add a daily trigger for `walkProjectTrees`, or press it in the panel.
 */

/** Bounds. A project folder can hold thousands of files; nobody navigates that. */
var TREE_MAX_DEPTH = 8;
var TREE_MAX_CHILDREN = 200;
var TREE_MAX_MESSAGES = 25;

/** Apps Script kills a trigger at six minutes; stop well before it. */
var TREE_BUDGET_MS = 4 * 60 * 1000;

function treeSettings_() {
  const props = PropertiesService.getScriptProperties();
  const origin = (props.getProperty('APP_ORIGIN') || '').replace(/\/+$/, '');
  const secret = (props.getProperty('BOX_INGEST_SECRET') || '').trim();

  if (!origin) throw new Error('APP_ORIGIN is not set in this script’s properties.');
  if (!secret) throw new Error('BOX_INGEST_SECRET is not set in this script’s properties.');

  return { origin: origin, secret: secret };
}

/**
 * One folder, and everything under it.
 *
 * Depth-first with a shared budget, so a single enormous folder cannot eat the
 * whole allowance and leave the rest of the project unwalked. `more` records
 * what was left out — a reader has to be able to tell "this folder holds four
 * things" from "here are four of them".
 */
function walkFolder_(folder, depth, budget) {
  const node = {
    id: folder.getId(),
    name: folder.getName(),
    kind: 'folder',
    url: folder.getUrl(),
    children: [],
  };

  if (depth >= TREE_MAX_DEPTH || budget.left <= 0) {
    node.more = 1;
    return node;
  }

  var seen = 0;
  var skipped = 0;

  const folders = folder.getFolders();
  while (folders.hasNext()) {
    if (seen >= TREE_MAX_CHILDREN || budget.left <= 0) {
      skipped++;
      folders.next();
      continue;
    }
    budget.left--;
    seen++;
    node.children.push(walkFolder_(folders.next(), depth + 1, budget));
  }

  const files = folder.getFiles();
  while (files.hasNext()) {
    if (seen >= TREE_MAX_CHILDREN || budget.left <= 0) {
      skipped++;
      files.next();
      continue;
    }

    const file = files.next();
    budget.left--;
    seen++;

    node.children.push({
      id: file.getId(),
      name: file.getName(),
      kind: 'file',
      mimeType: file.getMimeType(),
      size: file.getSize(),
      modified: file.getLastUpdated().toISOString(),
      url: file.getUrl(),
    });
  }

  if (skipped > 0) node.more = skipped;
  return node;
}

/**
 * A label, its sub-labels, and the most recent messages under each.
 *
 * Gmail has no tree: `GTD/Projects/Kitchen/Quotes` is a label whose *name*
 * contains slashes, and the hierarchy is a convention in that name. So the tree
 * is rebuilt here from the flat list, which is also why a parent that holds only
 * sub-labels still appears — it exists as a shape even when nothing is filed
 * directly under it.
 */
function walkLabelTree_(path) {
  const all = GmailApp.getUserLabels();
  const prefix = path + '/';

  const root = { id: path, kind: 'label', name: path.split('/').pop(), children: [] };
  const byPath = {};
  byPath[path] = root;

  const names = [];
  for (var i = 0; i < all.length; i++) {
    const name = all[i].getName();
    if (name === path || name.indexOf(prefix) === 0) names.push(name);
  }

  // Shortest first, so a parent is always in place before its child looks for it.
  names.sort(function (a, b) {
    return a.length - b.length;
  });

  for (var j = 0; j < names.length; j++) {
    const name = names[j];
    if (byPath[name]) continue;

    const parentName = name.slice(0, name.lastIndexOf('/'));
    const parent = byPath[parentName] || root;

    const node = {
      id: name,
      kind: 'label',
      name: name.split('/').pop(),
      children: [],
    };

    byPath[name] = node;
    parent.children.push(node);
  }

  // The messages, per label, newest first and capped.
  for (var path_ in byPath) {
    if (!Object.prototype.hasOwnProperty.call(byPath, path_)) continue;

    const node = byPath[path_];
    const label = GmailApp.getUserLabelByName(path_);
    if (!label) continue;

    const threads = label.getThreads(0, TREE_MAX_MESSAGES);

    for (var t = 0; t < threads.length; t++) {
      const messages = threads[t].getMessages();
      const last = messages[messages.length - 1];

      node.children.push({
        id: last.getId(),
        kind: 'message',
        name: last.getSubject() || '(no subject)',
        from: last.getFrom(),
        modified: last.getDate().toISOString(),
        url: 'https://mail.google.com/mail/u/0/#all/' + last.getId(),
      });
    }
  }

  return root;
}

/** Post one project's tree, or the reason there isn't one. */
function postTree_(settings, projectId, drive, gmail, error) {
  const response = UrlFetchApp.fetch(settings.origin + '/api/projects/tree', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + settings.secret },
    payload: JSON.stringify({
      projectId: projectId,
      drive: drive,
      gmail: gmail,
      error: error || null,
    }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    Logger.log(
      '  the app answered ' +
        response.getResponseCode() +
        ': ' +
        response.getContentText().slice(0, 200),
    );
    return false;
  }

  return true;
}

/**
 * Walk every project that has a folder or a label.
 *
 * Bounded by elapsed time rather than by count, because a trigger gets six
 * minutes and a project with a deep folder can take most of one. Whatever it
 * reaches is posted; the rest waits for the next run, which is fine — this is an
 * index, and an index that is one run behind on the last project is still an
 * index.
 */
function walkProjectTrees() {
  const settings = treeSettings_();
  const startedAt = Date.now();

  const listed = UrlFetchApp.fetch(settings.origin + '/api/projects/tree', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + settings.secret },
    muteHttpExceptions: true,
  });

  if (listed.getResponseCode() !== 200) {
    Logger.log(
      'Could not ask the app which projects to walk: ' +
        listed.getResponseCode() +
        ' ' +
        listed.getContentText().slice(0, 200),
    );
    return;
  }

  const projects = JSON.parse(listed.getContentText()).projects || [];
  Logger.log(projects.length + ' project(s) to walk.');

  var done = 0;

  for (var i = 0; i < projects.length; i++) {
    if (Date.now() - startedAt > TREE_BUDGET_MS) {
      Logger.log('Out of time after ' + done + '. The rest go on the next run.');
      break;
    }

    const project = projects[i];
    Logger.log('· ' + project.title);

    var drive = null;
    var gmail = null;
    var error = null;

    if (project.driveFolderId) {
      try {
        drive = walkFolder_(DriveApp.getFolderById(project.driveFolderId), 0, {
          left: 1500,
        });
      } catch (e) {
        error = 'Drive: ' + e.message;
      }
    }

    if (project.gmailLabelId) {
      try {
        /*
         * The app stores Gmail's label *id*, which is what a rename cannot
         * break — but `GmailApp` addresses labels by name and offers no lookup
         * by id. The path is rebuilt from the project title instead, which is
         * the same rule `ensureLabel` used to create it.
         */
        gmail = walkLabelTree_('GTD/Projects/' + project.title);
      } catch (e) {
        error = (error ? error + '; ' : '') + 'Gmail: ' + e.message;
      }
    }

    if (postTree_(settings, project.id, drive, gmail, error)) done++;
  }

  Logger.log('Walked ' + done + ' of ' + projects.length + '.');
}
