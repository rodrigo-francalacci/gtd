/** Inline handlers are refused by the extension CSP, so this is a real file. */
const field = document.getElementById('origin');
const saved = document.getElementById('saved');

chrome.storage.sync.get('origin').then(({ origin }) => {
  if (origin) field.value = origin;
});

document.getElementById('save').addEventListener('click', async () => {
  const value = field.value.trim().replace(/\/+$/, '');
  await chrome.storage.sync.set({ origin: value });

  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1500);
});
