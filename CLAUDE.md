# Working in this repo

`gtd-app-brief.md` is the product spec. It wins over anything inferred from the
code — if the code contradicts it, the code is wrong.

**Next.js 16 has breaking changes from older training data.** Read
`apps/web/node_modules/next/dist/docs/` before writing app code. `params` and
`searchParams` are Promises; `revalidateTag` takes a cacheLife argument;
Turbopack is the default; `middleware` is now `proxy`.

## Conventions that carry weight

- **Colour is semantic only.** Base is greyscale (`grey-50`…`grey-900`,
  `paper`, `ink`). The only colour tokens are `waiting`, `stale`, and
  `selected`, plus their `-bg` pairs. Nothing decorative. Sidebar icons are
  monochrome strokes for this reason — no emoji, no colour.
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
  pixel.
- **Font is Source Sans**, Evernote's UI typeface until they moved to Inter in
  January 2024 — the era this three-pane layout copies. Self-hosted via
  `next/font`, no runtime request.
- **Google IDs, never names or paths.** `drive_folder_id` / `gmail_label_id`
  hold IDs so a rename in Drive can't break the link.
- **Sync is one-way.** The app is the source of truth and pushes to
  Drive/Gmail. There is no reconciliation — `verifyLinks` reports drift, it
  doesn't fix it.
- **Raw capture is immutable.** AI output is a suggestion layer
  (`inbox_items.ai_suggestion`), never a rewrite of `raw_text` /
  `drive_file_id`. Clarifying doesn't edit or delete the row either: it marks
  it clarified and stamps `outcome` / `outcome_id` beside the original,
  `trashed` included.
- **Capture never blocks on enrichment.** `captureInboxItem` writes the row,
  then attempts a suggestion in a try/catch — a failing suggester must never
  cost you the thought. Suggestions pre-fill the clarify form and commit
  nothing on their own.
- **Panels seeded from a selected row need `key={row.id}`.** `useState`
  initialisers only run on mount, so without it the clarify panel (and the
  note editor) keep the previous row's draft. This has bitten twice.
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
- `apps/web/src/lib/google/sync.ts` — the `GoogleSync` interface. Currently a
  no-op returning null IDs. Swap the implementation, not the callers.

## Search

One ranked query in `lib/search.ts` unions projects, actions, list items and
inbox captures. `websearch_to_tsquery`, not `plainto_tsquery`: quoted phrases,
`-exclusions` and `OR` work, and malformed input yields an empty query instead
of throwing. Title matches get a +0.5 rank nudge over body-only matches.

`ts_headline` escapes nothing, so its output is passed through
`sanitiseHeadline`, which strips every tag except the `<mark>` pair Postgres
was asked for. Never render a headline without it.

Attachments already carry a `search_vector` over transcription and OCR text
but are deliberately **not** in the union — there is no way to create an
attachment yet, and untested code for absent data is worse than a gap. Wire it
when attachments land with Drive.

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

## Gotchas hit already

- Drizzle subqueries joined into one statement need **distinct** alias names
  (`next_n`, `waiting_n`) or Postgres reports an ambiguous column reference.
- `dotenv` must load before any module reading `process.env` — ESM hoists
  imports, so `import './env'` goes first (see `packages/db/src/env.ts`).
- Every route is `force-dynamic` from the root layout; these panes read live
  rows and must not be prerendered.
