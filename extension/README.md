# GTD Capture — Chrome extension

Sends the page you're on, or the text you've selected, to your GTD inbox.

## Installing

Not on the Chrome Web Store, and doesn't need to be — it's for one person.

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked**, and pick this `extension/` folder

It defaults to `https://gtd-web-ten.vercel.app`. If your app lives elsewhere,
open the extension's **Details → Extension options** and change it.

## Using it

- **Ctrl+Shift+U** (**⌘⇧U** on a Mac) captures the current page
- **Right-click → Capture to GTD** on a page, a selection, or a link
- The toolbar button does the same as the shortcut

Selected text becomes the capture; the page URL goes in the note, so the title
of the item stays readable in the list. With nothing selected, the page title
is used instead.

The window closes itself once the capture lands.

If the shortcut collides with something else, remap it at
`chrome://extensions/shortcuts`.

## Why it opens a window instead of posting quietly

The app's session cookie is `SameSite=Lax`, deliberately: the Google OAuth
callback is a cross-site redirect back to the app, and `Strict` would withhold
the cookie exactly there and break sign-in.

`Lax` sends the cookie on **top-level navigations** but not on a cross-site
`fetch` — and an extension's origin (`chrome-extension://…`) is cross-site. A
popup that POSTed to the API would therefore be signed out on every request.
The fix people reach for is `SameSite=None`, which weakens the whole app to
save one click here.

Opening the capture page is a navigation, so the cookie travels, the app gates
the request exactly as it gates every other one, and the extension needs no
credentials, no host permissions, and no API of its own. It stays about a
hundred lines and has nothing to keep in sync.

## Permissions, and why each one

- `contextMenus` — the right-click item
- `activeTab` + `scripting` — read the current selection, only when you invoke
  it, only on the tab you invoked it from
- `storage` — remembers your app's address

No host permissions: it never reads a page unless you ask it to, and it never
talks to your GTD app except by opening it.
