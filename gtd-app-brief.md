# \# GTD App — Project Brief for Claude Code

# 

# A personal GTD (Getting Things Done) system, built for one user (Rod), covering

# a Next.js web app and a companion phone capture app.

# 

# \## Tech stack (decided)

# 

# \- \*\*Frontend/backend\*\*: Next.js (App Router) + TypeScript

# \- \*\*Database\*\*: PostgreSQL, hosted on Neon

# \- \*\*ORM\*\*: Drizzle

# \- \*\*Note editor\*\*: TipTap (ProseMirror) — content stored as JSON, not HTML

# \- \*\*File storage\*\*: Google Drive (personal account, not work) — DB stores Drive

# &#x20; file/folder \*\*IDs\*\* only, never names or paths

# \- \*\*Search\*\*: Postgres `tsvector` full-text index across note content plus AI

# &#x20; transcriptions/OCR text

# \- \*\*Phone capture app\*\*: Expo (React Native) — see rationale below

# \- \*\*Repo structure\*\*: monorepo — `apps/web` (Next.js), `apps/mobile` (Expo,

# &#x20; later session), `packages/db` (Drizzle schema + shared types)

# 

# \## Visual style

# 

# \- Old-style Evernote three-pane layout: notebook/list sidebar → item list →

# &#x20; note/detail pane

# \- Base palette: black, white, greyscale

# \- Colour used \*\*only semantically\*\* — waiting-for, blocked/overdue, selection

# &#x20; state. Never decorative.

# 

# \## Core data model

# 

# ```

# areas\_of\_focus   (id, name, notes)

# goals            (id, area\_id fk, title, target\_date, notes)

# 

# projects (

# &#x20; id, title, area\_id fk nullable, goal\_id fk nullable,

# &#x20; status: active | standby | someday | completed | dropped,

# &#x20; standby\_reason text nullable,   -- the "return condition"

# &#x20; drive\_folder\_id, gmail\_label\_id,

# &#x20; notes jsonb,                    -- TipTap document

# &#x20; created\_at, updated\_at

# )

# 

# actions (

# &#x20; id, project\_id fk nullable, title,

# &#x20; status: next | waiting | done,

# &#x20; waiting\_since date nullable,

# &#x20; notes jsonb,

# &#x20; created\_at, updated\_at

# )

# 

# contexts (id, name, dimension: place | time | energy | person)

# action\_contexts (action\_id fk, context\_id fk)   -- many-to-many

# 

# lists (id, name, type: someday\_maybe | purchases | reference | checklist)

# list\_items (

# &#x20; id, list\_id fk, title,

# &#x20; fields jsonb,          -- type-specific data, see Purchases below

# &#x20; project\_id fk nullable,

# &#x20; promoted\_action\_id fk nullable,

# &#x20; created\_at

# )

# 

# attachments (

# &#x20; id, parent\_type: project | action | list\_item,

# &#x20; parent\_id, kind: image | audio | link | file,

# &#x20; drive\_file\_id, transcription text, ocr\_text text,

# &#x20; created\_at

# )

# 

# inbox\_items (

# &#x20; id, raw\_type: text | photo | audio,

# &#x20; drive\_file\_id nullable, raw\_text nullable,

# &#x20; ai\_suggestion jsonb,     -- suggested project/context/phrasing

# &#x20; status: pending | clarified,

# &#x20; created\_at

# )

# ```

# 

# \## Core workflows

# 

# \- \*\*Capture → Clarify → Organize → Reflect → Engage\*\* — the standard GTD loop

# \- \*\*Inbox\*\*: frictionless capture, zero required fields, offline-first, syncs

# &#x20; when signal returns

# \- \*\*Clarify screen\*\*: AI pre-fills a suggested project/context/phrasing; user

# &#x20; swipes to accept or taps to correct. Never auto-files silently.

# \- \*\*Default "what can I do now" view\*\*: filtered by context dimensions

# &#x20; (place, time, energy), pre-set from time of day / last known location,

# &#x20; adjustable in two taps — not a project list

# \- \*\*Stalled project detection\*\*: any active project with zero next actions

# &#x20; gets flagged automatically

# \- \*\*Weekly review\*\*: guided, stepped mode — inbox → projects → stalled →

# &#x20; waiting → standby/someday — that won't let you skip a section

# 

# \## Contexts

# 

# \- Typed dimensions: place/tool, time available, energy, person (agenda)

# \- \*\*Assumption\*\*: freeform, user-created (not a fixed enum) — flag if you'd

# &#x20; rather define a closed set up front

# \- An action can carry more than one, typically one per dimension

# 

# \## Lists (Someday/Maybe, Purchases, etc.)

# 

# \- One generic `lists`/`list\_items` mechanism, typed via a `type` field, with a

# &#x20; `fields` jsonb column for type-specific data

# \- List items are \*\*candidates\*\*, not actions — nothing on a list is a

# &#x20; commitment until promoted

# \- Promoting an item spawns a real action and records `promoted\_action\_id`

# \- \*\*Purchases\*\* list\_item fields: `cost`, `project\_id` (optional),

# &#x20; `impact`: `blocks | improves | nice\_to\_have`, `where`: `online | in\_town`

# \- \*\*Budget view\*\*: sum + filter over the Purchases list; items already

# &#x20; ordered live in Waiting For and are shown as committed spend, tracked

# &#x20; separately from proposed spend so nothing double-counts

# 

# \## Waiting For \& Standby

# 

# \- \*\*Waiting For\*\*: a status on actions, date-stamped, surfaced when stale

# &#x20; (e.g. no movement in two weeks)

# \- \*\*Standby\*\*: a project status with a required `standby\_reason` — its return

# &#x20; condition (e.g. "awaiting funds", "waiting on Neil", "revisit October")

# \- Standby projects sync to the Standby folder in both Drive and Gmail (see

# &#x20; sync section)

# 

# \## Areas of Focus \& Goals

# 

# \- Not standalone lists — both are a \*\*parent field on projects\*\*

# \- An Area with zero active projects, or a Goal with none under it, should be

# &#x20; visibly surfaced — that's the actual value of the horizon

# 

# \## Google Drive \& Gmail sync

# 

# \- Creating a project creates a Drive folder + a Gmail label; the project row

# &#x20; stores their \*\*IDs\*\*, never names or paths

# \- Setting a project to standby moves it to the Standby folder (Drive) and

# &#x20; Standby label (Gmail) — same ID-based linkage

# \- \*\*One-way sync\*\*: the app is the source of truth and pushes to Drive/Gmail.

# &#x20; No two-way reconciliation. Add a manual "verify links" action that reports

# &#x20; drift instead.

# \- Suggested structure: Drive `Projects/{name}`, `Standby/{name}`,

# &#x20; `Archive/{name}`; Gmail nested labels the same way (`Projects/{name}`)

# \- Personal Google account, not the Stroma work account — mind the 15GB quota

# &#x20; shared with Gmail

# 

# \## Capture app (phone)

# 

# \- \*\*Same codebase as the main app\*\*, with a capture-first launch route (not a

# &#x20; fully separate app) — one auth flow, one sync layer to maintain. Add a

# &#x20; home-screen shortcut/widget deep-linking to the capture route to get the

# &#x20; "opens straight to capture" feel without doubling the app.

# \- \*\*Expo (React Native)\*\*, not a PWA — iOS PWAs can't register as share-sheet

# &#x20; targets, which this needs; RN also handles background audio and offline

# &#x20; file queuing more reliably, and shares TypeScript with the web app

# \- Inputs: text, photo (OCR), audio (transcription)

# \- \*\*Local-first\*\*: writes to a local queue immediately, syncs when signal is

# &#x20; available. No signal is the normal case on site, not an edge case.

# \- \*\*Raw artefact is immutable\*\* — AI output is a suggestion layer on top,

# &#x20; never overwrites the original capture

# \- AI never blocks capture confirmation. Enrichment (transcription, OCR,

# &#x20; entity matching against existing projects, suggested classification)

# &#x20; happens afterwards in a background queue.

# \- Additional capture surfaces: OS share-sheet target; a dedicated forwarding

# &#x20; email address that creates an inbox item with the thread linked

# 

# \## Notes \& attachments

# 

# \- Every project and action has a TipTap note section (JSON in the `notes`

# &#x20; jsonb column)

# \- Attachments (image/audio/link) are custom TipTap nodes referencing Drive

# &#x20; file IDs, resolved to a proxied URL at render time — Drive isn't a CDN, so

# &#x20; requests go through the Next.js API with thumbnails cached

# \- Index extracted text (note content + transcriptions + OCR) into the search

# &#x20; `tsvector` so search reaches into voice memos and photographed whiteboards

# 

# \## Repo \& deployment

# 

# \- \*\*Repo\*\*: https://github.com/rodrigo-francalacci/gtd — point Claude Code at

# &#x20; this repo (clone it, or hand it the URL to init into)

# \- \*\*Hosting\*\*: Vercel. Native fit for Next.js App Router, env vars, and

# &#x20; preview deployments per branch/PR

# \- \*\*Neon ↔ Vercel\*\*: link them in the Vercel dashboard so `DATABASE\_URL` is

# &#x20; populated automatically per environment, preview branches included

# \- \*\*Serverless timeouts\*\*: audio transcription and Drive/Gmail sync work must

# &#x20; not run inside the request handler — route them through a background job

# &#x20; (Vercel Cron, or a lightweight queue like Inngest) instead. This is the

# &#x20; same rule as "AI never blocks capture" above, just extended to the backend.

# 

# \## Open assumptions — flag if wrong

# 

# \- Contexts are freeform, not a fixed set

# \- "Backlog" (from the Thais Godinho reference structure) is folded into

# &#x20; Someday/Maybe rather than kept separate

# \- Single-user app — Google OAuth alone should cover both identity and

# &#x20; Drive/Gmail access; no multi-user auth needed

# 

# \## First Claude Code session scope

# 

# 1\. Monorepo scaffold into the pre-created git repo — `apps/web` +

# &#x20;  `packages/db` (mobile app deferred)

# 2\. Drizzle schema for every table above, with migrations against Neon

# 3\. Next.js App Router skeleton: three-pane Evernote-style layout

# 4\. Core CRUD: projects and actions, assigning contexts, the "what can I do

# &#x20;  now" filtered view

# 5\. TipTap note editor wired to the `notes` jsonb column (attachments can be

# &#x20;  stubbed this session)

# 6\. Google OAuth + Drive folder/Gmail label creation on project create — flag

# &#x20;  if OAuth setup eats the session and needs to be stubbed instead

