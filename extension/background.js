/**
 * GTD Capture — service worker.
 *
 * Two jobs: open the sidebar with the current page's context, and do the
 * network call on the sidebar's behalf.
 *
 * The network call lives *here* rather than in the sidebar page for a reason
 * worth writing down. Chrome treats a request from an extension as same-site
 * when the extension holds host permissions for the target, which is what lets
 * the app's `SameSite=Lax` session cookie travel — no `SameSite=None`, no
 * weakening of the app to suit one client. The service worker is where that
 * behaviour is least ambiguous, and keeping every request in one place means
 * one place to reason about.
 *
 * The exemption does not apply when third-party cookies are blocked. So a 401
 * is not treated as a bug: the sidebar falls back to opening the capture page
 * as an ordinary navigation, which carries the cookie under any setting.
 */

const DEFAULT_ORIGIN = 'https://gtd-web-ten.vercel.app';

async function appOrigin() {
  const { origin } = await chrome.storage.sync.get('origin');
  return (origin || DEFAULT_ORIGIN).replace(/\/+$/, '');
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
    // chrome:// pages, the web store and PDFs refuse injection. The title and
    // URL are still worth capturing, so this is not an error.
    return '';
  }
}

/**
 * What the sidebar should be showing.
 *
 * Kept in `storage.session` rather than passed as a message, because the panel
 * may not be listening yet — it is opening in the same gesture. The panel
 * reads this on load and listens for the message for when it is already open.
 */
async function publishContext(context) {
  await chrome.storage.session.set({ pending: context });
  // Fails harmlessly when nothing is listening, which is the common case.
  chrome.runtime.sendMessage({ type: 'gtd:context', context }).catch(() => {});
}

async function contextForTab(tab) {
  return {
    title: tab?.title ?? '',
    url: tab?.url ?? '',
    selection: tab?.id ? await selectionIn(tab.id) : '',
  };
}

async function openSidebar(tab, context) {
  // Must be called in the same turn as the user gesture, so the panel is
  // opened before anything is awaited that could yield.
  await chrome.sidePanel.open({ windowId: tab.windowId });
  await publishContext(context ?? (await contextForTab(tab)));
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'gtd-capture',
    title: 'Capture to GTD',
    contexts: ['page', 'selection', 'link'],
  });
  chrome.contextMenus.create({
    id: 'gtd-capture-image',
    title: 'Capture this image to GTD',
    contexts: ['image'],
  });
});

/**
 * Read an image the page is already showing, as a data URL.
 *
 * Done *inside the page* on purpose. The bytes are usually in the browser
 * cache already, and fetching them from the extension would need host
 * permission for whichever site the image lives on — a permission over the
 * whole web, to save one file. `activeTab` covers reading from the tab you
 * just right-clicked, and nothing more.
 */
async function imageFromPage(tabId, srcUrl) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [srcUrl],
      func: async (src) => {
        const response = await fetch(src);
        const blob = await response.blob();

        // Base64 inflates by a third and this crosses two process boundaries,
        // so a very large image is left to the file picker instead.
        if (blob.size > 6 * 1024 * 1024) return null;

        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });

        const guess = src.split('/').pop()?.split('?')[0] || 'image';
        const name = /\.[a-z0-9]{2,5}$/i.test(guess)
          ? guess
          : `${guess}.${(blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;

        return { dataUrl, name };
      },
    });

    return result?.result ?? null;
  } catch {
    return null;
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
  await publishContext(await contextForTab(tab));
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  await chrome.sidePanel.open({ windowId: tab.windowId });
  await publishContext(await contextForTab(tab));
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;

  // Opened first and in the same turn as the click, because the gesture that
  // permits it does not survive the await below.
  await chrome.sidePanel.open({ windowId: tab.windowId });

  const image =
    info.menuItemId === 'gtd-capture-image' && info.srcUrl && tab.id
      ? await imageFromPage(tab.id, info.srcUrl)
      : null;

  await publishContext({
    title: tab.title ?? '',
    // Right-clicking a link means that link, not the page it sits on.
    url: info.linkUrl || info.pageUrl || tab.url || '',
    selection: (info.selectionText ?? '').trim(),
    image,
  });
});

/**
 * The sidebar asks; this answers. Returning `true` keeps the message channel
 * open for the async reply, which is the one piece of this API that fails
 * silently and confusingly if you forget it.
 */
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== 'gtd:capture') return;

  (async () => {
    const origin = await appOrigin();

    try {
      const response = await fetch(`${origin}/api/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: message.text, note: message.note }),
      });

      if (response.status === 401) {
        respond({ ok: false, signedOut: true });
        return;
      }

      if (!response.ok) {
        const { error } = await response.json().catch(() => ({}));
        respond({ ok: false, error: error ?? `The app returned ${response.status}.` });
        return;
      }

      respond({ ok: true });
    } catch {
      respond({ ok: false, error: 'Could not reach the app.' });
    }
  })();

  return true;
});

/**
 * The signed-out fallback: open the capture page as a real navigation.
 *
 * A top-level navigation carries a `SameSite=Lax` cookie regardless of
 * third-party cookie settings, so this works when the direct call cannot.
 */
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== 'gtd:fallback') return;

  (async () => {
    const params = new URLSearchParams();
    if (message.text) params.set('text', message.text);
    if (message.note) params.set('url', message.note);

    await chrome.windows.create({
      url: `${await appOrigin()}/capture?${params}`,
      type: 'popup',
      width: 460,
      height: 640,
    });

    respond({ ok: true });
  })();

  return true;
});
