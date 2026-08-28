# GTD Capture — Chrome extension

Sends the page you're on, or the text you've selected, to your GTD inbox — or
files a note, a link, an email, a file, a levelled recording or a place into one
of your boxes.

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
  composer uses — in one place, so the two cannot disagree. That is also where a
  pasted email is recognised, below.
- **Add files**, drop them on the panel, or paste a screenshot. Same path as the
  inbox: straight to Drive, so the ceiling is Drive's.
- **Paste a message identifier** — a Gmail address, a sixteen-character message
  id, an RFC822 `Message-ID` in angle brackets, or `email:` followed by a search
  — and the app writes down that you want that message. The Apps Script bridge
  fetches it on its next run. The panel says *asked for*, not *filed*, because
  nothing has arrived yet.

  A Gmail *permalink* is refused on the spot, with a sentence saying what does
  work: the `FMfcg…` id on the end of one belongs to Gmail's own interface, and
  no API accepts it. Being told immediately beats a link entry called "Gmail"
  with a picture of a login form, which is what a permalink used to become —
  anything following a Gmail address without your cookies sees the sign-in page.
- **Record** a voice note, through the same chain the app records through: a
  high-pass, a levelling `AudioWorklet` with lookahead and a voice-activity gate,
  and a safety clipper. Speech arriving anywhere between −30 and −12 dBFS comes
  out between −5.5 and −1.4.

  All three of the browser's own filters are off, and that is the point. They are
  all *dynamic* — their gain moves with the signal — and they would sit in front
  of a compressor whose whole job is to respond to level, so it ends up chasing a
  thing that is chasing it and the result breathes. Automatic gain comes back on
  only in the fallback below, where nothing better follows it.

  **Voice or Music**, switchable mid-take and never remembered. Music is a true
  bypass with a 30 Hz rumble filter and the limiter left as a safety net —
  because an instrument is not asking the question a leveller answers, and
  pointing one at an acoustic guitar costs nineteen decibels of gain reduction
  and a distorted pick attack. Not remembered, because it is the one setting that
  can ruin a take and you find out on playback.

  A peak and a gain-reduction figure run while you record, which is how a bad
  recording is diagnosed afterwards: a peak that never leaves the floor means the
  microphone; one pinned at the top with ten decibels of reduction means the
  chain was working and the problem is elsewhere.

  48 kHz, 128 kbps, staged rather than sent so you can write a line about it
  first. If the app cannot be reached the recording still happens, unprocessed,
  and the panel says so — a voice note quieter than it should be is worth having,
  and one you were misled about is not.
- **Add where I am** files a place. Asked for per entry and never watched.
- **Keep this page** files the page you're reading as a link.

The box list is fetched from the app rather than configured here, so boxes you
create or rename appear without touching the extension.

### Why the recording settings are fetched

The sidebar files into the same boxes as the app's composer, so a voice note made
here and one made there had better be the same sound. They were not: the app grew
a leveller and this recorded the bare microphone, which is precisely the quiet,
uneven recording the app had just stopped producing.

A copy of the chain would be two definitions of a thing that has been retuned
three times, and they disagree the first time either moves — with no symptom
except one recording that sounds unlike the rest. So the split follows the line
Manifest V3 draws:

- **The settings are fetched** from `/api/record-profiles`. They are numbers, not
  code, so they still live in exactly one place.
- **The worklet is local, and has to be.** Extension pages are pinned to
  `script-src 'self'`, an `AudioWorklet` module is script, and loading one from
  the app would be remote code — which MV3 forbids. `voice-leveller.js` here is a
  byte-identical copy of the app's, and `scripts/check-extension-sync.mjs` fails
  the moment it stops being one. Run it after touching either.

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
