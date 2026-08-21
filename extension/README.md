# GTD Capture — Chrome extension

Sends the page you're on, or the text you've selected, to your GTD inbox — or
files a note, a link, a file, a recording or a place into one of your boxes.

## Installing

Not on the Chrome Web Store, and doesn't need to be — it's for one person.

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked**, and pick this `extension/` folder

It defaults to `https://gtd-web-ten.vercel.app`. If your app lives elsewhere,
open the extension's **Details → Extension options** and change it.

## Using it

- **Ctrl+Shift+U** (**⌘⇧U** on a Mac) opens the sidebar for the current page
- **Right-click → Capture to GTD** on a page, a selection, or a link
- The toolbar button does the same

The sidebar stays open while you browse. Selected text becomes the capture and
the page URL goes in the note, so the item's title stays readable in the inbox
list; with nothing selected, the page title is used. **Ctrl+Enter** commits
without reaching for the mouse.

### Files and photos

Four ways in, all landing on the same capture:

- **Attach files** — the ordinary picker
- **Drop** them anywhere on the panel
- **Paste** a screenshot straight in
- **Right-click an image → Capture this image to GTD** — the browser's answer
  to the phone's camera button

Files go from the panel straight to Drive, so the size limit is Drive's rather
than the app's. Anything that fails stays in the list, and pressing Capture
again retries just that.

The image case reads the picture *inside the page*, where `activeTab` already
grants access. Fetching it from the extension would need permission over
whatever site it lives on — permission across the whole web, to save one file.
Very large images are left to the file picker instead.

The header follows whichever tab you're on, so it always says which page you're
about to capture. It only updates the *display* — anything you've typed is left
alone, because a navigation must never delete a half-written sentence.
**Use this page** pulls the current page into the fields deliberately.

If the shortcut collides with something else, remap it at
`chrome://extensions/shortcuts`.

## The Box tab

Two tabs, because they are two genuinely different places. The **inbox** is a
queue to be emptied — everything in it is waiting for you to decide what it is.
A **box** is a shelf to be kept: filing something there is not a commitment, and
nothing there is waiting on you. The app is careful never to let the two become
one thing, and neither is the sidebar. It opens on whichever tab you used last.

Pick a box, then:

- **Type and press Enter.** A message that is *only* a web address is kept as a
  link and read for its title, summary and picture; anything with words around
  it stays a note. The server decides which, using the same rule the app's own
  composer uses — in one place, so the two cannot disagree.
- **Add files**, drop them on the panel, or paste a screenshot. Same path as the
  inbox: straight to Drive, so the ceiling is Drive's.
- **Record** a voice note. Echo cancellation and noise suppression are off,
  because those change the *sound* — one takes the bottom out, the other gates
  the quiet detail at the top, and between them they are why messaging-app
  voice notes are unpleasant to hear twice. Automatic gain is on, because it
  only changes the *level*: the recording arrives usable with its full
  bandwidth intact. 48 kHz, 128 kbps. The recording is staged rather than sent,
  so you can write a line about it first.
- **Add where I am** files a place. Asked for per entry and never watched.
- **Keep this page** files the page you're reading as a link.

The box list is fetched from the app rather than configured here, so boxes you
create or rename appear without touching the extension.

## How it stays signed in

The app's session cookie is `SameSite=Lax`, deliberately: the Google OAuth
callback is a cross-site redirect back to the app, and `Strict` would withhold
the cookie exactly there and break sign-in.

`Lax` normally withholds the cookie on a cross-site `fetch`, and an extension's
origin (`chrome-extension://…`) is cross-site. But Chrome makes one exception:

> Requests from an extension to a third-party are treated as same-site if the
> extension has host permissions for the third-party.

So the sidebar's capture reaches the app signed in — **without** the app having
to relax its cookie to `SameSite=None`, which would weaken it for every client
to suit this one.

That exemption does **not** apply when third-party cookies are blocked. So a
`401` isn't treated as a bug: the sidebar opens the capture page as an ordinary
navigation instead, carrying your text with it. A navigation always carries a
`Lax` cookie. You lose nothing but a click.

Note this is also why the sidebar has its own form rather than embedding the
app: a third-party site framed inside an extension page is **partitioned** by
the extension's origin, so it could never see your session at all.

## Permissions, and why each one

- `sidePanel` — the sidebar itself
- `contextMenus` — the right-click item
- `activeTab` + `scripting` — read the current selection, only when you invoke
  it, only on the tab you invoked it from
- `tabs` — read the title and URL of the tab you're on, so the sidebar can keep
  showing the right page as you browse. This is the broadest thing here: it
  covers tab titles and URLs generally, not just when invoked
- `geolocation` — the Box tab's **Add where I am**. Asked for at the moment you
  press it and never watched; an extension holding a live position because you
  once pressed a button is not a trade anyone agreed to
- `storage` — remembers your app's address, which tab you were last on, and
  which box you last filed into
- host permissions for your GTD app only — what makes the session cookie
  travel, per the exemption above. Nothing else is listed; a different address
  is asked for at the moment you set it in options

It never reads page *content* unless you invoke it, and the only server it
talks to is your own.
