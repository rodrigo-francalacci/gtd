# GTD — user manual

A personal Getting Things Done system: a three-pane desktop app, the same app
on a phone, and a Chrome sidebar. One user, one Google account.

This manual is about *using* it. `CLAUDE.md` is the companion document about
how it is built and why — if you want the reasoning behind a decision rather
than the behaviour, look there.

---

## Contents

- [The shape of the thing](#the-shape-of-the-thing)
- [Capture](#capture) — getting a thought in
- [Clarify](#clarify) — deciding what it was
- [Engage](#engage) — Now, Waiting for, and the Calendar
- [Organise](#organise) — projects, filing, horizons, contexts
- [The weekly review](#the-weekly-review)
- [Lists](#lists) — candidates, not commitments
- [The Big Box](#the-big-box) — documents, filed by arriving
- [Files](#files) — attachments, documents, previews
- [Search](#search)
- [Views and preferences](#views-and-preferences)
- [The Chrome extension](#the-chrome-extension)
- [The phone](#the-phone) — the whole app, one screen at a time
- [Google](#google)
- [Reading files with AI](#reading-files-with-ai)
- [Keyboard](#keyboard)
- [When something looks wrong](#when-something-looks-wrong)

---

## The shape of the thing

Three panes, left to right, in the manner of old Evernote:

| Pane | What it holds |
|---|---|
| **1 — sidebar** | Every view, grouped: Capture, Engage, Organise, Documents, Lists |
| **2 — list** | Whatever the chosen view lists. **The only pane you can resize** |
| **3 — detail** | The selected row: its title, notes, files, everything else |

A fourth pane appears on the right when you open a file, and takes the space
rather than having a width of its own. Drag the divider on the right of pane 2
to resize it; double-click the divider to return to the default for the current
density.

The sidebar numbers mean different things on purpose:

- **Inbox** — captures waiting to be clarified
- **What can I do now** / **Waiting for** — actions in that state
- **Projects** — active projects
- **Stalled** — active projects with no next action. Shown in the warning
  colour, because it is the one number that is asking you for something
- **File actions** — actions with no project
- **Archive** — finished and dropped projects
- **A box** — documents that have arrived but not yet been read
- **A list** — *candidates*, not total items: what is still undecided

Colour is semantic only. Grey is everything; the three colours mean waiting,
stale, and selected. Nothing is coloured for decoration.

---

## Capture

The point of capture is that it costs nothing. There are no required fields.

**Press `c` from anywhere in the app** and the cursor lands in the inbox
capture box. It yields to whatever field you are already typing in, so `c` in a
search box or a note stays a letter.

A capture is **one piece of text**: the first line is the title, then a blank
line, then the note. Two boxes going in, one column at rest. The inbox list
shows the first line only — an icon tells you a note is there, and reading it
is one click away in the pane. That is deliberate: the list exists to tell
twenty captures apart at a glance, not to be read as prose.

You can also:

- **Paste a screenshot** straight into the page — the listener is on the
  window, not the field, and only claims events carrying files, so pasted text
  behaves normally
- **Drop files** anywhere on the capture area
- **Record audio** — see [Recording](#recording)

**A capture needs text *or* a file, not both.** A photo with no note is a
complete capture; the list falls back to "Photo" or "Voice note" so the row is
still recognisable.

### While files are uploading

The text field clears the moment the row is written — the next thought must not
queue behind Drive. But **the staged files stay visible, counting down**,
because they are still going. Three upload at a time. If you try to leave the
page while bytes are genuinely in flight, the browser will ask you to confirm.

Nothing about a capture is ever rewritten. AI suggestions sit *beside* the
original; clarifying does not edit or delete it either.

---

## Clarify

Open the inbox and pick a row. The right-hand pane asks one question: what is
this?

**Actionable**

| Choice | Means |
|---|---|
| **Next action** | The very next physical step |
| **Waiting for** | Someone else owes you this |
| **Project** | More than one step |
| **Did it** | Under two minutes — already done |

**Not actionable**

| Choice | Means |
|---|---|
| **Park on a list** | Someday, reference, purchases |
| **Trash** | No action, no value |

Trash and "did it" need nothing else — most of what lands in an inbox is
rubbish or already done, and neither should make you scroll past a project
picker. The others ask for a title, and optionally a project and contexts.

The note you wrote at capture becomes the **outcome's** note, so the sentence
explaining why you wrote something down survives the moment it becomes a
commitment.

**Files follow the decision.** A photo captured with a thought re-parents to
the action, project or list item the capture became — stranding it on a
clarified row nobody reopens would lose it. Trash is the exception: no outcome
row, so the file stays on the capture, which keeps the evidence intact.

Clarifying advances to the next row automatically, so you can work down the
queue without reaching for the mouse.

---

## Engage

### What can I do now

Next actions, filtered by context. The filter bar shows only the dimensions you
have actually filled in, so leave the ones you do not use empty.

Contexts are AND across dimensions and OR within one — "at Home, with 30 min,
on low energy" reads exactly as it looks. Actions with no contexts at all
appear only when no filter is active, so an unfiled action never silently
vanishes from every view.

### Waiting for

Actions where someone else owes you something. Each is date-stamped, and
anything untouched for **14 days** is flagged as stale.

**Who you are waiting on is a person, not free text.** It points at a
`person`-dimension context — the same rows that serve the agenda side of
contexts, because the people you chase and the people you have things to raise
with are the same people. Matching ignores case and spacing, so "neil" reuses
"Neil" rather than creating a third one.

The pane tells you how long it has been waiting, and says so plainly once it
has gone stale. **Chased today** re-stamps the date when you have followed
something up, which clears the staleness without pretending the thing arrived.

### Calendar

What is booked, grouped by day — today at the top and forward from there, and
only days that actually hold something. Click an event for its details: when,
where, who is coming and what they answered, any notes, and a link to join if
it is a video call.

**It is read-only, on purpose.** Google Calendar owns your appointments; this is
a window onto them so that "what can I do now" can be answered against a real
day. Every event ends in **Open in Google Calendar**, which is the only thing
here that changes anything. Nothing is written, ever — the permission the app
holds could not do it even if the code tried.

**Choosing which calendars to show.** The control in the header lists every
calendar on your Google account; tick the ones you want. What gets *stored* is
the ones you turned **off**, which is why a calendar you create in Google next
month simply appears — it was never hidden. A calendar deleted at Google stops
being listed, and renaming one changes nothing here, because the link is by id.

Until you touch that control, Google's own ticked state decides — so a calendar
you unticked over there does not come back uninvited. Your first choice here
takes over from it.

Two things worth knowing:

- **Nothing is cached.** The list is read from Google each time you open the
  view, so it always agrees with your calendar. **Refresh** re-reads it
- **Repeating events show as their individual dates**, not as the series. A
  weekly meeting appears on each of its days

It is granted separately from Drive and Gmail, and the app works perfectly well
without it — see [Google](#google).

---

## Organise

### Projects

Projects live in status buckets, all of which are always shown even when empty
— an empty group you cannot see is an empty group you cannot drop into.

| Status | Means |
|---|---|
| **Active** | Committed to now |
| **Standby** | Blocked, with a way back |
| **Someday** | Not now, not never |
| **Completed** / **Dropped** | Finished — lives in the Archive |

**Drag a project across a heading to restage it.** Dropping on Standby asks for
a *return condition* — what would bring this back — rather than parking it with
no way out.

**Stalled** in the sidebar is the same page filtered: active projects with no
next action. It is computed, never stored, so it cannot drift.

Inside a project, actions are split into two buckets:

- **Active** — in "what can I do now"
- **Future** — parked. Recorded and visible, but never reaching the Now view,
  and deliberately *not* satisfying the stalled check. A project whose only
  remaining steps are future still needs a real next action

Drag between the buckets to change an action's status.

**Finishing an action can name its successor.** "Turn into next action" marks
the current one done and inserts a new row carrying the project, contexts and
list position — a new row rather than a rename, so the finished step stays in
the record and the follow-up gets a genuinely fresh age.

### File actions

Projects on the left, loose actions on the right. Drag an action onto a project
to file it. It shows unfiled actions by default; there is a link to show all.

### Areas & goals

Both are parent fields on a project, not standalone lists. The job of this view
is to make the *gaps* visible: an area with no active projects under it, or a
goal with none, is the signal — that is the entire value of a horizon.

### Contexts

The four dimensions are fixed; their contents are yours. Deleting a context
cascades to every action carrying it, so the usage count is shown before you
confirm — and that count includes waiting-on use, not just tags.

### Archive

Completed and dropped projects, dated by when they were *finished* rather than
when they were last edited. A finished project keeps its date if it is
re-archived, so it never migrates between years.

---

## The weekly review

A guided, stepped mode that will not let you skip a section.

1. **Empty the inbox** — every capture gets a decision
2. **Review projects** — confirm each still deserves to be active
3. **Unstick what stalled** — give it a next action, or change its status
4. **Chase what you are waiting on**
5. **Standby and someday** — is the return condition still right?

**Every gate is data, never an assertion.** The inbox is empty or it is not; a
project is stalled or it is not; an item was ticked in *this* session or it was
not. You can revisit a finished step, but you cannot jump past an unfinished
one — and that holds against the URL as well as the buttons.

"Reviewed in this session" is stored, so a refresh cannot reopen a gate you
closed.

---

## Lists

One mechanism, four types: **Someday / Maybe**, **Purchases**, **Reference**,
**Checklist**.

**Nothing on a list is a commitment until promoted.** Promoting spawns a real
action and links the two. That link is what makes the Purchases budget correct:

| Stage | Means |
|---|---|
| **Candidate** | Never promoted — proposed spend |
| **Committed** | Promoted, action still open — ordered, awaiting arrival |
| **Settled** | Promoted action done — money already spent |

The three are mutually exclusive by construction, which is what stops spend
double-counting. A purchase item carries a cost, an optional project, an impact
(*blocks a project / improves things / nice to have*) and where (*online / in
town*). Filters narrow the list; the budget totals stay over the whole list,
because a filtered subtotal masquerading as the budget would mislead.

---

## The Big Box

A box of documents, filed by arriving — named for the box of letters it copies,
where everything important went in, newest on top, and you found things by
remembering roughly when they turned up.

**It is not the inbox and must not become one.** The inbox exists to be
emptied; a box exists to be kept. Filing a document is not a commitment. The
two meet at one place only: you can *link* a document to a project.

### Getting things in

- **Type in the composer and press Enter.** A message that is *only* a web
  address is kept as a link and read for its title, summary and picture;
  anything with words around it stays a note
- **Drop a file**, paste a screenshot, or use the paperclip
- **Record** a voice note
- **Add a place** — asked for at the moment you press it, never watched
- **Scan into a watched Drive folder**, via the Apps Script bridge in
  `scripts/` — this is how paper gets in

### Kinds of entry

`document` (has a file), `note`, `link`, `location`. Only a document is read by
the model; a note is already in its final form.

### Tags

Each box has its own **categories** and **tags** — its vocabulary. The model
*proposes* tags and code disposes: anything invented is dropped, unless the
category is explicitly ticked to allow new values (a city on a fuel receipt,
say). The rule is in code rather than the prompt, because a prompt is a
request: ask for one of five values often enough and you get a sixth, and by
then it is in the database and your filter has two tags meaning the same thing.

Each box also has two prose fields, and they are not the same thing:

- **Instruction** — what these documents *are*. This is what the tagging turns
  on
- **Rules** — what a good title and summary look like. "Include the items
  bought and the final total" is right for receipts and noise anywhere else

### Reading the feed

A box **always groups by day**, in every density — arrival is the filing
system, so it cannot be a preference.

Three filters, and they combine:

- **Tags** — AND. Tesco *and* Fuel means both
- **Types** — OR. Nothing is both audio and a place
- **Date range** — a two-handle slider over the box's whole span

Each facet's counts are taken with the *other* filters applied but not its own,
so picking Audio never leaves Audio as the only type on offer. The filter only
offers tags that would still find something.

**Gallery view** puts a thumbnail on the left of each row and the text on the
right, one entry per row. Drive renders the first page of a PDF, so a scan is
recognisable by its shape long before its title is read.

### Two dates, and they are different facts

**Arrived** is when it reached you; **dated** is what the paper says. A bill
that arrives in August is dated July. The feed orders and groups by arrival,
and arrival is editable — it is the one field that decides where an entry *is*.
The printed date is never touched.

### Other things a box does

- **Move a document to another box** — it keeps the tags both boxes know, and
  is not re-read afterwards, so corrections you made by hand survive
- **Throw away** — trashes the Drive file to the bin, never deletes it
- **Deleting a box refiles its documents** into the default one. The documents
  are the point; the box is only how they were grouped. The default box cannot
  be deleted

---

## Files

Two lists sit in every detail pane, and they are genuinely different:

- **Attachments** — uploaded *to* this thing and belonging to it. Detaching one
  trashes the Drive file
- **Documents** — filed in a box and only *borrowed*. Unlinking leaves it
  exactly where it was

That difference is why linking exists: a parking notice can be a project's
evidence for as long as the project lasts, and a document forever.

### Where uploads go

**Files follow the project, not the thing they are attached to.** An action's
upload lands in its *project's* Drive folder — the project is the unit you go
looking in a year later. Anything with no project goes to `GTD/Inbox`. If the
project has no folder yet, attaching creates it.

Uploads go from your browser straight to Drive, so the ceiling is Drive's
rather than the app's — a large scan or a book is fine. There is a progress bar,
because a 20 MB file over a phone connection with no progress bar is
indistinguishable from one that has stalled.

### Making documents

**New doc**, **New sheet** and **New slides** create an empty Google file
against the thing you are looking at, in the same folder an upload would use.
These have no bytes, and they open in the preview pane as the **real editor**
rather than a read-only render — so you can work on them without leaving.

Their names are pulled *back* from Google, because you rename a document by
typing in its title bar and the app offers no other way. That is the one place
the app does not own the name.

### Sorting

Each of the two lists remembers its own order, and the choice applies to every
pane of that kind:

| Order | Means |
|---|---|
| **Added** | When it arrived. The default |
| **By name** | Case-folded, so "apple" does not land after "Zebra" |
| **By use** | How often you have actually opened it |

**By use** is the one nobody has to maintain. The file you reach for every
fortnight rises on its own; the twenty you filed once sink. Ties break on when
you last opened it, because "opened once, yesterday" is a better row to see
than "opened once, in March".

Grouping by day or by first letter is offered where it means something — never
under **By use**, where the headings would be "3" and "2" and "1", each
repeating the row beside it.

**A row shows exactly one fact — whichever explains its position — and that is
also the one you can click and correct.** Under *Added* it is the date, under
*By use* the count, under *By name* nothing, because the name is already the
whole row. A counter you cannot fix eventually tells you something you know to
be untrue.

### Previewing

A **plain click previews** in the fourth pane. A **ctrl/cmd-click or
middle-click opens Drive**, exactly as every other link on your machine
behaves.

The pane renders images (with zoom and pan), PDFs, plain text, JSON (fetched
and indented, because a minified export is one enormous line), audio and video.
Google files embed their own editor. Anything else falls back to Drive's
preview, which renders far more formats than a browser will.

Bytes are served through the app rather than linked to directly — Drive's
download URLs are not embeddable, which is the whole reason a PDF can render in
a pane at all.

### Recording

Wherever you can attach a file you can record one instead: attachments, the box
composer, and the Chrome sidebar.

The microphone is asked for with **echo cancellation and noise suppression
off**, because those change the *sound* irreversibly — one takes the bottom
out, the other gates the quiet detail at the top, and between them they are why
messaging-app voice notes are unpleasant to hear twice. **Automatic gain is
on**, because it only changes the *level* and leaves the frequency response
alone.

48 kHz, 128 kbps Opus, against a messaging app's 16–32. The recorder shows what
your device actually granted (`48 kHz · mono · full range · auto level`), so a
device quietly ignoring the settings is visible rather than a mystery.

Recordings are **staged, not sent** — you can write a line about one before
posting it, which is the difference between a voice note and a voice note you
can find again.

### Playing audio

In an attachments list, **the row's own icon is the control**: press it to
play, press it again to stop. No player widget appears — in a list of filenames
a full-width transport turns a tidy column into a stack of widgets. One clip
plays at a time across the whole page.

In a box feed a recording *does* get a full player inline, because there it has
no title and no summary and is the one entry you cannot judge without hearing
it.

> **Note:** recordings are stored and playable but **not searchable**. There is
> no speech-to-text provider wired up, so nothing transcribes them, and the
> queue deliberately does not schedule a job that nothing can run.

---

## Search

The box at the top of the sidebar searches **projects, actions, list items,
inbox captures and the text inside files**, in one ranked pass.

It behaves the way a search box is expected to:

- `"quoted phrases"` match as a phrase
- `-exclusions` remove results
- `OR` works
- Malformed input yields nothing rather than an error

Title matches are nudged above body-only matches, so a project called "kitchen"
beats an action that merely mentions kitchens.

A file has no page of its own, so a hit inside one clicks through to the
project, action or list item it hangs off.

---

## Views and preferences

### Three densities

| Density | Shows |
|---|---|
| **Comfortable** | Metadata wrapped onto a second line |
| **Compact** | The old Evernote table view, with columns |
| **Titles only** | Just the line you wrote |

Titles-only is the third question a list gets asked — not "what else is true
about this row" but "what is in this list". It drops the metadata, the columns
and the hairlines, and keeps the controls: a checkbox and a drag grip are how
you *act* on a row rather than facts about it. In a box, it adds a small icon
per row so you can tell an audio note from a PDF from a place.

### The inbox, grouped

In titles-only the inbox cuts into days under centred date chips, newest day
first — the way every messaging app has trained everyone to read one. The other
two densities put a timestamp on every row and stay oldest-first, which is how
you *process* a queue.

### Everything else

- **Theme** — light, dark, or follow the operating system. Dark mode is the
  same greyscale walked backwards
- **Pane width** — drag the divider; double-click to reset
- **Gallery** — per box, list or thumbnails

All of these live in the database rather than in the browser, so they follow the
account and the server can render the right one without a flash.

---

## The Chrome extension

Unpacked, in `extension/`. Load it at `chrome://extensions` with developer mode
on. It defaults to the deployed app; change the address in its options if
needed.

Open it with **Ctrl+Shift+U** (**⌘⇧U**), the toolbar button, or right-click →
*Capture to GTD*. The sidebar stays open while you browse, and its header
follows whichever tab you are on — but only the *display* follows. Anything you
have typed is left alone, because a navigation must never delete a half-written
sentence.

**Two tabs, because there are two destinations.** Inbox is a queue to be
emptied; a box is a shelf to be kept. It opens on whichever you used last.

- **Inbox tab** — selected text becomes the capture and the page URL goes in the
  note, so the title stays readable in the inbox list. **Ctrl+Enter** commits
- **Box tab** — pick a box, then post a note, a link, files, a recording, your
  location, or the page you are reading. The box list is fetched from the app,
  so boxes you create or rename appear without touching the extension

Four ways to bring a file in: the picker, drop, paste, or right-click an image
→ *Capture this image to GTD*. Whatever fails stays in the list so pressing the
button again retries just that.

If it reports being signed out, it opens the app as an ordinary page carrying
your text — you lose a click and nothing else.

---

## The phone

The whole app is on the phone. Every list, every detail pane, every preview,
the boxes, the calendar, the review — not a capture screen with the rest left
behind. What changes is how much of it you can see at once, and that you have a
thumb rather than a mouse.

### The layout

Three things instead of three panes side by side:

- **A drawer** holds what the sidebar holds on a desktop — search, the lists,
  documents, organise, settings, theme, sign out. Open it from **Menu**, and it
  closes the moment you choose something, because choosing is the end of
  navigating.
- **A carousel** holds the rest. The list, then the row you tapped, then the
  file you opened — the same three panes in the same order, one screen at a
  time. Tapping moves you forward; swiping right, or the phone's back gesture,
  moves you back.
- **A bar** stays fixed at the bottom: Menu, and four shortcuts.

The carousel always starts where you are, not where you were. Opening a list
puts you on the list; a link straight to a project opens the project. Leaving a
section closes any file you had open in it, so you never land on a preview from
two taps ago.

### The four shortcuts

**Capture**, **Now**, **Calendar**, **Boxes** — the ones you reach for standing
up. Four, because a fifth at 390px is under a thumb rather than under a
fingertip aimed at it. Everything else is one tap further, behind the menu.

**Boxes** opens a picker — the boxes you have, to open one. The manager, where
vocabularies and Drive folders are configured, is still in the menu: from a
phone you want to open a box, not configure one.

### Capture

**Capture** goes to the phone's own capture screen, not the inbox list — the
inbox is where captures are *processed*, which is a different and slower job.

The whole display is the field. The camera and the microphone are buttons, not
things behind a menu. The destination is chosen before you type: the inbox, or
any box. A half-typed draft is kept in the browser, so a backgrounded tab
discarded mid-word does not lose it, and below the field is a short list of what
you just captured — proof it landed.

It writes through the same path as everything else, so a capture made on the
phone is not a second kind of capture.

### Sharing to it from Android

Install the app first — from Chrome's menu, "Add to home screen". Sharing only
works for an installed app, and the manifest is read at install time, so
reinstall after an update if the share target misbehaves.

After that the app appears in Android's share sheet. Anything shared — a page,
a photo, several photos, text — arrives on the capture screen with the fields
already filled and the destination still yours to choose. A page's address goes
in the note rather than the title, because a line of query string is unreadable
in a list. Apps disagree about which field the address goes in, and it is sorted
out on arrival, so the box is prefilled the same way whatever you shared from.

### What is different from the desktop

**Dragging.** Touch has no drag-and-drop in any form, so anything that was only
a drag needed a second way to ask. Filing an action onto a project is now also a
menu on the action itself, calling the same thing the drag calls. Restaging a
project and moving an action between Active and Future were already buttons.

Still drag-only: manual reordering. The sort control offers name, date and use
instead, which is most of what reordering was for.

**PDFs.** Chrome on Android has no built-in PDF viewer, so a PDF preview is
rendered by Drive rather than by the browser. Everything else previews exactly
as it does on a desktop.

---

## Google

Everything lives under one root: `GTD/Projects/...`, `GTD/Archive/<year>/...`,
`GTD/Box/<name>`, `GTD/Inbox` — in Drive, and mirrored as nested Gmail labels.

**Scopes are deliberately narrow:**

- `drive.file` — only files this app created. It cannot read the rest of your
  Drive
- `gmail.labels` — manages labels, cannot read a single message
- `calendar.readonly` — optional, granted separately, and read-only. It can
  list your calendars and read what is on them; it cannot create, change or
  delete an event. The broader of the two calendar options was chosen
  deliberately: the narrower one cannot list your calendars at all, so a
  second or shared calendar would be missing with no way for the app to know

**Sync is one-way.** The app is the source of truth and pushes; it never reads
changes back. There is no reconciliation, because recreating something you
deleted in Drive would be the app overruling a deliberate act. **Verify links**
on the Google page reports drift instead of fixing it.

Nothing waits on Google inside a request. Mutations queue a job and return; a
background worker drains the queue. Uploads are the one exception — an upload
*is* its payload.

**Links are only made on create and move**, so a project that predates the
Google connection has no folder until you press **Create links for N projects**.
That is a button on purpose: creating folders in someone's Drive is not a thing
to do in the background.

**Run sync now** drains the queue immediately, rather than waiting for the daily
cron.

### If Google disconnects

A refresh token can be withdrawn without telling the app — months unused, a
password change, or a revoke from your Google account page. When that happens
every file stops opening and the queue reports that the token was refused.

**Fix it with "Reconnect Google" on the Google page.** Nothing is lost by
pressing it; it asks for the same two permissions again.

---

## Reading files with AI

Two separate queues, both drained by one daily cron tick.

**Enrichment** reads attachments so search can reach inside them — a
photographed whiteboard, a receipt, a book spine at an angle. A model reads
them rather than an OCR engine, because a literal text detector reads messy
things badly, and because a photo of an object with no text still yields a
sentence worth searching.

Plain text never reaches a model: it is already the thing we want to store.
HTML is stripped of markup first, or every saved page matches every other.

**Box classification** reads documents to give them a title, a summary, the
printed date and tags from that box's vocabulary.

**Without an API key, neither queue claims what it cannot run.** Text still
goes through, and anything needing a model stays pending and untouched — so
adding a key later picks up everything captured in the meantime rather than
finding a pile of failures.

**A document too big to read is filed, not failed.** Over about 12 MB — roughly
a hundred scanned pages — it is recorded with its filename as the title and a
summary saying it was not read. Nothing has gone wrong: the file is in Drive,
it previews, and its name is searchable. It simply has no summary, and a red
row implying a retry would help would be a lie. The limit is about cost, not
capacity: a PDF bills as its extracted text *and* an image of every page, so a
book costs a book.

**Read it now** on a box, or the pane's own button, reads immediately rather
than waiting for the cron.

Environment variables, if you are setting this up: `DATABASE_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_ALLOWED_EMAIL`, `CRON_SECRET`,
`ANTHROPIC_API_KEY` (enrichment), `CHATGPT_API_KEY` or `OPENAI_API_KEY` (box
classification), `BOX_INGEST_SECRET` (the scanner bridge). `BOX_MODEL` and
`ENRICH_MODEL` override the defaults.

---

## Keyboard

| Key | Does |
|---|---|
| `c` | Capture from anywhere. Yields to any focused field |
| `Ctrl`/`⌘` + `V` | Paste a screenshot into a capture or a box |
| `Enter` | Post, in the box composer |
| `Shift` + `Enter` | New paragraph, in the box composer |
| `Ctrl` + `Enter` | Capture, in the Chrome sidebar |
| `Ctrl`/`⌘` + `Shift` + `U` | Open the Chrome sidebar |
| `Esc` | Close a menu |

---

## When something looks wrong

**Files will not open; thumbnails are blank; the queue says the token was
refused.** Google has disconnected. Press **Reconnect Google** on the Google
page.

**A capture's photo did not arrive.** The files live only in the tab until they
land. If you left the page mid-upload, the row is safe but the file is not —
attach it again from the clarify pane.

**A project has no Drive folder.** It predates the Google connection, or was
made before Google was set up. Press **Create links for N projects**.

**The calendar says the API is switched off.** Each Google API is enabled per
project in the Google Cloud console, separately from granting permission. Drive
and Gmail were done long ago; Calendar needs the same. The message links
straight to the page that does it.

**A document sits at "waiting to be read".** The cron runs daily. Press **Read
the N waiting**, or the pane's own read button. If it never reads, check an API
key is set — without one, documents are filed but not read, and the box page
says so.

**A recording is marked failed.** Nothing transcribes audio, so a recording
should never have been queued. Passing it through the pane's read control heals
the row.

**Drag-to-reorder does nothing.** A list sorted by anything other than by hand
has no manual order to write, so the grip is withdrawn rather than offered and
ignored. Switch the sort back.

**Two things disagree about a count.** They should not — the review, the sidebar
and the project list all read the same query. If they ever differ, that is a
bug worth reporting rather than a setting.

---

*A note on what this app does not do: it does not transcribe speech, it does not
read your changes back from Drive, and it does not decide anything on your
behalf. AI output is always a suggestion beside the original, never a
replacement for it.*
