/**
 * The sidebar.
 *
 * It does no networking itself — every request goes through the service
 * worker, which is where the host-permission same-site behaviour is least
 * ambiguous. This file is the form and nothing else.
 */

const DEFAULT_ORIGIN = 'https://gtd-web-ten.vercel.app';

const els = {
  text: document.getElementById('text'),
  note: document.getElementById('note'),
  capture: document.getElementById('capture'),
  refresh: document.getElementById('refresh'),
  attach: document.getElementById('attach'),
  picker: document.getElementById('picker'),
  files: document.getElementById('files'),
  status: document.getElementById('status'),
  context: document.getElementById('context'),
  contextTitle: document.getElementById('context-title'),
  contextUrl: document.getElementById('context-url'),
  inbox: document.getElementById('open-inbox'),
};

let current = { title: '', url: '', selection: '' };

/**
 * Staged files, held here rather than handed to the service worker.
 *
 * `chrome.runtime.sendMessage` serialises as JSON, so a `File` cannot cross
 * it — the bytes would arrive as `{}`. The capture text still goes through the
 * worker because that is proven to carry the session cookie; uploads have no
 * choice but to happen in this page, which is the same extension origin and
 * gets the same host-permission treatment.
 */
let staged = [];

const MAX_MB = 512;

function formatSize(bytes) {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function renderFiles() {
  els.files.replaceChildren(
    ...staged.map((file, index) => {
      const row = document.createElement('li');

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = file.name;

      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = formatSize(file.size);

      const drop = document.createElement('button');
      drop.className = 'drop';
      drop.type = 'button';
      drop.textContent = '×';
      drop.title = `Remove ${file.name}`;
      drop.addEventListener('click', () => {
        staged.splice(index, 1);
        renderFiles();
      });

      row.append(name, size, drop);
      return row;
    }),
  );
}

function stage(files) {
  for (const file of files) {
    if (file.size === 0) continue;
    if (file.size > MAX_MB * 1048576) {
      say(`${file.name} is bigger than ${MAX_MB} MB.`, 'bad');
      continue;
    }
    staged.push(file);
  }
  renderFiles();
}

chrome.storage.sync.get('origin').then(({ origin }) => {
  els.inbox.href = `${(origin || DEFAULT_ORIGIN).replace(/\/+$/, '')}/inbox`;
});

function say(message, kind) {
  els.status.textContent = message;
  els.status.className = kind ?? '';
}

/**
 * Fill the form from a page.
 *
 * The selection is the thought and the URL is the reference, so they go in
 * different boxes — a line of query string is unreadable as a title, and the
 * title is what the inbox list shows. Anything already typed is left alone:
 * arriving at a new page must never delete a sentence in progress.
 */
function apply(context) {
  current = context;

  els.contextTitle.textContent = context.title || '';
  els.contextUrl.textContent = context.url || '';
  els.context.hidden = !context.title && !context.url;

  if (!els.text.value.trim()) {
    els.text.value = context.selection || context.title || '';
  }
  if (!els.note.value.trim() && context.url) {
    els.note.value = context.url;
  }
}

// Opened by a gesture that already stashed the page; this is the usual path.
chrome.storage.session.get('pending').then(async ({ pending }) => {
  if (!pending) return;
  apply(pending);

  if (pending.image) {
    stageDataUrl(pending.image);
    // One-shot. The page context is still worth keeping, so only the picture
    // is cleared — reopening the panel must not silently re-add it.
    await chrome.storage.session.set({
      pending: { ...pending, image: null },
    });
  }
});

// Already open when the gesture happened.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'gtd:context') return;
  apply(message.context);
  if (message.context.image) stageDataUrl(message.context.image);
});

els.refresh.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // An explicit request, so this one does overwrite.
  els.text.value = '';
  els.note.value = '';
  apply({ title: tab.title ?? '', url: tab.url ?? '', selection: '' });
  say('');
});

/**
 * Follow the browsing.
 *
 * The sidebar stays open across navigations, so the header must keep saying
 * which page it is about — a stale title is how you capture a link to the
 * article you were reading ten minutes ago. Only the *display* follows; the
 * fields are left exactly as typed, because nothing the browser does should
 * delete a half-written sentence.
 */
async function followActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  current = { title: tab.title ?? '', url: tab.url ?? '', selection: '' };
  els.contextTitle.textContent = current.title;
  els.contextUrl.textContent = current.url;
  els.context.hidden = !current.title && !current.url;
}

chrome.tabs.onActivated.addListener(() => void followActiveTab());
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  // Only when the page itself settles, not on every loading tick.
  if (change.status === 'complete' && tab.active) void followActiveTab();
});

async function origin() {
  const { origin } = await chrome.storage.sync.get('origin');
  return (origin || DEFAULT_ORIGIN).replace(/\/+$/, '');
}

/**
 * Send one file to Drive, the same way the app's own panes do: our server
 * opens a resumable session, the bytes go straight to Google, our server
 * records the row. Nothing large travels through the app's own function.
 *
 * The session is bound to whichever origin opened it — here that is this
 * extension — and the PUT comes from the same place, so the two agree. If
 * Google declines that arrangement the proxy route still works, capped at the
 * platform's 4.5 MB body limit, which is enough for most things grabbed off a
 * web page. Falling back beats failing.
 */
async function uploadFile(base, parentId, file) {
  const target = { parentType: 'inbox_item', parentId };

  try {
    const session = await fetch(`${base}/api/attachments/session`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...target,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
      }),
    });
    if (!session.ok) throw new Error('session');

    const { uploadUrl } = await session.json();

    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!put.ok) throw new Error('put');

    const { id } = await put.json();

    const done = await fetch(`${base}/api/attachments/complete`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...target, driveFileId: id }),
    });
    if (!done.ok) throw new Error('complete');

    return true;
  } catch {
    // The single-request path. Smaller ceiling, no Drive CORS involved.
    const body = new FormData();
    body.set('parentType', 'inbox_item');
    body.set('parentId', parentId);
    body.set('file', file);

    const proxied = await fetch(`${base}/api/attachments`, {
      method: 'POST',
      credentials: 'include',
      body,
    }).catch(() => null);

    return Boolean(proxied?.ok);
  }
}

async function capture() {
  const text = els.text.value.trim();
  const note = els.note.value.trim();
  if (!text && !note && staged.length === 0) return;

  els.capture.disabled = true;
  say('Capturing…');

  const result = await chrome.runtime.sendMessage({
    type: 'gtd:capture',
    // A file on its own is a complete capture, but the row still needs
    // something to be recognised by in the inbox list until it is clarified.
    // Resolved here rather than in the API, which should not have to know that
    // this particular client stages files.
    text: text || (staged.length > 0 ? staged[0].name : ''),
    note,
  });

  if (result?.ok) {
    els.text.value = '';
    els.note.value = '';

    if (staged.length > 0) {
      const files = [...staged];
      const base = await origin();
      const failures = [];

      for (const [index, file] of files.entries()) {
        say(`Uploading ${index + 1} of ${files.length}…`);

        if (await uploadFile(base, result.id, file)) {
          // Cleared as each one lands, so the list never claims to be finished
          // while bytes are still going — the mistake the app's own capture
          // box made until it lost four photos out of five.
          staged = staged.filter((f) => f !== file);
        } else {
          failures.push(file);
        }
        renderFiles();
      }

      // Whatever failed stays staged, so Capture sends it again rather than
      // the file quietly ceasing to exist.
      staged = failures;
      renderFiles();

      say(
        failures.length === 0
          ? `Captured with ${files.length} file${files.length === 1 ? '' : 's'}.`
          : `Captured — ${failures.length} of ${files.length} did not upload. Press Capture to retry.`,
        failures.length === 0 ? 'ok' : 'bad',
      );
      apply(current);
      els.capture.disabled = false;
      return;
    }

    say('Captured.', 'ok');
    // Re-seed from the page still on screen, so a second thought about the
    // same article does not need the button pressed again.
    apply(current);
    els.capture.disabled = false;
    return;
  }

  if (result?.signedOut) {
    // Not a failure worth an error message — the direct call cannot carry the
    // cookie when third-party cookies are blocked, so use the route that
    // always can. The text goes with it, so nothing is retyped.
    say('Opening the app to finish…');
    await chrome.runtime.sendMessage({ type: 'gtd:fallback', text, note });
    els.text.value = '';
    els.note.value = '';
    say('Continue in the window that opened.');
    els.capture.disabled = false;
    return;
  }

  say(result?.error ?? 'That did not save.', 'bad');
  els.capture.disabled = false;
}

els.capture.addEventListener('click', () => void capture());

els.attach.addEventListener('click', () => els.picker.click());
els.picker.addEventListener('change', () => {
  stage(els.picker.files ?? []);
  els.picker.value = '';
});

/**
 * The whole panel is the drop zone. It is narrow enough that aiming at a small
 * target inside it would be irritating, and there is nothing else here a file
 * could sensibly be dropped on.
 */
document.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  document.body.classList.add('dragging');
});

document.addEventListener('dragleave', (event) => {
  if (event.relatedTarget) return; // still inside the panel
  document.body.classList.remove('dragging');
});

document.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  document.body.classList.remove('dragging');
  stage(event.dataTransfer.files);
});

/**
 * Paste a screenshot straight in. Text pasted into a field is left alone —
 * only events actually carrying files are claimed.
 */
document.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.files ?? [])];
  if (files.length === 0) return;
  event.preventDefault();
  stage(files);
});

/**
 * An image brought over by right-clicking it on the page.
 *
 * It arrives as a data URL because the bytes were read inside the page, where
 * `activeTab` already grants access — fetching the image from here would need
 * host permission for whatever site it happens to live on, which is a much
 * bigger ask for a much smaller feature.
 */
function stageDataUrl({ dataUrl, name }) {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/data:([^;]+)/)?.[1] ?? 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  stage([new File([bytes], name || 'image.png', { type: mime })]);
}

// Ctrl/Cmd+Enter commits from either box — the sidebar is a form, and reaching
// for the mouse to finish a two-line capture is the friction this removes.
for (const field of [els.text, els.note]) {
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void capture();
    }
  });
}
