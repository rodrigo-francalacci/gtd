/**
 * GTD Capture — the whole extension.
 *
 * It opens a small window at the app's own /capture page with the fields
 * pre-filled. That is the entire design, and the reason is authentication:
 *
 * The app's session cookie is SameSite=Lax, which is deliberate — the OAuth
 * callback is a cross-site redirect back from Google and Strict would withhold
 * the cookie there. Lax sends the cookie on top-level navigations but *not* on
 * a cross-site fetch, and an extension's origin (chrome-extension://) is
 * cross-site. So a popup that POSTed to the API would be signed out on every
 * request, and the tempting fix — SameSite=None — would weaken the app
 * everywhere to save one click here.
 *
 * A navigation is not a fetch. Opening the page carries the cookie, the app
 * gates it exactly as it gates everything else, and the extension needs no
 * credentials, no host permissions and no API of its own.
 */

const DEFAULT_ORIGIN = 'https://gtd-web-ten.vercel.app';

async function appOrigin() {
  const { origin } = await chrome.storage.sync.get('origin');
  return (origin || DEFAULT_ORIGIN).replace(/\/+$/, '');
}

/**
 * A capture window, not a tab.
 *
 * The point of the shortcut is to capture without losing the page you were
 * reading. A tab replaces your context; a small window beside it does not, and
 * it closes itself once the thought is in.
 */
async function openCapture({ title, url, selection }) {
  const params = new URLSearchParams();

  // Selected text is the thought; the page is the reference. With nothing
  // selected the page title is the best guess at what you meant.
  if (selection) params.set('text', selection);
  else if (title) params.set('text', title);
  if (url) params.set('url', url);

  const target = `${await appOrigin()}/capture?${params}`;

  await chrome.windows.create({
    url: target,
    type: 'popup',
    width: 460,
    height: 640,
  });
}

/** Read the selection without a content script — activeTab covers this. */
async function selectionIn(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection()?.toString() ?? '',
    });
    return (result?.result ?? '').trim();
  } catch {
    // chrome:// pages, the web store and PDFs refuse injection. The page title
    // and URL are still worth capturing, so this is not an error.
    return '';
  }
}

async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  await openCapture({
    title: tab.title,
    url: tab.url,
    selection: tab.id ? await selectionIn(tab.id) : '',
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'gtd-capture',
    title: 'Capture to GTD',
    contexts: ['page', 'selection', 'link'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void openCapture({
    title: tab?.title,
    // Right-clicking a link means that link, not the page it sits on.
    url: info.linkUrl || info.pageUrl || tab?.url,
    selection: (info.selectionText ?? '').trim(),
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture') void captureActiveTab();
});

chrome.action.onClicked.addListener(() => void captureActiveTab());
