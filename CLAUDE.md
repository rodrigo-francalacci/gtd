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
- **A sidebar entry lights up on its path *and* its query.** "Stalled" is
  `/projects?filter=stalled` — a view of the same page — so comparing paths
  alone lit both it and "Projects", and the guard that replaced it ("anything
  with a query is never active") lit neither, leaving the one view you can only
  reach from the sidebar as the one view the sidebar never showed you were in.
  `exact` exists for the same reason on "Manage lists": its children have
  entries of their own, so a prefix match lit the index as well as the list.
- **Three list densities.** `comfortable` wraps metadata onto a second line;
  `compact` is the old Evernote table view. Column sets live in
  `lib/columns.ts`; the header and the rows share one grid template, and
  `leading` keeps the first column label aligned over the titles. `simple` is
  the third question a list gets asked — not "what else is true about this
  row" but "what is in this list" — so it drops the metadata, the columns and
  the hairlines between rows, and keeps the controls: a checkbox and a drag
  grip are how you act on a row rather than facts about it. Every row type
  renders it through one shared `SimpleRow`, because once the metadata is gone
  an action, a project and a capture are all the same line of text. Row
  components take `mode: ViewMode`, never a `compact` boolean — the boolean
  had no room for a third answer.
- **In a titles-only list, flags go on the right.** A paperclip in front of the
  title indents the rows that have one and leaves the left edge ragged, which
  in a view whose entire content is a column of titles is the one thing there
  is to get right.
- **UI preferences live in the `preferences` table**, one row pinned to
  `SINGLETON` — not a cookie or localStorage. The server needs them to render
  without a flash, and in the database they follow the account rather than the
  browser, which still holds once the phone app exists. Read with
  `getPreferences()`; constants and pure helpers that Client Components need
  are in `lib/pane.ts` (no `server-only`), while `lib/view-mode.ts` does the
  query.
- **The list pane is the only pane you can resize**, because it is the only
  width there is a decision to make about. The detail pane is its content's
  measure and the preview takes what's left, so both follow from that one
  choice and the window. `preferences.preview_pane_width` is dead and kept
  only because dropping a column has nothing on the other side of it.
- **The pane width is written once, on pointer-up.** The resize follows the
  cursor in local state; persisting each `pointermove` would be a request per
  pixel. `edge` signs the drag delta, because a pane on the right of the window
  grows as the cursor moves *left*. `defaultWidth` is what a double-click
  returns to and is deliberately separate from `initialWidth` — resetting to
  the saved width is a no-op, which is what the handle silently did for months.
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
- **The preview takes the space rather than having a width.** It's the thing
  you opened the pane to look at. The shell row carries `data-preview`, and the
  third pane reads it as a group to stop growing (`flex-[0_1_38rem]`, the note
  column’s own measure) — read rather than passed, because that pane is
  rendered five route segments away and "there is something to the right of
  you" isn't worth threading through all of them. `(app)/layout.tsx`'s `<main>`
  needs the same rule: it wraps panes 2 and 3, so capping only the pane inside
  it moves the empty space up one level and still leaves the preview with half
  the window.
  **38rem, not 41.** The inner column is `max-w-[38rem] px-7` and
  `box-sizing: border-box` puts the padding *inside* that figure rather than
  adding to it. Capping at 41 left a 3rem strip down the right of the pane
  that nothing could be drawn in and the preview was not allowed to use.
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
- **A box document's name is pushed the other way, and `drive.file` covers it.**
  A scan arrives named by a camera's timestamp and is then read and titled, so
  `renameBoxFiles` carries that title out to Drive — the mirror of the rule
  above, with the opposite answer because the answer to "who renames this"
  differs. Docs-native files are excluded for exactly that reason. No Apps
  Script and no exported manifest: the scope is per-file access to files the
  app *created*, creating includes renaming, and every box document is
  app-created — the bridge re-uploads through the app's credentials precisely
  so it is. Verified against the live API before it was built on.
- **Drift is found without asking Google.** `box_items.name` is by definition
  the name Drive holds, so a title disagreeing with it is the whole test — no
  per-file read, and a tick where nothing was retitled makes no calls at all.
  The column is written *after* Drive agrees: writing first would leave the app
  certain of a name that was never applied and never retrying, because the
  disagreement it looks for would be gone.
- **The printed date leads the filename.** The scanner bridge already names its
  uploads `2026-01-30 Fuel Receipt — …`, so a bare title regressed against a
  convention already in the folder — and a hundred receipts sorted by the first
  letter of a summary is not a filing system. `doc_date`, matching the feed;
  not doubled when the title already starts with one.
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
- **The calendar is the one thing read *from* Google, and it is read-only.**
  Google Calendar owns appointments outright — there is no create, edit or
  delete anywhere in `lib/google/calendar.ts`, and the detail pane ends in a
  link to Google because that is the only place that changes one. This does not
  contradict one-way sync so much as sit outside it: nothing is being kept in
  step, because nothing is stored. `calendar.readonly` rather than the narrower
  `calendar.events.readonly`, and the difference is not about events: the narrow
  scope cannot enumerate calendars, so it reads only whichever one you name
  (`primary`) and a second or shared calendar would be invisible *with no way
  for the app to know it was missing*. A day view that silently omits a calendar
  is worse than one that shows too much. Granted separately from `SYNC_SCOPES`
  via `?scopes=calendar`, so the calendar stays optional and first sign-in never
  bundles it.
- **The calendar heading carries today's date, formatted on the server.**
  Every other date in the app is cut in the server’s timezone, and a heading
  announcing one day while the chip under the first event says another is the
  app disagreeing with itself in a single glance. A client computing it would
  also be impure in render and a hydration mismatch waiting for midnight.
  `ListPane`’s `titleNote` is for facts as fixed as the heading itself;
  `subtitle` is for what the contents happen to be.
- **`singleEvents=true` is not optional.** Without it a recurring event comes
  back as the *rule* rather than its instances, so a weekly stand-up appears
  once, dated whenever the series began — usually in the past. It is also what
  makes `orderBy=startTime` legal; Google rejects that ordering otherwise.
  Cancelled instances are dropped, and a calendar that fails to read is skipped
  rather than failing the view: one bad subscribed calendar should cost you that
  calendar, not your day.
- **An all-day event is a date with no time, and must be parsed as local
  midnight.** `new Date('2026-08-22')` is UTC by specification, which west of
  Greenwich is the evening of the 21st — a birthday under the wrong heading, for
  some readers and not others. `toDate` in `calendar-view.tsx` appends `T00:00:00`.
  The same trap the date-range slider hit counting epoch days.
- **The calendar is fetched by the client, never the page.** A request must not
  wait on Google, so `/calendar` renders its panes immediately and asks
  `/api/calendar` afterwards — an unreachable Google costs a list that is still
  loading rather than a page that won't open. Nothing is cached or mirrored: a
  stored copy is a second version that can disagree with the real one, and the
  worker runs daily, so a day-stale answer to "what does today look like" is
  worse than none. Selection is local state rather than a search param — the
  only pane in the app where that is right, because the server renders none of
  it and the ids are Google's.
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
  the pane. Same rule on the phone's "just captured" list — `captureLabel` in
  `queries.shared.ts` is that rule, in one place now rather than two that
  disagreed about what an empty capture is called.
- **The inbox is oldest-first, except grouped by day.** Oldest-first is how you
  *process* an inbox; a day-grouped list is read newest-day-down, the way every
  messaging app has trained everyone to read one. So the simple view reverses
  the queue and cuts it into days under centred date chips, and the fallback
  selection follows the *displayed* head so clarifying still advances to the
  row next to the one you just dealt with. Only the simple view groups: the
  other two put a timestamp on every row, where a heading would repeat what the
  rows already say. Days are cut in the server's timezone, which is where every
  other date in this app is formatted — the heading and the timestamps under it
  agree, and making either of them the *user's* timezone is one app-wide change
  rather than something to work around in the inbox.
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
  a `Lax` cookie under any setting.
- **API routes answer with `apiSession()`, never `requireSession()`.** The
  latter redirects to `/signin`, which a `fetch` follows — so the caller gets
  200 and a page of HTML where it expected JSON, and "signed out" becomes
  indistinguishable from "the upload failed". Pages redirect; routes return
  401.
- **The URL goes in the *note*, never the title**, because a line of query
  string is unreadable in the inbox list. Extension lives in `extension/`,
  unpacked, not on the Web Store.
- **The sidebar has two tabs because there are two destinations.** The inbox is
  a queue to be emptied and a box is a shelf to be kept; the app never lets
  those become one thing, so a "where should this go" dropdown under a single
  form would be the wrong shape. The visible tab is also what the shared drop
  and paste handlers read — neither can tell where a file was meant to go, and
  the tab you are looking at is the only answer that is ever right.
  `GET /api/boxes` fills the picker (fetched, never configured: boxes are
  renamed in the app) and `POST /api/box/post` takes notes, links and places,
  since a Server Action is not a public API. Files reuse `/api/box/ingest`.
  Whether a bare address is a link is decided *server-side*, by the same rule
  the app's composer uses, so the two cannot come to different conclusions.
- **The sidebar uploads from the panel, not the service worker.**
  `runtime.sendMessage` serialises as JSON, so a `File` crossing it arrives as
  `{}`. The panel is the same extension origin and gets the same
  host-permission treatment, so it uses the ordinary session/PUT/complete path
  — and the session binds to `chrome-extension://…`, which Google accepts:
  probed before building, it echoes that origin and allows `PUT`. The proxy
  route is kept as a fallback, capped by the platform but needing no CORS.
- **A page image is read inside the page, never fetched by the extension.**
  `activeTab` covers reading from the tab you right-clicked; fetching the image
  from the worker would need host permission over whatever site it lives on —
  the whole web, for one file. It crosses as a data URL, size-capped because
  base64 inflates by a third and it traverses two process boundaries.
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
- **Audio is recorded, stored and playable — and searchable only if you type
  it out.** There is still no speech provider, so `MediaRecorder` output goes
  up the ordinary attachment path and `enqueueEnrichment` won't queue it: a job
  nothing can run is a manufactured failure. The transcript columns were
  therefore unreachable rather than merely unfilled, and the preview pane is
  now the other way to fill them — play the clip and write what you hear.
- **A recording's transport is not the browser's.** Transcribing is a loop of
  back a bit, play, pause, type, and the native control cannot do the first of
  those at all. Play and pause are separate buttons rather than one toggle,
  because a toggle punishes the reflex of hitting pause twice by restarting
  playback in a control you have stopped looking at. The buttons suppress
  `mousedown`, which is the detail the whole design rests on: rewinding must
  not take the caret out of the text you are typing into.
- **`MediaRecorder` can refuse to say how long a clip is.** It writes WebM with
  no Duration element — streaming, and it never goes back to fill it in — so
  `duration` reads `Infinity` and the scrubber has no scale, for exactly the
  files the record button produces. Seeking past any plausible end makes the
  browser settle on a real figure. Guarded, not assumed.
- **A transcript is stored in two places with two different rules, and the
  difference is not cosmetic.** `attachments.search_vector` is generated from
  `transcription`, so writing that column is enough. `box_items.search_vector`
  is generated from `search_text`, so writing `text` alone would store the
  words and leave them unfindable — which is the whole reason to type them.
  `lib/transcripts.ts` owns both, and the box recipe matches
  `updateBoxItemDescription` exactly: two rules for building one column would
  disagree the first time either changed.
- **The preview pane addresses words the way it addresses bytes.** `…/file` is
  the file, `…/transcript` is what it says, on both sides of the app — so the
  pane stays ignorant of which table a file came from, as it always has.
  Routes rather than Server Actions because the pane has to *read* the text and
  is client state with no server component above it; fetching on open is also
  what keeps transcripts out of every list payload.
- **A voice note is levelled before it is encoded, not after.** The microphone
  used to go straight into `MediaRecorder` with `autoGainControl` doing the
  only levelling there was, and it was not enough — the recordings came out
  quiet enough to need the volume turned up, which is the one thing a voice
  note must not need. `lib/voice-chain.ts` now sits between the two: a gentle
  65 Hz high-pass, +14 dB of drive, two `DynamicsCompressorNode`s, makeup, and
  a limiter at −1.2 dBFS, with `MediaRecorder` handed the output of a
  `MediaStreamAudioDestinationNode` rather than the microphone. That ordering
  is what makes it affordable: the processed signal is the only one ever
  encoded, so nothing is decoded and re-encoded and no Ogg muxer is needed —
  which was the reason proper levelling was dropped the first time.
  **It cannot peak-normalise and does not claim to.** Normalising means scaling
  by the loudest sample, and you cannot know that until the recording stops. A
  limiter with a fixed ceiling delivers what normalising was *for* — a known,
  consistent peak — and the first of the two offline normalise passes becomes a
  gain stage with a number on it, which is `DRIVE_DB`.
  **Two compressors, because an optical one releases in two stages.** The
  LA-2A's attack is fixed at about 10 ms and its release is program-dependent:
  roughly half the reduction recovers in a twentieth of a second and the rest
  takes a second or more, which is why it levels a sentence without pumping.
  `DynamicsCompressorNode` has one release time, so two in series approximate
  it — a slow stage setting the average and a fast one catching what pokes
  through, attacking together at the same 10 ms.
  **The numbers were checked against the spec's static curve, not guessed.** At
  −25 dBFS in, the chain gives about 6 dB of reduction and lands near −4 dBFS;
  a first attempt at +18 dB of drive took fifteen decibels off the same input,
  which is a different effect wearing the same name. Re-tune by running that
  curve, not by ear alone.
  **All three of the browser’s filters are off, and that is the point.** They
  are all *dynamic* — their gain moves with the signal — and they sit in front
  of a compressor whose whole job is to respond to level. Feeding it something
  already being modulated means it is chasing a thing that is chasing it: AGC
  moves under the compressor, the compressor answers, and the result breathes.
  Noise suppression is the same mechanism aimed at frequency rather than
  level, and what it removes — breath, room, the tail of a word — does not
  come back. Whatever shapes the dynamics has to be the only thing shaping
  them. The readout now reports a *disagreement*: anything but "full range"
  means a device applied its processing below the browser and would not be
  talked out of it, which is the first thing to suspect when one recording
  sounds unlike the rest.
  The recorder shows a live peak meter and a gain-reduction meter, which is how
  a bad recording is diagnosed afterwards: a bar that never left the left-hand
  end means the microphone, and one pinned at the right with ten decibels of
  reduction means the chain was working and the problem is elsewhere.
  Constraints are plain values, never `exact`: a device that can't honour one
  should degrade, not throw `OverconstrainedError` and leave you with nothing.
  48 kHz mono, and the bitrate is set explicitly (32 kbps — a voice note at the
  size Telegram sends one) because `MediaRecorder`'s default is neither
  documented nor generous.
- **A safety clipper follows the limiter, and it is not decoration.**
  `DynamicsCompressorNode` is feed-forward with no lookahead, so however fast
  the attack a transient gets through before the gain moves. Measured on real
  recordings, the chain was delivering peaks of **+3.8 dBFS** with the limiter
  set to −1.2: it was working, it simply cannot catch the first millisecond of a
  plosive, which is the part that clips. A `WaveShaperNode` is a lookup table,
  so it has no attack to be too slow. Linear below −4.4 dBFS and a `tanh` bend
  above, joined so value *and* slope are continuous — a plain `tanh` over the
  whole range pulls a −6 dBFS signal down by nearly a decibel, which is a
  compressor pretending to be a clipper. Curve sampled across [−2, 2], because
  the input to this stage really does exceed full scale and a table stopping at
  1 makes the browser hard-clip at its last entry.
- **`context.resume()` on the chain, always.** An `AudioContext` built outside a
  user gesture starts suspended, and a suspended graph feeds its destination
  silence — the recording would be the right length, the right size, and empty.
  It is built a moment after `getUserMedia` resolves, which is *usually* still
  inside the gesture; "usually" is not good enough when the failure mode is a
  file of nothing.
- **The recordings were checked by decoding them, not by listening.**
  `decodeAudioData` on the stored files, then peak and RMS: before the chain, a
  voice note measured peak −20.6 dBFS and RMS −55.9; after, peak +3.8 and RMS
  −10.4. That is the whole complaint and the whole fix in two numbers, and it is
  how the clipping above was found. Do this again before changing any constant.
- **Media types are normalised on the way out, in `canonicalMediaType`.** A file
  is typed by whatever produced it, and for audio that is a mess of aliases: an
  iPhone voice memo arrives as `audio/x-m4a`, some recorders say `audio/m4a` —
  which Chrome refuses outright, `canPlayType` returning the empty string. On
  the way *out* rather than at ingest, so the stored type stays a record of what
  the file claimed and the fix reaches every file already in the app. Unknown
  types pass through untouched.
- **The player tries the blob, then the network, then says so.** The blob is
  there because a media element negotiating ranges through a proxy is easy to
  get subtly wrong, and because it is what makes a `MediaRecorder` clip admit to
  a duration — but it is not strictly better. An MP4 with its `moov` at the end,
  which is most of what a phone records, is exactly what the element's own
  loader handles well. So: blob, then the direct URL, then an honest message
  with a download link. What it did before was leave the transport disabled for
  ever, which reads as a broken player rather than an unplayable file and offers
  no way out.
- **A backgrounded tab cannot be used to test media playback.** Chrome suspends
  media element loading when `document.hidden`, and every `<audio>` probe stalls
  at `readyState 0` with neither `loadedmetadata` nor `error` — including one on
  a file that is known to be fine. Diagnosing a playback failure that way
  produces confident nonsense. `decodeAudioData` is unaffected and is the tool
  for automated checks; a media element needs a real, focused window.
- **Markdown, LaTeX and HTML are read *and written* in the preview pane.**
  These are the files where the text *is* the document — nothing is lost by
  showing the source, because the source is all there is — which is what makes
  an editor over the bytes honest here and dishonest over a PDF. `formatOf` in
  `lib/text-formats.ts` decides which format a file is, **from the name first
  and the type second**: Drive types a `.md` as whatever the browser claimed
  when it went up, and the extension is the thing the author actually chose.
  Two views, never nested: Reading is what the file means, Source is what it
  is, and moving between them is the whole activity of writing in these
  formats.
- **The rendered view is a sandboxed frame with everything inlined.**
  `sandbox=""` denies scripts, forms, popups and top-level navigation and gives
  the frame an opaque origin — which is what lets an arbitrary `.html` be shown
  as *itself*, script tags and all, without either running them or quietly
  deleting the author's own markup. An opaque origin cannot fetch our
  stylesheet and a font requested from one fails CORS, so the whole page is
  built as one string. Printing that frame is how a PDF gets made: the
  browser's own dialogue has "Save as PDF" on every platform this runs on, and
  it is a better PDF engine than anything worth writing.
- **A new `srcdoc` on a live iframe does not reliably navigate it.** React sets
  the attribute, Chrome keeps the document it already has, and the pane shows
  the previous rendering — or nothing, if the first render was still empty. It
  looks exactly like a renderer producing no output; the HTML is correct and
  sitting in the attribute the whole time. The frame is therefore keyed on a
  sequence number that changes per rendering, so a fresh element mounts and
  always loads. Anything else that writes `srcdoc` from React needs the same.
- **Maths is MathML, via `temml`, and needs no font shipped with it.** Every
  browser this app runs in renders MathML natively, and it stays *text* — so a
  printed PDF has selectable equations and a screen reader can say them. KaTeX
  was the alternative and would have meant hosting sixty font files out of
  `node_modules`. Both `marked` and `temml` are imported dynamically: they are
  a quarter of a megabyte between them, wanted by one pane, only when a
  document of the right kind is opened in it.
- **Maths comes out of the source before anything else touches it.** In LaTeX
  every character in a maths span is an operator; in markdown, `_i_` inside
  `$x_i$` is read as emphasis and the underscores are eaten. Both renderers
  replace each span with a marker fenced in U+0001 — a character that cannot
  be in the source, unlike any clever sentinel you might pick — and fill it in
  afterwards. Verbatim goes one step earlier still — *before* the comment
  stripper, because a `%` in a code sample is a percent sign and stripping
  comments first ate the rest of every such line.
- **`lib/latex-html.ts` is a reading view, not TeX, and says so on screen.**
  TeX breaks paragraphs by minimising badness, hyphenates from a dictionary,
  kerns from metrics, floats figures and resolves references in two passes.
  None of that happens here and none of it can without shipping a TeX
  distribution — tens of megabytes of WebAssembly plus a texlive tree. What it
  does is answer *what does this file say*: structure, emphasis, lists, tables,
  verbatim, and real maths. Unrecognised commands degrade to their argument
  rather than vanishing, because silently dropping content would make the
  preview lie about what is in the file.
- **`PUT …/file` writes the bytes that `GET …/file` reads**, on an attachment
  and a Big Box document alike — the same symmetry `/transcript` already had
  beside it. The body is the document itself, not JSON wrapping it. Saving is a
  Google call inside a request, under the same exception an upload is: the
  payload *is* the call, and queueing it would mean answering "is it saved?"
  with "not yet". `drive.file` covers writing to a file the app created, the
  same way it covers renaming one.
- **A plain `fetch` is not a Server Action and nothing re-renders after it.**
  `revalidatePath` on the route is not enough on its own — the saved file's
  size sat stale in the list beside the document it belonged to until the
  editor started calling `router.refresh()` itself.
- **Header values are ByteStrings, and `new Headers()` throws rather than
  sanitising.** A file with an em dash in its name took the whole response down
  with a `TypeError` from `Content-Disposition`, which reached the pane as a
  bare 500 reading "that file would not load". Every file in the app with an
  accent, a curly quote or a dash was fine and none of them would open.
  `filenameParams` in `google/serve.ts` emits both RFC 6266 forms: an ASCII
  `filename` and the RFC 5987 `filename*`.
- **Documents are made from one menu, and the grouping in it is the real
  distinction.** Google's three formats are files Google owns and edits; the
  other three are files this app owns and edits in the preview pane, and which
  you pick decides where you will be typing a moment later. Six buttons in a
  pane header is also what overflowed a phone pane and broke the carousel
  swipe once already. A text format is created *with* its starter content by
  `createTextFile` (one multipart request — the payload is a few hundred bytes,
  so the resumable three-step dance would be ceremony); a Google format has no
  bytes and stays `createGoogleFile`. **The extension is part of the name**, or
  `formatOf` cannot recognise the file the app has just created.
- **A day's journal line carries the app's fourth semantic colour.** It is the
  only line in a box you *wrote* — everything around it was filed, sent,
  scanned or pasted — and greyscale can only make it louder or quieter than the
  entries, which is the one thing it is not. Violet because the other three
  meanings are spoken for. The test for a fifth is the same: name a kind of
  content greyscale cannot distinguish, in a comment beside the token.
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
- **A pane never scrolls sideways: `overflow-x: clip`.** Not tidiness — this is
  what stops a styling mistake becoming a navigation bug. A pane sets
  `overflow-y: auto`, and the spec turns the other axis from `visible` into
  `auto` when it does, so one element too wide silently makes the pane a
  horizontal scroller: the sideways swipe then scrolls the pane's contents
  instead of moving the carousel, and the browser scrolling a focused field
  into view shifts the pane under you. That was the "sometimes" in a carousel
  that was sometimes on the wrong pane — caused, of all things, by six
  un-wrappable buttons in the attachments header. `clip`, not `hidden`:
  `hidden` still creates a scroll container, so both symptoms survive it.
  Anything genuinely wider than a phone gets its own `overflow-x: auto`
  container, which still works inside `clip` and keeps its gesture to itself.
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
- **The budget's "what if" ticks are arithmetic, and are stored nowhere.** Not
  the URL, not the database. The three buckets report decisions already taken;
  ticking candidates answers the question you actually have — *can I do these
  two and that one?* — which until now could only be asked by promoting them
  and undoing it. Persisting an idle sum would make it look like a plan, which
  is the line the whole list is built to keep. Its own control rather than the
  row's checkbox: a checkbox on a list means done, and this means suppose. The
  provider wraps both panes and emits no DOM, because the phone's pane track is
  a carousel that counts its children.
- **A finished action is greyed, not struck through.** A project's Done fold is
  the record of how the thing was actually done, read months later by whoever
  does it next; a line through it says disregard. A settled purchase keeps its
  line — that one really is closed. Hence `SimpleRow`'s `muted` (greyed) and
  `struck` (the line) being separate, with `struck` defaulting to `muted` so
  the older callers are unchanged.
- **Deleting an action or a project must take its files with it.**
  `attachments.parent_id` is polymorphic — a plain uuid addressing four tables
  — so it has no foreign key and nothing cascades. Both deletes went through
  `purgeActions`/`purgeFilesOf` for that reason: without it, deleting a project
  cascaded its actions and orphaned every file on all of them at once, rows
  pointing at nothing with their Drive files unreachable. Files are removed one
  at a time because each has a Drive file to *trash* — which is what makes
  "delete all finished steps" safe to offer as a bulk button. A cited Big Box
  document is only unlinked; tidying a project has no business reaching into
  the archive.
- **A link in a note follows on click.** `openOnClick` was false, on the
  reasoning that a click inside an editor places the cursor — true of a text
  editor and wrong here: these notes are read far more often than edited, and
  a link you can't click isn't one. The cursor is still reachable by clicking
  past the link or arrowing into it, and the toolbar edits an existing link
  from anywhere inside it. The `protocols` list is what makes this safe: a
  `javascript:` href in a note would otherwise be a script that runs when
  clicked, and notes hold whatever gets pasted into them.
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
- **Every `await` on the Neon driver is its own HTTP round trip, and the layout
  is on the critical path of every navigation.** Nothing renders until
  `(app)/layout.tsx` answers, so a query added there is added to every click in
  the app. `getSidebarCounts` was five `count()` statements plus a whole
  `getProjects()`, each waiting for the last: 194 ms measured against the real
  database, 11 ms as one statement with seven scalar subqueries. Its stalled
  count must agree exactly with `isStalled` over `getProjects()`, and the
  obvious correlated subquery *does not* — `not exists` against a join of the
  two tables silently counts nothing. Verify a rewrite against `getProjects()`
  on live rows before trusting it.
- **`getProjects` is wrapped in React `cache()`.** It is the most expensive read
  here — two grouped subqueries joined onto every project — and the weekly
  review asks for it three times in one render. Per-request and per-render, so
  nothing is held between navigations and no answer can go stale.
- **A fallback applied *after* a query must not be awaited *before* it.** Nine
  pages did `await getPreferences()` and then `await getDensity(...)`, but the
  density query never needed the preferences row to run — so the app-wide
  default was costing a whole extra round trip on every page. `getView` returns
  the stored density and the layout from the one row they share; callers fetch
  it in parallel with the preferences and pick the fallback afterwards.
- **The database is in London and the functions default to Washington.** That
  turns every round trip from ~10 ms into ~80. It is set in Vercel's project
  settings, not in `vercel.json` — a rejected value there fails deployments
  silently, which has already cost this project eighteen consecutive pushes.
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

## The Big Box

A box of documents, filed by arriving — named for the box of letters it copies,
where everything important went in, newest on top, and you found things by
remembering roughly when they turned up. Filing costs nothing at the moment you
would not spend effort, which is the whole reason it works.

**It is not the inbox and must not become it.** A document is not a commitment
and filing one is not clarifying: the inbox exists to be emptied, a box exists
to be kept. They meet at `box_item_links` and nowhere else.

- **A link, never an attachment.** Detaching an attachment trashes the file it
  points at, so citing a document as a project's resource *that* way would mean
  tidying a project could gut the archive. Linking and unlinking touch nothing
  in Drive. `box_item_links` reuses `attachment_parent_type` because that is
  already the list of things a file can hang off.
- **Ingest goes through an Apps Script, and the scope is why.** `drive.file`
  sees only files the app created, so the app cannot look inside the folder the
  Drive scanner saves to; `drive.readonly` could, and can also read every file
  in the account, and needs Google's verification. The script re-uploads each
  scan through the app's own credentials, which makes the document app-created.
  Narrow scope kept, scanner kept — and the scanner's crop-and-deshadow is what
  makes a photographed letter readable at all. Script and setup in `scripts/`.
- **The bytes never pass through us:** session, PUT straight to Drive,
  complete — the same three steps as an attachment upload, so Vercel's 4.5 MB
  body cap never applies. `POST /api/box/ingest` does steps one and three;
  `BOX_INGEST_SECRET` authorises the script, a session authorises a browser.
- **The upload session binds to whoever will send the bytes.** Drive enforces
  that with CORS, which is a browser mechanism: a browser PUT to a session
  opened with no origin is refused, and a script's PUT carrying no `Origin` at
  all is accepted whatever the session was opened with. So the route passes the
  browser's origin for a session-authorised call and null for a secret-
  authorised one. Verified against the real API in both directions before it
  was written, and then again when passing null for a browser produced a
  "Failed to fetch" indistinguishable from a broken upload.
- **The model proposes tags; code disposes.** What comes back is matched
  against that box's own vocabulary and anything invented is dropped, unless
  the category is explicitly allowed to grow — a city on a fuel receipt. The
  rule is in code and not the prompt because a prompt is a request: ask for one
  of five values often enough and you get a sixth, and by then it is in the
  database and the filter has two tags meaning the same thing. Matching ignores
  case and space, so "tesco" reuses "Tesco" (the `resolveParty` reasoning).
- **`captured_at` and `doc_date` are different facts.** A bill that arrives in
  August is dated July. The feed orders and groups by arrival; the printed date
  is shown beside it. The ingest endpoint accepts the original file's date so a
  backlog files under the days it actually arrived.
- **A box's feed always groups by day**, in every density — unlike the inbox,
  where grouping is the simple view's answer to having no timestamps. Here the
  arrival date *is* the filing system, so it can't be a preference. Both use
  `groupByDay` in `lib/days.ts`.
- **The Drive folder is reconciled at ingest, not at rename.** Renaming a box
  writes one row; `ensureBoxFolder` creates or renames `GTD/Box/<name>` the
  next time a document is filed there. That keeps "never call Google inside a
  request" intact without inventing a queue keyed on a box — the ingest request
  is already carrying a file, so one more Google call there costs nothing.
- **Deleting a box refiles its documents into the default one.** The documents
  are the point; the box is only how they were grouped, and a category turning
  out to be a bad idea should not cost a year of receipts. The `restrict`
  foreign key makes the destructive order impossible rather than merely unwise.
  The default box cannot be deleted at all.
- **No transactions anywhere — the `neon-http` driver has none.** Nothing else
  in the app used one, which is why this only surfaced when the classifier
  first tried to write. Ordering does the work instead: tags are rewritten
  before the row, and `status: 'ready'` is written last, so a failure part-way
  leaves the document pending and the retry redoes all of it.
- **A box is a timeline, not only a filing cabinet.** `box_items.kind` is
  `document | note | location`: a thought about a document belongs beside the
  document, in the order it occurred, not in a separate system you have to
  remember to look in. Only a `document` has a file, and so only a document is
  read by the model — a note is already in its final form and is written
  straight to `ready`. `drive_file_id` is nullable for exactly this reason.
- **The composer posts; Enter sends.** A journal that needs a form filled in is
  a journal you stop keeping. Files go up the same session/PUT/complete path
  the bridge uses, so the browser can put a book in a box without meeting
  Vercel's body cap, and are read immediately rather than waiting for the cron.
- **A pasted address is looked at before it is filed.** A message that is
  *only* a URL becomes a `link`, written immediately with nothing but the
  address and read by the worker — following a link means waiting on a server
  that is nobody's responsibility, and the entry should be in the box the
  moment you press Post. A Maps address resolves to coordinates and the entry
  changes kind to `location`: nobody knew what it was until somebody looked,
  and a place filed as a link is a place you can't find on a map. Prefer the
  `!3d…!4d…` pair over `@lat,lng` — the first is the *place*, the second is
  wherever the camera was, and on a real link those were 250m apart.
- **A link is read by fetching it, so links work with no API key.** The page's
  own metadata gives the title, sentence and picture; with a key its text goes
  through the same classifier as a document so it can carry the box's tags.
  That's why `drainBoxQueue` no longer returns early when there's no key — it
  claims link jobs regardless and only document jobs wait.
- **Fetching a user-supplied URL is done carefully.** http/https only, literal
  private and loopback hosts refused before *and* after the redirect chain, a
  timeout, and a size cap. This app fetches from a server that sits inside a
  network with its own private addresses, a cloud metadata endpoint among them.
- **A link's preview image is proxied like everything else.** Pointing the
  browser at the remote image would tell that host who is reading and when,
  every time the feed scrolls, through a page that is otherwise entirely
  first-party. Stored as a URL rather than copied into Drive: the picture is
  the page's, and a stale one costs a thumbnail rather than the entry.
- **A row is a container with a stretched link, not an anchor wrapping
  everything.** Entries hold real links of their own — the page, a map, an
  address inside a note — and an `<a>` inside an `<a>` is invalid HTML: the
  browser re-parents it, the tree stops matching the server's, and hydration
  fails. One absolutely-positioned `Link` for the click target, and anything
  interactive gets `relative` to sit above it.
- **A place is two numbers.** Turning them into a street name would mean a
  geocoding service, a key and a per-request cost, for something a map link
  answers by itself — and the coordinate is the fact, where the street name is
  an interpretation that goes stale. Geolocation is asked for per entry, never
  watched: an app holding a live position because you once pressed a pin is not
  a trade anyone agreed to.
- **Audio is filed, never queued — and the rule lives in `requeueBoxItem`.**
  Nothing here transcribes speech, so an unreadable type is written straight to
  `ready` instead of queueing a job that can only fail. Putting that only in
  `completeBoxUpload` wasn't enough: the composer asks for every upload to be
  read the moment it lands, which put recordings back in the queue and failed
  them as unreadable. One funnel, one rule, and an already-failed row heals
  when it passes through. The pane offers no read controls for audio either —
  a button that can only fail is worse than no button. It plays inline in the feed, because a
  recording has no title and no summary and is the one entry you cannot judge
  without hearing it — making you open a pane for that is the difference
  between a journal you speak into and one you don't.
- **Throwing a document away trashes the Drive file, never deletes it.** Rare
  on purpose — a box is for keeping things — but a blank page or a duplicate
  scan is real, and a box you cannot take rubbish out of stops being one you
  trust.
- **Reading is driven by the cron, and the cron may only run daily.** So both
  the script and the pane ask for it explicitly: the bridge calls
  `POST /api/box/read` as it files each document, and the pane's "read it now"
  does the same for one. That route exists rather than a Server Action because
  `maxDuration` is a route-segment setting and a scan is a Drive download plus
  a model call. It batches — a few per request, `remaining` in the reply, the
  caller loops — because one long request dies at the function limit halfway
  through with no way to know how far it got. The script's loop is bounded by
  elapsed time, not count: a trigger gets six minutes and a backlog would
  otherwise be cut off mid-file.
- **The script asks the app to read; it never reads.** Moving classification
  back into Apps Script would mean the tag vocabulary, the prompt, the
  validation and a database credential living there too — which is what was
  taken out of it, and the reason the vocabulary is editable at all. Two copies
  drift the first time a tag is added.
- **A box has two prose fields and they are not the same.** `instruction` says
  what these documents *are*, which is what the tagging turns on; `rules` says
  what a good title and summary look like — "include the items bought and the
  final total" is right for receipts and noise anywhere else. They land in
  different places in the prompt.
- **The tag prompt must not make omission the default.** It once said only
  "omit a category rather than forcing a match", and a fuel receipt came back
  without the Receipt tag that sat in a category of its own. It now works
  through every category and judges by what the document *is* rather than the
  words it contains. The failure that phrasing guarded against — an invented
  tag — was never possible: `validateTags` is the gate.
- **A document too big to read is filed, not failed.** `MAX_CLASSIFY_BYTES`
  (12 MB, about a hundred scanned pages) is a *cost* rail, not a platform one:
  Drive's allowance is fifteen gigabytes and OpenAI's own limit is 50 MB per
  request, but a PDF bills as its extracted text *and* an image of every page,
  so a book costs a book. Checked against `size_bytes` before the file is
  fetched, and again against the bytes that arrive — a Google Doc has no size
  until it is exported. Over it, `fileWithoutReading` writes `ready` with the
  filename as the title and a summary saying it wasn't read. Not `failed`:
  nothing went wrong, the file is in Drive and findable by name, and a red row
  implies a retry would help.
- **`max_output_tokens` is set, and a truncated reply is `UnreadableDocument`.**
  `text` asks for a transcription, so the *reply* grows with the document too.
  Without the recognition, a cut-short answer is unparseable JSON, an ordinary
  error, and the same answer bought four more times. The prompt asks for the
  first few pages verbatim and a summary of the rest — the field exists so a
  document can be found again, not so it can be reproduced.
- **The gallery is a preference, not a fourth density.** Densities trade
  metadata for rows and apply everywhere; `box_view` only means anything where
  the things listed have a picture, and a scan is recognised by its shape long
  before its title is read. Day headings survive it — arrival is the filing
  system, and a wall of thumbnails with no sense of when is a folder.
- **Three filters, and they combine.** Tags are AND (all of them), types are
  OR (nothing is both audio and a place, so requiring both would always return
  nothing), and the date range narrows both. Each facet's counts are taken with
  the *other* filters applied but not its own — otherwise picking Audio would
  leave Audio as the only type on offer and there'd be no way back. Every
  filter link is built from the current URL rather than from scratch, or the
  one you weren't touching would silently vanish.
- **The type filter runs in memory, not in SQL.** `entryTypeOf` turns a kind
  and a mime type into one of a dozen words; expressing that again as a pile of
  `like` clauses would be two definitions to keep in agreement — the trap
  `canClassify` and `READABLE` carry a warning about. A box holds tens or
  hundreds of rows, so the filtering costs less than the duplication would.
- **The range control's ends come from the whole box, never the filtered rows.**
  Otherwise the track shrinks under your hand: narrow it once and the ends
  close in, and you can never widen it again. Its handles are local state so
  they follow the cursor, re-seeded by a `key` on the call site rather than an
  effect syncing two sources of truth, and written to the URL on release —
  per-pixel commits would be the pane-resize mistake again.
- **Days are counted from the box's first day, not from the epoch.**
  Epoch-days looked simpler and were wrong: local midnight in a timezone ahead
  of UTC is the previous day in UTC, so dividing by 86,400,000 floors to the
  day before and the label ended up a day behind the URL. `setDate` lets the
  calendar do it, daylight saving included.
- **Moving a document keeps the tags both boxes know.** Matched on the category
  as well as the tag — "Vendor: Shell", not "Shell", or a vendor could land in
  a category about places — and resolved to the *destination's* own rows, since
  the same word in two boxes is two rows. No re-read afterwards: a move is not
  a request to spend money and overwrite what you corrected by hand.
- **A link's picture falls a long way back.** `og:image` is the polite answer
  and plenty of real pages don't give one — an older hand-written page has
  never heard of it, and a modern one can render the tag with an empty
  `content` and mean the same thing. So: the social tags, then
  `apple-touch-icon`, then the first real image on the page (a masthead or a
  logo, which is what makes a site recognisable), then the favicon. Both links
  in the first real test had no `og:image` and both now have a picture.
- **The quick tag bar is flat; the categories live in the browser.** It was a
  row per category with a heading on each, which cost a line per category
  before a single tag was shown — three lines for four chips, and worse the
  more categories a box grows. The heading was rarely the thing you needed:
  "Tesco", "Swindon" and "Receipt" say which axis they are on by being
  themselves. So the bar is one wrapping row of the fifteen tags that would
  narrow the list most, and the question *what tags are there* is answered
  somewhere with room to answer it.
  The exception is a name in two categories — a Shell that is both a vendor
  and a place — and only *those* carry their category, matched case- and
  space-insensitively like every other tag comparison. Labelling every chip to
  cover a collision that usually doesn't exist is what the old layout was
  paying for.
- **What survives the cut is the current count, so the bar moves as you
  filter.** The counts already come from the rows on screen, so after choosing
  Tesco the tags offered next are the ones that still co-occur with it, not the
  box's all-time favourites. Anything chosen is pinned to the front whatever
  its rank: an excluded tag has a count of zero by definition, and dropping it
  would leave no way to undo it.
- **The tag browser borrows the sidebar, and that is one component doing two
  jobs on purpose.** The first column is navigation, and while you are
  filtering a box it is the one column doing nothing — it is already tall,
  narrow and scrollable, which is the shape of a grouped vocabulary. More
  importantly **it is already a drawer on a phone**, so a panel rendered there
  is a modal on a phone and a column on a desktop without either being written
  twice. It widens to `88vw` while lent out: a navigation drawer wants to leave
  the pane behind it visible, a panel you read and type into wants the screen.
  Opening the list over the *list* was the alternative and is wrong — the list
  is what you are filtering, and covering it means choosing tags blind.
- **`SidebarSlotProvider` holds the state; the panel portals in from the box
  page.** The thing that knows what the tags are is four route segments below
  the column it wants, which is the same problem `FilePreviewProvider` solves
  the same way. The portal target is a `display: contents` div rendered by
  `SidebarSlotTarget` rather than a `ref={slot.attach}` in the shell: the
  compiler reasonably concludes that an object handed to a `ref` is ref-like,
  and then every read of `slot.open` during the shell render is a ref access
  during render, which it refuses.
- **Choosing in the browser does not close it.** A popover that shuts on the
  first click is right for a quick action and wrong here: narrowing a box is
  two or three tags and you want to see each one land before picking the next.
  The counts update in place because the page re-renders on the server and they
  are its props. Leaving the section hands the sidebar back, for the same
  reason it closes the preview.
- **The filter offers only what would still find something.** Once Tesco is
  selected, a tag on none of the remaining receipts leads to an empty list, and
  a bar full of dead ends is a bar you stop reading. Counts come from the rows
  already fetched — filtering is AND, so every tag worth offering next is by
  definition on the results, and a second query would ask the database what it
  has just answered. A selected tag always stays listed, whatever its count, or
  there'd be no way to unselect it.
- **One entry per row, thumbnail left.** It was a grid of tiles first, and two
  entries side by side halve the width available to the summary — which is the
  part that tells you whether this is the document you want. The thumbnail only
  has to be big enough to recognise a shape, so it stays a fixed 56px square
  and the text takes the rest of the line. Fixed, so every row's text starts at
  the same place: a ragged left edge down a column is what makes a list tiring.
  Ask Drive for a larger image than the box renders (`size=320`), because it
  fits the *longest* edge — a till receipt comes back 80px wide at 200.
- **Arriving is what the arrival date means.** An upload is dated now unless
  the composer's box is ticked, and only then by the file's own date, which a
  browser reports as its *modified* time. It is editable afterwards on the
  pane, because the feed is ordered and grouped by it, so it is the one field
  that decides where an entry *is* — and a backlog imported under today, or a
  scan made on Friday and filed on Monday, is somewhere you won't find again.
  The document's printed date is never touched: that is what the paper says.
- **Thumbnails come from Drive and are proxied, never linked.** Drive renders
  the first page of a PDF, which this app could not do without a PDF engine it
  has no other use for. `thumbnailLink` is a signed URL that expires within
  hours, so it is fetched fresh per request and the bytes come through us —
  storing one would produce a gallery that works for an afternoon.

## Email

A message you label in Gmail becomes an entry in a box. `scripts/gtd-email.gs`
is the bridge, and it is a *second file* in the same Apps Script project as the
scanner — it reads the same two properties and touches none of that script's
settings.

- **The app's Gmail scope does not widen, and that is the whole design.**
  Reading a message body needs `gmail.readonly`, which Google classes as
  *restricted*: published, it needs an annual security assessment; unpublished,
  Google expires the refresh token every seven days — and that is the same token
  Drive sync and the calendar run on, so the cost is not "email breaks weekly",
  it is "everything does". The Apps Script is not a published app. It is bound to
  one account, reading its own mail, and needs no verification at all. Exactly
  the asymmetry the scanner bridge already relies on, used a second time.
- **A label, not a pasted link, because a Gmail URL has no usable id in it.**
  The `#inbox/FMfcgz…` on the end of one is a permalink for Gmail's own
  interface; the API and Apps Script both want the message id and there is no
  way to convert between them. A label is also better to use — two taps, in the
  app you are already reading the message in.
- **Every message in a labelled thread is filed, not just the last.** The quote
  at the bottom of a reply is a rendering of what came before, not the thing
  itself, and it is routinely trimmed. Filing each message is what lets the
  search find whichever one actually said the thing.
- **An email is filed `ready`, never queued.** Everything a document is queued to
  discover, a message already states: the subject is a better title than a model
  would write, the sender and date are facts rather than readings, and Gmail's
  snippet is a serviceable summary. Having a mailbox summarised message by
  message would be paying to learn what the message already said. Tags are the
  one thing it misses and they are one press of "Read it again" away — which is
  the right shape, because whether a message is worth tagging is a judgement
  about that message.
- **The body is stored as HTML in Drive, so it costs nothing new.** It previews
  through the same sandboxed frame as any other `.html`, which means **remote
  images do not load**: `sandbox=""` gives the frame an opaque origin and denies
  scripts, so a tracking pixel in a filed message does not fire when you read it
  — a better outcome than it gets in most mail clients. `text` and `search_text`
  are written from the plain body, because on this table the vector is generated
  from `search_text` and a message stored but unindexed would be the one entry
  search could not see into.
- **The script's `safeName` is deliberately identical to the app's.** The app
  owns a document's title and sweeps Drive to make the filename match it, so a
  different rule here would mean every message being filed and then immediately
  renamed, once, for nothing.
- **`capturedAt` is when the message was *sent*.** A month of correspondence
  labelled in one sitting would otherwise land under today, which is the one
  arrangement that makes it impossible to find anything later.
- **A modified click on a message goes to Gmail, not Drive.** The stored copy is
  a rendering kept for reading and searching; the message is the thing you reply
  to, and opening the wrong one is a mistake you notice after typing an answer
  into it. `box_items.url` holds the permalink, the same column a `link` entry
  uses for its address.
- **"Relevant emails" is the same query and the same component as Documents**,
  split on `kind`. They are read for different reasons — a document is evidence
  you open to check something, a message is correspondence you open to see what
  was agreed — and mixing them gives a list where neither question is easy to
  ask. The emails list borrows the documents' sort rather than carrying a
  control of its own: two controls writing one preference key is a setting that
  appears to be in two places and is in one.
- **`getLinkedDocuments` and `getLinkableDocuments` no longer cast their rows.**
  `return rows as LinkedDocumentRow[]` was not describing a shape the compiler
  could not work out, it was overriding one it had worked out correctly — and
  both queries had drifted from the type they claimed to return. Adding `kind`
  to the row type changed nothing at runtime: it arrived `undefined`,
  `undefined === 'email'` is false, and every message filed itself under
  Documents with nothing anywhere reporting a problem. If a query's row needs a
  cast, the query is wrong.

- **The record button has two profiles, and one chain is not enough.** The first
  version had one, tuned to make quiet speech loud, applied to everything that
  came near it. Point it at an acoustic guitar and the arithmetic is brutal: a
  signal already peaking at −9 dBFS collects nineteen decibels of gain reduction,
  and the ten-millisecond attack — right for a voice — lets every pick transient
  through to the clipper behind it. Squashed and distorted, on an instrument that
  needed nothing done to it. A leveller is not a quality setting; it is the
  answer to *this is too quiet and too uneven*, and an instrument is not asking
  it. `music` is a 30 Hz rumble filter (a bass guitar's low E is 41 Hz, an
  acoustic's is 82 — anything higher removes the instrument), no drive, both
  compressors at ratio 1 which is a true bypass, and the limiter left as a safety
  net it should never touch.
- **The profile is switchable mid-recording and never remembered.** Switchable
  because the moment you discover the chain is wrong for what you are playing is
  the moment you have started playing it — every node stays put and only its
  parameters move, so nothing is rebuilt. Not remembered because it is the one
  setting that can ruin a take, and the same rule the capture screen's
  destination chips follow applies: a remembered profile is how you get a
  squashed guitar or a voice note nobody can hear, and you find out on playback.
- **A second way to file a message: paste what identifies it.** Labelling in
  Gmail is still the main path. This is the desk case — the message is in front
  of you and reaching for the label menu is more friction than pasting what you
  are already looking at. The app cannot fetch it, so it writes down *that you
  asked* in `email_requests` and the Apps Script claims the row on its next run.
  **A row, not a file in Drive**: a JSON or CSV handed between the two would mean
  a format to agree on, a race between writer and reader, and no way for the app
  to show what is outstanding or why one failed. The script already calls an
  authenticated endpoint every run — it can ask.
- **`readEmailPaste` recognises four shapes, and refuses to guess at a fifth.** A
  Gmail address, a sixteen-character message id and an RFC822 `Message-ID` in
  angle brackets are none of them things anybody types as a thought, so they are
  taken on sight. A Gmail *search* is not — `from:sam worktop` is unusual prose
  but "email Sam about the worktop" is not — so a search must announce itself
  with an `email:` prefix. The cost of guessing wrong is a note silently turned
  into a query, which is a note you have lost.
- **The `FMfcgz…` permalink is refused at the moment you paste it.** That id
  belongs to Gmail's own interface; no API accepts it and there is no way to
  convert it. Saying so immediately beats a request that sits pending until a
  script fails on it an hour later, and the message names the two ways round it.
- **A failed request stays on the feed until dismissed.** The usual reason one
  fails is something you can act on, and a request that quietly disappeared would
  be indistinguishable from one that worked — you would find out months later,
  looking for a message that was never filed. Pending ones cannot be dismissed:
  that would race the script, which may be fetching as you press.

- **A request can name what to cite the message on.** Asking from a box is
  asking for a message, full stop; asking from a project is asking for it
  *because of* that project, and making you go and find it afterwards to link it
  by hand was two steps too many for the commonest case. `email_requests` carries
  an optional `parent_type` / `parent_id`, and the app writes the
  `box_item_links` row when the bridge reports back.
- **The message still goes into a box, always.** One that existed only as a
  project's evidence would vanish with the project, and outliving the reason you
  filed it is the whole point of a box. The link is what is *extra*. Which box is
  not a question worth stopping for when you asked from a project, so the default
  box answers it — the same answer the scanner bridge gives to the same question.
  `defaultBox` reads and never creates: quietly making a box because someone
  pasted a URL is not a thing to do behind their back.
- **The script reports ids, not a count.** A count is enough to close a request
  and not enough to cite the message, which is most of the point of asking from a
  pane. The linking then happens in the app, where "this message is evidence for
  that project" already means something — the script knows about Gmail and Drive
  and has no business knowing about `box_item_links`. The links are written
  *before* the request is marked done: a link missing from a request that claims
  success is a message you would hunt for and not find, whereas a pending request
  whose links already exist simply resolves next run and writes them again, which
  `onConflictDoNothing` makes free.
- **`readEmailQuery` strips the `email:` prefix too, not just `readEmailPaste`.**
  The prefix exists so a *composer* can tell a search from a note. A field
  labelled "find an email" needs no such thing, but people type it anyway because
  it is what they were told to type elsewhere — and left on, it reaches Gmail as
  part of the search and matches nothing. Two entry points, one normalisation.
- **The phone screen and the extension route through `readEmailPaste` as well.**
  Both previously turned a pasted Gmail address into a link entry, whose picture
  and summary come from Gmail's sign-in page — because that is what anything
  without your cookies sees when it follows one. A box full of identical entries
  called "Gmail". On the phone the request must *not* return early either: files
  staged alongside still have to go up, and the screen still has to say what
  happened and reset itself, or a capture looks swallowed.

- **A message fetched for a project does not go in the box's feed.**
  `box_items.listed` defaults true — you put something in a box so that it would
  be in the box — and is set false for exactly one case: a message the bridge
  fetched because a *request carried a parent*. You asked for it on a project,
  you want it on the project, and having it also appear in a list you read like
  a journal is the app filing something on your behalf that you never filed.
  A labelled message is untouched: nobody asked for that one on behalf of
  anything, so the box is where it goes.
- **It is a listing decision, not a storage one.** The entry is still in a box,
  because a `box_item` belongs to one by definition and a message that existed
  only as a project's evidence would go with the project. It is still
  searchable, still openable, still linked. The document pane offers *Add it to
  &lt;box&gt;* whenever you decide it belongs in the feed after all.
- **The filter lives in `getBoxItems`, not in its callers.** The type counts, the
  tag counts, the date range and the gallery are all derived from those rows, so
  one clause keeps every one of them honest. Adding it further out would leave a
  facet counting entries that are not on screen.
- **A chosen row now beats the filters.** The selection used to fall back
  whenever it was not among the rows on screen, which was right while the only
  reason for that was a filter you had just changed. It stopped being right when
  an entry could be in a box and deliberately not in its feed: arriving from a
  project or from search, the pane quietly showed a different document.
  `getBoxItem` returns null for an id that names nothing, so a bad id still ends
  in an empty pane — it just does so for the right reason.
- **The control only offers to *add*, never to hide.** Everything else in a box
  is there because putting it in a box is what you did. A button offering to take
  things out of a feed would be an invitation to tidy a box, and a box is not for
  tidying — it is for keeping.

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

**A grant can be alive here and dead at Google.** A refresh token is withdrawn
when it goes months unused, when the password changes, or when it's revoked
from the account page — and none of those tell the app. `hasSyncScopes` still
reads as granted while every Drive call throws `GoogleAuthError`, so
`/connections` offers "Reconnect Google" permanently rather than only once the
app has noticed; `prompt: 'consent'` is already set, so re-running the flow
returns a fresh refresh token. `serveDriveFile` catches that error and answers
401 with a message saying so, because uncaught it was a bare 500 and the
preview pane could only report "that file would not load" — true of every file
in the app at once, and pointing at the file rather than at the one page that
fixes it. The pane reads the reason off the response body for the same reason:
an `<img>` only knows that it failed.

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
