# Working in this repo

`gtd-app-brief.md` is the product spec. It wins over anything inferred from the
code — if the code contradicts it, the code is wrong.

**Next.js 16 has breaking changes from older training data.** Read
`apps/web/node_modules/next/dist/docs/` before writing app code. `params` and
`searchParams` are Promises; `revalidateTag` takes a cacheLife argument;
Turbopack is the default; `middleware` is now `proxy`.

## Conventions that carry weight

- **Dark mode is the same ramp walked backwards.** `grey-800` means "prominent
  text" and `grey-200` means "a hairline" in both themes, so inverting the
  greyscale variables under `[data-theme='dark']` is the whole of it — no
  component knows which theme it is in. The semantic three keep their hues and
  drop their brightness. A null preference means "ask the operating system",
  which a media query answers before first paint; an explicit choice writes
  `data-theme` on `<html>` from the *root* layout and beats the query in both
  directions. That's also why `/signin` gets the theme: it renders outside the
  app shell.
- **Colour is semantic only.** Base is greyscale (`grey-50`…`grey-900`,
  `paper`, `ink`). The only colour tokens are `waiting`, `stale`, and
  `selected`, plus their `-bg` pairs. Nothing decorative. Sidebar icons are
  monochrome strokes for this reason — no emoji, no colour.
- **`future` actions are parked, not next.** They stay on the project, never
  reach the Now view, and deliberately don't satisfy the stalled check — a
  project whose only remaining steps are future still needs a real next action.
  Dragging between the Active and Future buckets sets the status.
- **A cross-list drop must be allowed to bubble.** `SortableList` ignores drops
  of items it doesn't contain (no `preventDefault`, no `stopPropagation`) so an
  enclosing `ActionBucket` or `ProjectBucket` can act on them. Reorder-within
  and move-between share one drag type. A bucket that highlights on `dragover`
  must clear that highlight in the *capture* phase — a reorder handled inside
  it stops the bubble, so a bubble-phase handler would never see the drop and
  the highlight would stick.
- **Project status buckets are always rendered.** Active, Standby and Someday
  appear on `/projects` even when empty, because an empty group you can't see
  is an empty group you can't drop into. Dropping on Standby opens the return
  condition prompt rather than parking the project with no way back.
- **Finishing an action can name its successor.** `turnIntoNextAction` marks
  the current one done and inserts a new row carrying the project, contexts and
  list position. A new row rather than a rename: the finished step stays in the
  record, and the follow-up gets a genuinely fresh `created_at` instead of
  inheriting the age of the step before it.
- **Who you're waiting on is an entity, not free text.** `actions.waiting_on_id`
  points at a `person`-dimension context — the same rows that serve the agenda
  side of contexts, because the people you chase and the people you have things
  to raise with are the same people. `resolveParty` matches case- and
  whitespace-insensitively so "neil" reuses "Neil"; without that you end up
  chasing three different Neils and a rename fixes only one of them.
- **Contexts are user data, not an enum.** The four *dimensions* are fixed;
  their contents are managed at `/contexts`. Deleting one cascades through
  `action_contexts`, so the UI shows the usage count before confirming.
- **Two list densities.** `comfortable` wraps metadata onto a second line;
  `compact` is the old Evernote table view. Column sets live in
  `lib/columns.ts`; the header and the rows share one grid template, and
  `leading` keeps the first column label aligned over the titles.
- **UI preferences live in the `preferences` table**, one row pinned to
  `SINGLETON` — not a cookie or localStorage. The server needs them to render
  without a flash, and in the database they follow the account rather than the
  browser, which still holds once the phone app exists. Read with
  `getPreferences()`; constants and pure helpers that Client Components need
  are in `lib/pane.ts` (no `server-only`), while `lib/view-mode.ts` does the
  query.
- **The pane width is written once, on pointer-up.** The resize follows the
  cursor in local state; persisting each `pointermove` would be a request per
  pixel. `ResizablePane` serves both the list pane and the preview pane; `edge`
  signs the drag delta, because a pane on the right of the window grows as the
  cursor moves *left*. `defaultWidth` is what a double-click returns to and is
  deliberately separate from `initialWidth` — resetting to the saved width is a
  no-op, which is what the handle silently did for months.
- **Font is Source Sans**, Evernote's UI typeface until they moved to Inter in
  January 2024 — the era this three-pane layout copies. Self-hosted via
  `next/font`, no runtime request.
- **Google IDs, never names or paths.** `drive_folder_id` / `gmail_label_id`
  hold IDs so a rename in Drive can't break the link.
- **Sync is one-way.** The app is the source of truth and pushes to
  Drive/Gmail. There is no reconciliation — `verifyLinks` reports drift, it
  doesn't fix it. Recreating something the user deleted in Drive would be the
  app overruling a deliberate act.
- **Never call Google inside a request — except an upload.** Mutations
  `enqueueSync(...)` and return; the cron worker at `/api/cron/sync` drains
  `sync_jobs`. A serverless request must not wait on Drive. Jobs are claimed
  with `FOR UPDATE SKIP LOCKED`, and retries back off only for transient
  failures — a revoked token or a 4xx will never succeed on retry.
  `POST /api/attachments` is the one exception: an upload *is* its payload, and
  queueing it would mean parking the bytes somewhere first, which Drive is.
  That also makes it the one non-idempotent Google call, hence a route handler
  the user retries by hand rather than a job the worker retries blindly.
- **An attachment's name, type and size live in our row.** Every detail pane
  lists attachments, and none of them may wait on Drive for a filename. The id
  is the only thing the two systems share.
- **Files follow the project, not the thing they're attached to.** An action's
  upload lands in its *project's* Drive folder — the project is the unit you go
  looking in a year later, and a folder per action buries it. Anything with no
  project goes to `GTD/Inbox`. If the project has no folder yet, attaching
  creates it there and then: the alternative is filing the upload somewhere the
  user didn't ask for.
- **A project can be half-linked**, precisely because of the above — a Drive
  folder made for an upload says nothing about Gmail. `UNLINKED` in `queue.ts`
  therefore matches *either* id being null, not both; the older `and` quietly
  excluded exactly those projects from the backfill forever.
- **Removing an attachment trashes the Drive file, never deletes it**, and only
  ever a file this app uploaded. If Drive refuses, the row still goes — being
  unable to detach anything because of a problem at Google's end is worse than
  an orphaned file in a bin you can empty.
- **Uploads go from the browser straight to Drive**, so Vercel's 4.5 MB
  request-body cap never applies and the ceiling is Drive's. Three steps:
  `POST /api/attachments/session` picks the folder and opens a resumable
  session, the browser PUTs the bytes to the URL that comes back, and
  `POST /api/attachments/complete` records the row. The access token never
  leaves the server — the session URL is the capability, and it authorises one
  upload of one file into one folder.
- **The session is bound to the origin that opened it.** A server sends no
  `Origin`, so the route forwards the browser's; without it the session works
  from curl and is refused by the page holding the bytes, with nothing but
  "Failed to fetch" to go on. Taken from the request rather than configured, so
  localhost, previews and production are all correct for free.
- **`complete` trusts the id and nothing else.** Name, type and size are read
  back from Drive with `getFile`, so a client cannot make our row disagree with
  the file. `drive.file` does the authorisation: an id for anything this app
  did not create comes back null and is refused.
- **`MAX_UPLOAD_BYTES` (4 MB) still guards the old proxy route**, which stays
  for the single-request case. `MAX_DIRECT_UPLOAD_MB` (512) is a sanity rail,
  not a platform limit — Drive's own is 5 TB.
- **`XMLHttpRequest`, not `fetch`, for the PUT.** `fetch` still cannot report
  upload progress, and a 20 MB file over a phone connection with no progress
  bar is indistinguishable from one that has stalled.
- **Attachment bytes are served through us, never linked to directly.** Drive's
  download URLs aren't embeddable — they want Google cookies and don't survive
  an `<img>` or an `<iframe>`. `GET /api/attachments/[id]/file` puts the file
  on our own origin, which is the whole reason a PDF can render in a pane. It
  streams `upstream.body` rather than buffering, serves
  `Content-Disposition: inline`, and is `Cache-Control: private` — one person's
  file behind one person's session must never sit in a shared cache. The
  session gate is the only authorisation: a uuid in a URL is not one.
- **The preview pane is the fourth column, and its state lives in the shell.**
  `FilePreviewProvider` *is* the flex row, so the pane is a sibling of the
  other three rather than an overlay on top of them. Not a search param: the
  pane belongs to the window rather than the row it was opened from, it should
  survive clicking through to another project, and a param would have to be
  threaded through five pages that each own their own panes.
- **Docs and Sheets are made, not uploaded.** A Docs-editor file has no bytes,
  so `createGoogleFile` is metadata only — the one kind of file the app can
  create with nothing to send. `drive.file` covers it because the app made it.
- **The preview embeds Google's editor, not our proxy.** `alt=media` refuses a
  Docs file outright, and embedding `docs.google.com/…/edit?rm=embedded` is
  what makes it *editable* in the pane rather than merely readable. It runs off
  the browser's Google session rather than the app's OAuth token, so it shows
  whichever account is signed in first (`u/0`) — a permission prompt there is
  the wrong-account case, not a broken link. Everything non-native falls back to
  `drive.google.com/file/d/…/preview`, which renders far more formats than a
  browser will.
- **Anything wanting a Docs file's contents must `export` it.** A sheet comes
  back as CSV, everything else as plain text; `exportTypeFor` owns that choice
  so the enrichment queue and any future caller can't disagree.
- **JSON is fetched and indented, not framed.** A minified export is one
  enormous line and a browser renders it as exactly that. Falls back to raw
  text when it doesn't parse — a file claiming to be JSON and failing is
  precisely when you want to see it.
- **Docs and Sheets names are pulled *from* Google.** This looks like it
  contradicts one-way sync and doesn't: for a project folder the app owns the
  name and a rename in Drive is drift to report, but you rename a *document* by
  typing in its title bar and the app offers no other way to do it. Holding a
  stale copy of a name whose only editor is elsewhere would be the app
  pretending to own something it doesn't. `refreshGoogleNames` runs on the cron
  tick and on "run sync now", and touches Docs-editor files only.
- **Audio and video are fetched into a blob, not pointed at the endpoint.** A
  media element loads over its own path, separate from `fetch`, and negotiates
  ranges before it will admit a duration — easy to get subtly wrong through a
  proxy and hard to tell from a broken file. Handing it bytes it already has
  removes the negotiation. Nothing is lost at a 4 MB ceiling.
- **The proxy honours `Range` anyway**, because Chrome's PDF viewer asks for
  one, and because `Accept-Ranges` is what tells a player it may seek at all.
- **The image viewer keeps zoom and offset in one piece of state.** They were
  two, with the offset set from *inside* the zoom updater — React may call an
  updater more than once, and does in development, so every wheel notch
  compounded the pan and the image shot off screen. One pure update, computed
  from one previous value.
- **A plain click previews; a modified click still opens Drive.** The `href` on
  an attachment is the real Drive URL and only an unmodified left click is
  intercepted, so ctrl/cmd-click and middle-click behave the way every other
  link on the machine does. Detaching the file being previewed closes the pane
  — otherwise it sits there rendering a 404.
- **Everything Google-side lives under one root** (`ROOT` in
  `lib/google/sync.ts`): `GTD/Projects/...` in Gmail, `GTD/Projects/...` in
  Drive. A top-level `Projects` label would scatter through a label list that
  already has its own taxonomy.
- **The archive is split by year** — `GTD/Archive/2026/…`. `containerPath` owns
  that decision for Drive and Gmail alike, so the two can't disagree. The year
  comes from `completed_at`, which is stamped once and kept if the project is
  re-archived, so a finished project never migrates between year folders.
- **Links are only made on create and move.** Nothing sweeps the table, so a
  project that predates the Google connection has no folder or label until
  `backfillProjectLinks` is run from `/connections`. Deliberately a button:
  creating folders in someone's Drive is not a thing to do in the background.
- **Gmail label nesting is naming, and the parents must exist.** The API
  creates literally the name given, so `ensureLabel` walks the path and
  creates every ancestor; a rename into a new container ensures that
  container first.
- **Scopes stay narrow:** `drive.file` (only files this app created) and
  `gmail.labels` (no message access). Widening either would drag the app into
  Google's restricted-scope verification, and neither is needed.
- **Google calls must be idempotent.** The worker retries, and Drive will
  happily create a second folder with the same name — `ensureFolder` and
  `ensureLabel` look before creating.
- **Raw capture is immutable.** AI output is a suggestion layer
  (`inbox_items.ai_suggestion`), never a rewrite of `raw_text` /
  `drive_file_id`. Clarifying doesn't edit or delete the row either: it marks
  it clarified and stamps `outcome` / `outcome_id` beside the original,
  `trashed` included.
- **Capture never blocks on enrichment.** `captureInboxItem` writes the row,
  then attempts a suggestion in a try/catch — a failing suggester must never
  cost you the thought. Suggestions pre-fill the clarify form and commit
  nothing on their own.
- **A captured photo is an `attachment`, not `inbox_items.drive_file_id`.**
  That column holds an id and nothing else — no name, type or size, and no
  enrichment, because both the enrichment queue and the search union key on an
  attachment. A photo stored there would be the one file in the app that can't
  be read, previewed or found, which is the opposite of what capture is for.
  So `attachment_parent_type` has `inbox_item`, and the column stays only
  because a raw capture is immutable and the pre-existing rows still point at
  their file.
- **The row is written before the bytes go up.** `captureInboxItem` returns the
  new id and the client posts each file to `/api/attachments` against it — a
  Server Action caps its body at 1 MB and is the wrong shape for a file. It is
  also the right order: if Drive is down, the thought is already safe and the
  file can be attached again from the clarify pane.
- **The screen must stay honest until the last file lands.** The text field
  clears the moment the row is written — the next thought must not queue behind
  Drive — but the *staged files* stay visible, counting down, because they are
  still going. Clearing them early made a five-photo capture look finished
  while four uploads were still queued, and leaving the page then killed them:
  one photo of five arrived, with nothing recorded about the rest. That is not
  a rare failure, it is what the design did whenever you believed it.
  `uploadCaptureFiles` runs three at a time (nine seconds down to two and a
  half for five files), reports progress, keeps failures staged so Capture
  retries them, and a `beforeunload` guard covers the window where bytes are
  genuinely in flight. There is no server-side queue to resume from — the files
  live only in the tab — which is exactly why the tab must not lie about being
  done.
- **A capture needs text *or* a file, not both.** A photo with no note is a
  complete capture; the list falls back to "Photo" / "Voice note" so the row is
  still recognisable, and the clarify panel seeds its title from the file name.
- **A capture is one `raw_text`: first line the title, blank line, then the
  note.** Two boxes on the way in, one column at rest — splitting the raw
  capture across columns would be the app editing what you typed, and clarify
  already read line one as the title. The note is written into the *outcome's*
  `notes` on clarify, via `docFromText`, because it used to go nowhere: the
  sentence explaining why you wrote something down was dropped at exactly the
  moment it became a commitment. `noteColumns` writes `search_text` alongside
  it — `search_vector` is generated from that column, so notes without it are
  silently unsearchable. `list_items` gained `notes`/`search_text` for this;
  it was title-only before.
- **`docFromText` normalises CRLF.** A textarea submits `\r\n` by
  specification, and a stray `\r` survives `trim()` in the middle of a
  paragraph and ends up in the stored document.
- **The inbox list shows the first line only.** The note lives below it in the
  same `raw_text`, and letting it spill into the list turns a queue you scan
  into a wall of prose — the list exists to tell twenty captures apart at a
  glance. An icon flags that a note is there; reading it is a click away, in
  the pane. Same rule on the phone's "just captured" list.
- **The Chrome extension is a sidebar, and host permissions are what sign it
  in.** `SameSite=Lax` would normally withhold the session cookie from a
  cross-site `fetch`, and `chrome-extension://` is cross-site — but Chrome
  treats an extension's request as *same-site* when it holds host permissions
  for the target, so `POST /api/capture` arrives authenticated without the app
  relaxing its cookie to `SameSite=None`. The fetch lives in the service
  worker, where that behaviour is least ambiguous.
- **The sidebar cannot embed the app.** A third-party site framed inside an
  extension page is partitioned by the extension's origin, so it would never
  see the session. Hence its own small form, and hence `/api/capture` — a
  Server Action speaks a private framework protocol and is not a public API.
- **A 401 from the sidebar is a fallback, not an error.** The host-permission
  exemption does not apply when third-party cookies are blocked, so the sidebar
  opens `/capture?text=&url=` as an ordinary navigation instead, which carries
  a `Lax` cookie under any setting. `getSession` not `requireSession` in that
  route: a redirect to `/signin` is useless to a caller expecting JSON.
- **The URL goes in the *note*, never the title**, because a line of query
  string is unreadable in the inbox list. Extension lives in `extension/`,
  unpacked, not on the Web Store.
- **Files follow the clarify decision.** The photo *is* the thing you captured,
  so re-parenting it to the action, project or list item the capture became is
  what keeps it findable — stranding it on a clarified inbox row nobody reopens
  would lose it. `trashed` is the exception: no outcome row, so the file stays
  on the capture, which is also what keeps the evidence intact. The Drive file
  itself does not move — it stays in `GTD/Inbox`, because moving it is a Google
  call and `sync_jobs.project_id` is non-null, so there is nowhere to queue it
  yet.
- **`c` captures from anywhere.** The barrier is almost never the typing, it is
  that the thought arrives three clicks from the inbox. `CaptureHotkey` yields
  to any focused field — `isContentEditable` included, or the note editor would
  swallow every "c" typed into it — and reaches the capture box through a
  window event, because the two live in different route segments.
- **Pasting a screenshot is the commonest visual capture there is.** The
  listener is on `window`, not the field, and only claims events carrying
  files, so pasted text still behaves normally.
- **Audio is recorded, stored and playable — and not searchable.** There is
  still no speech provider, so `MediaRecorder` output goes up the ordinary
  attachment path and stops there. `enqueueEnrichment` won't queue it, which is
  deliberate: a job nothing can run is a manufactured failure.
- **`/capture` is the phone, and sits outside `(app)`.** That route group *is*
  the three-pane desktop shell, and none of it belongs on a phone held in one
  hand — so this is a sibling of `/signin`, gating on `requireSession()` itself
  because no group layout is doing it. It is not the desktop box made
  narrower: whole screen as the field, thumb-sized targets, camera as a
  first-class button, and no drag-and-drop, which touch doesn't have anyway.
  It writes through the same `captureInboxItem` and `/api/attachments`, so a
  capture made on the phone is not a second kind of capture.
- **The phone draft lives in `localStorage`, and that doesn't contradict
  preferences living in the database.** A preference follows the account; a
  half-typed sentence is worthless on another device, changes every keystroke,
  and exists to survive the one thing phones do freely — discarding a
  backgrounded tab mid-word. `app/manifest.ts` starts at `/capture` rather than
  `/`, because the reason to install it is to capture in one tap.
- **Inputs on the phone are 16px minimum.** iOS Safari zooms the page in when a
  smaller field takes focus. The fix is the type size, never
  `user-scalable=no` — blocking pinch-zoom to stop it is a bad trade.
- **Panels seeded from a selected row need `key={row.id}`.** `useState`
  initialisers only run on mount, so without it a panel keeps the previous
  row's draft. Found again across *every* detail pane — actions, list items,
  projects, areas and goals — where it rendered two records at once: a stale
  title from client state beside a fresh project and contexts from props. That
  is worse than a cosmetic glitch, because saving renames the row you were
  looking at a moment ago. The route-param case (`/projects/[id]`) needs the
  key too: React reconciles the same component in the same position and keeps
  its state across the navigation. If a pane holds a draft, key it — the only
  ones that don't need it are the panes with no `useState` seeded from props.
- **Derived state is derived.** Stalled projects, waiting staleness, and a list
  item's `stage` are computed in queries, never stored, so they can't drift
  from the rows.
- **`completed_at` is the archive's date, not `updated_at`.** Any edit bumps
  `updated_at`, so it can't date an archive. `setProjectStatus` stamps
  `completed_at` on the move to completed/dropped and clears it on reopen.
  `getProjects` excludes archived statuses; the archive has its own query.
- **Nothing on a list is a commitment until promoted.** Promoting is the only
  thing that spawns an action and sets `promoted_action_id`. The budget's
  proposed / committed / already-spent buckets come from `stage`, which is
  derived from that column plus the action's status — they are mutually
  exclusive by construction, which is what stops spend double-counting. Don't
  add a fourth source of truth for "is this ordered".
- **Notes are ProseMirror JSON**, not HTML. Writing notes must also write
  `search_text` (via `extractText`) — the `search_vector` generated column
  builds from it, so skipping it silently removes the row from search.
- **Never hand a ProseMirror document straight to a Server Action.** Its node
  and mark `attrs` are built with `Object.create(null)`, and React's Server
  Action serialiser silently drops objects without `Object.prototype` — no
  error, the property just never arrives. `toPlainJson` in `note-editor.tsx`
  round-trips through JSON first. Without it every link lost its `href`
  between the browser and Postgres.
- **The note editor must not resync from props.** Saving revalidates the
  route, so a fresh `notes` object arrives on every autosave; calling
  `setContent` with it resets the document mid-sentence and discards
  unsaved typing. Switching items is handled by `key={id}` at the call site.
- **`queries.ts` is `server-only`.** Types and pure helpers that Client
  Components need live in `queries.shared.ts`.
- **Manual order is a float, not a rank.** Dropping between two rows writes the
  midpoint of their positions, touching one row. That is what makes reordering
  a *filtered* list correct — the midpoint of two visible neighbours is still
  right globally. Never renumber a list from its visible indices.
- **Optimistic UI holds ids, never row copies.** `SortableList` keeps an
  optimistic id order and always renders content from the latest server props.
  Caching whole rows freezes fields that other mutations change.
- **Long work never blocks a request.** Transcription, OCR, and Drive/Gmail
  sync belong in a background job, not a route handler.

## Structure

- `packages/db` — Drizzle schema (`schema.ts`), Neon client, migrations, seed.
  Ships raw TS; `apps/web` transpiles it via `transpilePackages`.
- `apps/web/src/lib/queries.ts` — all reads. `actions.ts` — all writes.
- `apps/web/src/lib/google/` — `sync.ts` holds the `GoogleSync` interface and
  the naming rules, `client.ts` the Drive/Gmail HTTP calls, `live-sync.ts` the
  real implementation, `queue.ts` the outbox and worker, `attachments.ts` the
  upload path behind `POST /api/attachments`.
- `apps/web/src/lib/auth/` — `session.ts` (server-side sessions),
  `google.ts` (OAuth flow, scopes), `token.ts` (grant + access-token refresh).

## Search

One ranked query in `lib/search.ts` unions projects, actions, list items and
inbox captures. `websearch_to_tsquery`, not `plainto_tsquery`: quoted phrases,
`-exclusions` and `OR` work, and malformed input yields an empty query instead
of throwing. Title matches get a +0.5 rank nudge over body-only matches.

`ts_headline` escapes nothing, so its output is passed through
`sanitiseHeadline`, which strips every tag except the `<mark>` pair Postgres
was asked for. Never render a headline without it.

Attachments **are** in the union now that the enrichment queue fills
`ocr_text`. A file has no page of its own, so a hit carries
`<parent_type>:<uuid>` in `meta` and clicks through to the project, action or
list item it hangs off. The alias is `att`, not `at` — `AT` is a SQL keyword.

## Enrichment

Attachments are read in the background so search can reach inside them.
`enrichment_jobs` is a second queue rather than more kinds on `sync_jobs`:
that one is keyed on a project and pushes *out* to Google, this one is keyed on
an attachment and pulls text *in*. One cron tick drains both.

**Claude reads the files, not an OCR engine.** The things worth photographing
here are messy — a book spine at an angle, a whiteboard, a handwritten note —
and a literal text detector reads those badly. It also means a photo of an
object with no text on it still yields a sentence worth searching.

**Plain text never reaches a model.** It is already the thing we want to store;
sending it would be slower, cost money and paraphrase an exact answer. `text/html`
is stripped of markup first, or the search vector fills with `div` and `href`
and every saved page matches every other.

**Without an API key the queue does not claim what it cannot run.** Text jobs
still go through `TextReader`; anything needing a model stays `pending` and
untouched, so adding a key later picks up everything captured in the meantime
rather than finding a pile of failures. This is why the claim query joins
`attachments` — it filters on mime type before taking the row.

**An empty `ocr_text` is an answer.** A blank page is blank. `''` records "read,
found nothing" where `null` cannot be told apart from "never looked", which is
also what `backfillEnrichment` keys on: it matches attachments with no *job*,
never attachments with no *text*, so a blank page isn't paid for twice.

**Readable types are declared twice, deliberately.** `canRead` guards the
insert in TypeScript; `READABLE` and `READABLE_WITHOUT_MODEL` in `queue.ts`
filter the claim and the backfill count in SQL. They must agree — a type in one
and not the other means rows queued that never run, or files that are never
offered. Docs-editor files and JSON sit in the no-model set because both
resolve to text.

**Audio is the gap.** There is no speech provider wired up, so audio is never
queued — a job nothing can run is a manufactured failure. The `transcribe` job
kind and the `transcription` column are there for when one is.

## Weekly review

Steps are gated on data, never on an assertion: the inbox is empty or it
isn't, a project is stalled or it isn't, an item was ticked in this session or
it wasn't. `clampStep` sends a requested step back to the first incomplete one,
so the gate holds against the URL as well as the buttons.

"Reviewed in this session" is `last_reviewed_at >= reviews.started_at`, which
is why the session is a database row rather than client state — a refresh must
not reopen a gate you closed.

Review counts come from `getProjects()`, not a second query. An earlier
hand-written correlated subquery disagreed with the sidebar and reported every
active project as stalled.

## Drag and drop

Native HTML5 DnD, no library. Each row is independently draggable and
droppable, so a drag works across panes that live in different route segments
without a shared React context.

The payload is only readable on `drop`, but `dataTransfer.types` is readable
during `dragover` — which is why each kind has its own MIME type
(`application/x-gtd-action`, `application/x-gtd-project`). A drop target
inspects the type to decide whether to light up, and the *target* decides what
the drag means: the same action drag reorders within a list or files into a
project depending on where it lands.

Handlers read the dragged id and the insertion point off the drop event rather
than from React state set during `dragstart`/`dragover`, so behaviour doesn't
depend on commit timing.

Caveat: HTML5 DnD has no touch support. This is a desktop view; the phone
capture app is separate.

## Auth

Single user, Google OAuth, allowlisted to one address — `AUTH_ALLOWED_EMAIL`
is the entire authorisation model. Any other Google account is simply not this
user, so the callback refuses it.

**Every Server Action must start with `await requireSession()`.** Actions are
ordinary POST endpoints reachable without ever loading the UI, so gating the
layout only covers reads. There are 42 of them; a missing guard is an open
write endpoint. `(app)/layout.tsx` gates reads and runs before any query.

`/signin` sits outside the `(app)` route group. Putting the gate in the root
layout would redirect the sign-in page to itself.

Sessions are server-side rows with a random 256-bit id in an httpOnly cookie,
so a session can be revoked by deleting the row. `SameSite=Lax`, not Strict:
the OAuth callback is a cross-site redirect back from Google and Strict would
withhold the cookie there.

The stored Google grant keeps the refresh token, which Google returns only on
first consent — a later token response without one must never overwrite it.

## Deployment

Vercel project root is `apps/web`. `@gtd/db` is a workspace dependency, so the
install has to happen at the repo root — if a build reports `Module not found:
@gtd/db`, set the install command to `cd ../.. && npm install`.

**A build must never require runtime secrets.** `next build` evaluates route
modules to collect page data, so anything thrown at module evaluation fails the
build. `packages/db/src/client.ts` connects lazily behind a Proxy for exactly
this reason — it used to throw on a missing `DATABASE_URL` at import and broke
the first Vercel deploy before serving a request. Every route is
`force-dynamic`, so nothing needs the database until a request arrives.

**The cron schedule must be daily.** Hobby accounts reject anything more
frequent, and they reject it when the *deployment is created* — before a build
exists, so nothing appears in the deployments list at all. `vercel.json` landed
in `a427778` with `*/10 * * * *`, and every one of the eighteen pushes after it
silently failed that validation while looking exactly like a dead webhook. If
pushes stop producing deployments, suspect `vercel.json` before the Git
integration.

## Gotchas hit already

- Drizzle subqueries joined into one statement need **distinct** alias names
  (`next_n`, `waiting_n`) or Postgres reports an ambiguous column reference.
- `dotenv` must load before any module reading `process.env` — ESM hoists
  imports, so `import './env'` goes first (see `packages/db/src/env.ts`).
- Every route is `force-dynamic` from the root layout; these panes read live
  rows and must not be prerendered.
