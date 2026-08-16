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
  status: document.getElementById('status'),
  context: document.getElementById('context'),
  contextTitle: document.getElementById('context-title'),
  contextUrl: document.getElementById('context-url'),
  inbox: document.getElementById('open-inbox'),
};

let current = { title: '', url: '', selection: '' };

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
chrome.storage.session.get('pending').then(({ pending }) => {
  if (pending) apply(pending);
});

// Already open when the gesture happened.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'gtd:context') apply(message.context);
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

async function capture() {
  const text = els.text.value.trim();
  const note = els.note.value.trim();
  if (!text && !note) return;

  els.capture.disabled = true;
  say('Capturing…');

  const result = await chrome.runtime.sendMessage({
    type: 'gtd:capture',
    text,
    note,
  });

  if (result?.ok) {
    els.text.value = '';
    els.note.value = '';
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
