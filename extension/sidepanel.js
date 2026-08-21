/**
 * The sidebar: two tabs, two destinations.
 *
 * The inbox is a queue to be emptied and a box is a shelf to be kept, and the
 * app is careful that the two never become one thing. The sidebar has to be
 * equally careful, which is why this is tabs rather than a "where should this
 * go" dropdown under one form: the destination changes what you are doing,
 * not just where it lands.
 *
 * Capture text goes through the service worker, where the host-permission
 * same-site behaviour is least ambiguous. Everything else — uploads, the box
 * posts, the box list — is fetched from this page, which is the same extension
 * origin and gets the same treatment; `runtime.sendMessage` serialises as JSON
 * so a `File` cannot cross it anyway.
 */

const DEFAULT_ORIGIN = 'https://gtd-web-ten.vercel.app';

const els = {
  text: document.getElementById('text'),
  tabCapture: document.getElementById('tab-capture'),
  tabBox: document.getElementById('tab-box'),
  paneCapture: document.getElementById('pane-capture'),
  paneBox: document.getElementById('pane-box'),
  boxPicker: document.getElementById('box-picker'),
  boxText: document.getElementById('box-text'),
  boxFiles: document.getElementById('box-files'),
  boxPost: document.getElementById('box-post'),
  boxAttach: document.getElementById('box-attach'),
  boxRecord: document.getElementById('box-record'),
  boxPlace: document.getElementById('box-place'),
  boxPage: document.getElementById('box-page'),
  boxFilePicker: document.getElementById('box-picker-file'),
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

/**
 * Stage files on whichever tab is showing.
 *
 * The drop zone is the whole panel and the paste listener is on the window, so
 * neither can tell which form you meant — but the visible tab can, and it is
 * the only answer that is ever right. A file dropped while looking at the Box
 * tab landing in the inbox would be the sort of quiet misfiling you don't
 * notice until you go looking for it.
 */
function stage(files) {
  const list = [];

  for (const file of files) {
    if (file.size === 0) continue;
    if (file.size > MAX_MB * 1048576) {
      say(`${file.name} is bigger than ${MAX_MB} MB.`, 'bad');
      continue;
    }
    list.push(file);
  }

  if (list.length === 0) return;

  if (activeTab === 'box') {
    boxStaged.push(...list);
    renderBoxFiles();
  } else {
    staged.push(...list);
    renderFiles();
  }
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
/** The message behind a failed response, when the server sent one. */
async function reasonFrom(response, fallback) {
  const body = await response.json().catch(() => null);
  return body?.error ?? `${fallback} (${response.status})`;
}

async function uploadFile(base, parentId, file) {
  const target = { parentType: 'inbox_item', parentId };
  let direct;

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

    if (!session.ok) {
      throw new Error(await reasonFrom(session, 'the app refused the upload'));
    }

    const { uploadUrl } = await session.json();

    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!put.ok) throw new Error(`Drive refused the file (${put.status})`);

    const { id } = await put.json();

    const done = await fetch(`${base}/api/attachments/complete`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...target, driveFileId: id }),
    });

    if (!done.ok) {
      throw new Error(await reasonFrom(done, 'the app could not record it'));
    }

    return { ok: true };
  } catch (error) {
    direct = error instanceof Error ? error.message : String(error);
    console.warn('[gtd] direct upload failed:', direct);
  }

  // The single-request path. Smaller ceiling, no Drive CORS involved.
  try {
    const body = new FormData();
    body.set('parentType', 'inbox_item');
    body.set('parentId', parentId);
    body.set('file', file);

    const proxied = await fetch(`${base}/api/attachments`, {
      method: 'POST',
      credentials: 'include',
      body,
    });

    if (proxied.ok) return { ok: true };

    // Both routes failed. Report the *first* reason: the fallback's own
    // complaint is usually the size limit, which is a consequence of the
    // direct path being unavailable rather than the thing that went wrong.
    return {
      ok: false,
      reason: direct || (await reasonFrom(proxied, 'the upload was refused')),
      signedOut: proxied.status === 401,
    };
  } catch {
    return { ok: false, reason: direct || 'Could not reach the app.' };
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

    if (staged.length > 0 && !result.id) {
      // Nothing to attach to. Say so rather than posting an undefined parent
      // and reporting whatever the server makes of it.
      say('Captured, but the app did not return an id — files not attached.', 'bad');
      els.capture.disabled = false;
      return;
    }

    if (staged.length > 0) {
      const files = [...staged];
      const base = await origin();
      const failures = [];

      let reason = '';

      for (const [index, file] of files.entries()) {
        say(`Uploading ${index + 1} of ${files.length}…`);

        const outcome = await uploadFile(base, result.id, file);
        if (outcome.ok) {
          // Cleared as each one lands, so the list never claims to be finished
          // while bytes are still going — the mistake the app's own capture
          // box made until it lost four photos out of five.
          staged = staged.filter((f) => f !== file);
        } else {
          failures.push(file);
          reason = reason || outcome.reason;
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
          : // The reason, not just the count. "1 of 1 did not upload" tells you
            // nothing you can act on, which is how this landed on you rather
            // than on me.
            `${failures.length} of ${files.length} did not upload — ${reason}`,
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

// ---------------------------------------------------------------------------
// The Box tab
// ---------------------------------------------------------------------------

/**
 * Which form is showing. Read by the shared drop and paste handlers, which
 * cannot tell on their own where a file was meant to go.
 */
let activeTab = 'capture';

/** Staged separately from the inbox's, so switching tabs cannot misfile them. */
let boxStaged = [];

/** Filled once, the first time the Box tab is opened. */
let boxes = [];

function renderBoxFiles() {
  els.boxFiles.replaceChildren(
    ...boxStaged.map((file, index) => {
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
        boxStaged.splice(index, 1);
        renderBoxFiles();
      });

      row.append(name, size, drop);
      return row;
    }),
  );
}

function showTab(name) {
  activeTab = name;

  els.tabCapture.setAttribute('aria-selected', String(name === 'capture'));
  els.tabBox.setAttribute('aria-selected', String(name === 'box'));
  els.paneCapture.hidden = name !== 'capture';
  els.paneBox.hidden = name !== 'box';
  say('');

  // Remembered, because whichever one you use is the one you use: opening the
  // panel on the wrong form every time is a small tax on the whole feature.
  void chrome.storage.sync.set({ tab: name });

  if (name === 'box' && boxes.length === 0) void loadBoxes();
}

/**
 * The boxes, for the picker.
 *
 * Fetched rather than configured: boxes are created and renamed in the app,
 * and a list typed into the extension's options would be wrong the first time
 * either happened.
 */
async function loadBoxes() {
  const base = await origin();

  try {
    const response = await fetch(`${base}/api/boxes`, { credentials: 'include' });

    if (response.status === 401) {
      say('Open the app and sign in, then reopen this panel.', 'bad');
      return;
    }
    if (!response.ok) throw new Error(String(response.status));

    const body = await response.json();
    boxes = body.boxes ?? [];

    if (boxes.length === 0) {
      say('No boxes yet. Make one in the app first.', 'bad');
      return;
    }

    const { boxId } = await chrome.storage.sync.get('boxId');
    const chosen = boxes.some((b) => b.id === boxId)
      ? boxId
      : (boxes.find((b) => b.isDefault) ?? boxes[0]).id;

    els.boxPicker.replaceChildren(
      ...boxes.map((box) => {
        const option = document.createElement('option');
        option.value = box.id;
        option.textContent = box.name;
        return option;
      }),
    );
    els.boxPicker.value = chosen;
  } catch {
    say('Could not reach the app.', 'bad');
  }
}

/**
 * Send one file into a box: our server opens a Drive session, the bytes go
 * straight to Google, our server records the row.
 *
 * The same three steps the bridge script uses, and the reason a scan the size
 * of a book can be filed from here at all — through the app's own function it
 * would meet Vercel's 4.5 MB body cap. The session binds to whichever origin
 * opened it, which here is this extension, and the PUT comes from the same
 * place, so the two agree.
 */
async function uploadToBox(base, boxId, file) {
  const opened = await fetch(`${base}/api/box/ingest`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      step: 'open',
      box: boxId,
      name: file.name,
      mimeType: file.type,
    }),
  });

  if (opened.status === 401) throw new Error('Not signed in.');

  const session = await opened.json();
  if (!session.uploadUrl) throw new Error(session.error ?? 'No upload session.');

  const put = await fetch(session.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!put.ok) throw new Error(`Drive refused the file (${put.status})`);

  const { id } = await put.json();

  const done = await fetch(`${base}/api/box/ingest`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step: 'complete', box: boxId, driveFileId: id }),
  });

  const record = await done.json();
  if (!record.id) throw new Error(record.error ?? 'Could not record it.');

  // Read it now rather than waiting for the cron, which may only run daily.
  // Fire and forget: a failure here leaves it queued, which is fine.
  void fetch(`${base}/api/box/read`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId: record.id }),
  }).catch(() => {});

  return record.id;
}

/** Post whatever is in the Box form: a message, some files, or both. */
async function postToBox(extra = {}) {
  const boxId = els.boxPicker.value;
  if (!boxId) {
    say('Pick a box first.', 'bad');
    return;
  }

  const text = els.boxText.value.trim();
  const files = [...boxStaged];

  if (!text && files.length === 0 && !extra.kind) return;

  els.boxPost.disabled = true;
  const base = await origin();

  try {
    // The message first, so a slow upload never delays the thought. Whether a
    // bare address is a link is decided by the server, using the same rule the
    // app's own composer uses — in one place, so the two cannot disagree.
    if (text || extra.kind) {
      const response = await fetch(`${base}/api/box/post`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ box: boxId, text, ...extra }),
      });

      if (response.status === 401) {
        say('Open the app and sign in, then try again.', 'bad');
        els.boxPost.disabled = false;
        return;
      }

      const body = await response.json();
      if (!body.ok) throw new Error(body.error ?? 'That did not save.');

      // Cleared only once it is actually written — the panel must not claim to
      // be finished while anything is still in flight.
      els.boxText.value = '';
    }

    let failed = 0;
    for (const [index, file] of files.entries()) {
      say(`Uploading ${index + 1} of ${files.length}…`);
      try {
        await uploadToBox(base, boxId, file);
        // Cleared as each one lands, so the list never says "done" while four
        // more are still going.
        boxStaged = boxStaged.filter((f) => f !== file);
      } catch (error) {
        failed += 1;
        say(`${file.name}: ${error.message}`, 'bad');
      }
      renderBoxFiles();
    }

    if (failed === 0) {
      const box = boxes.find((b) => b.id === boxId);
      say(`Filed in ${box ? box.name : 'the box'}.`, 'ok');
    }
  } catch (error) {
    say(error.message ?? 'That did not save.', 'bad');
  } finally {
    els.boxPost.disabled = false;
  }
}

els.tabCapture.addEventListener('click', () => showTab('capture'));
els.tabBox.addEventListener('click', () => showTab('box'));

els.boxPost.addEventListener('click', () => void postToBox());

els.boxAttach.addEventListener('click', () => els.boxFilePicker.click());
els.boxFilePicker.addEventListener('change', () => {
  stage(els.boxFilePicker.files ?? []);
  els.boxFilePicker.value = '';
});

// Enter posts, Shift+Enter makes a paragraph — the chat convention, and the
// same one the app's own box composer uses.
els.boxText.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void postToBox();
  }
});

/** The page you are reading, kept as a link and read for its title and picture. */
els.boxPage.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? current.url;

  if (!/^https?:/.test(url ?? '')) {
    say('That page has no address worth keeping.', 'bad');
    return;
  }

  await postToBox({ kind: 'link', url });
});

/**
 * Where you are, asked for per entry and never watched.
 *
 * An extension holding a live position because you once pressed a button is
 * not a trade anyone agreed to — the same rule the app's composer follows.
 */
els.boxPlace.addEventListener('click', () => {
  if (!navigator.geolocation) {
    say('This browser will not give a location.', 'bad');
    return;
  }

  say('Finding you…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      void postToBox({
        kind: 'location',
        lat: coords.latitude,
        lng: coords.longitude,
      });
    },
    (error) => {
      say(
        error.code === error.PERMISSION_DENIED
          ? 'Location is blocked for this extension.'
          : 'Could not get a location.',
        'bad',
      );
    },
    { enableHighAccuracy: true, timeout: 15000 },
  );
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * The microphone, asked for raw.
 *
 * `{ audio: true }` accepts the browser's defaults, and the defaults are a
 * voice-call processing chain: echo cancellation, noise suppression and
 * automatic gain. That chain is why messaging-app voice notes sound the way
 * they do — it high-passes the bottom out, gates the quiet detail at the top
 * and rides the level. All three off, at 48 kHz, exactly as the app does it.
 *
 * Plain values rather than `exact`: a device that cannot honour one should
 * degrade, not throw and leave you with nothing.
 */
const RAW_AUDIO = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: 48000,
};

/** 128 kbps, against a messaging app's 16–32. Uploads go straight to Drive. */
const BITRATE = 128000;

function bestMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm',
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

let recorder = null;
let recordedChunks = [];
let micStream = null;

async function startRecording() {
  let media;
  try {
    media = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO });
  } catch {
    say('No microphone, or permission was refused.', 'bad');
    return;
  }

  micStream = media;
  recordedChunks = [];

  const mimeType = bestMimeType();
  recorder = new MediaRecorder(media, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: BITRATE,
  });

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  };

  recorder.onstop = () => {
    // The microphone light stays on until every track is stopped, and leaving
    // it lit after a voice note is its own small betrayal.
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;

    const type = recorder.mimeType || 'audio/webm';
    const blob = new Blob(recordedChunks, { type });
    recorder = null;

    els.boxRecord.textContent = 'Record';
    els.boxRecord.classList.remove('recording');

    if (blob.size === 0) {
      say('That recording came out empty.', 'bad');
      return;
    }

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const extension = type.includes('mp4')
      ? 'm4a'
      : type.includes('ogg')
        ? 'ogg'
        : 'webm';

    // Staged rather than posted outright, so a recording can go up with a line
    // about it — which is the difference between a voice note and a voice note
    // you can find again.
    stage([new File([blob], `Voice note ${stamp}.${extension}`, { type })]);
    say('Recorded. Press Post to file it.', 'ok');
  };

  recorder.start();
  els.boxRecord.textContent = 'Stop';
  els.boxRecord.classList.add('recording');
  say('Recording…');
}

els.boxRecord.addEventListener('click', () => {
  if (recorder) recorder.stop();
  else void startRecording();
});

// Open on whichever tab was last used.
void chrome.storage.sync.get('tab').then(({ tab }) => {
  if (tab === 'box') showTab('box');
});
