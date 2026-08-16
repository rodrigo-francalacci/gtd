/** Inline handlers are refused by the extension CSP, so this is a real file. */
const field = document.getElementById('origin');
const saved = document.getElementById('saved');

chrome.storage.sync.get('origin').then(({ origin }) => {
  if (origin) field.value = origin;
});

/**
 * Saving a new address needs permission for it.
 *
 * The sidebar's request only carries the session cookie for hosts the
 * extension holds permission for, and the manifest can only name the ones
 * known when it was written. Anything else is asked for here, at the moment
 * you name it, which is also the only moment the prompt makes any sense.
 */
document.getElementById('save').addEventListener('click', async () => {
  const value = field.value.trim().replace(/\/+$/, '');
  if (!value) return;

  let origin;
  try {
    origin = `${new URL(value).origin}/*`;
  } catch {
    saved.textContent = 'That is not a URL.';
    saved.hidden = false;
    return;
  }

  const already = await chrome.permissions.contains({ origins: [origin] });
  if (!already) {
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      // Refusing is a real answer. The sidebar still works — it falls back to
      // opening the capture page, which needs no permission at all.
      saved.textContent = 'Saved. Without permission the sidebar will open the app instead.';
      saved.hidden = false;
      await chrome.storage.sync.set({ origin: value });
      return;
    }
  }

  await chrome.storage.sync.set({ origin: value });

  saved.textContent = 'Saved.';
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1500);
});
