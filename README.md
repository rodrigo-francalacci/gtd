# GTD

A personal Getting Things Done system. Single user (Rod).

- **[`MANUAL.md`](MANUAL.md)** — how to use it: every view, every workflow,
  and what to do when something looks wrong
- `gtd-app-brief.md` — the original product brief
- `CLAUDE.md` — how it is built, and why each decision went the way it did

## Layout

```
apps/web       Next.js 16 App Router + TypeScript + Tailwind v4
packages/db    Drizzle schema, migrations, seed
```

npm workspaces. `apps/mobile` (Expo capture app) comes later.

## Setup

```bash
npm install
cp apps/web/.env.example apps/web/.env.local   # then paste your Neon URL
npm run db:migrate
npm run db:seed        # optional starter data
npm run dev
```

`apps/web/.env.local` is the single source of env truth — Drizzle reads it too,
and it matches what Vercel injects in deployed environments.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run db:generate` | Generate SQL from schema changes |
| `npm run db:migrate` | Apply migrations to Neon |
| `npm run db:push` | Push schema without a migration file (dev only) |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Seed starter data (no-op if already seeded) |

## Deploying

Vercel, root directory `apps/web`. Link Neon via **Vercel Marketplace →
Connectable Accounts → Neon** so `DATABASE_URL` is injected per environment,
preview branches included.

## What exists so far

- Inbox capture and a clarify screen running the GTD decision tree
- Guided weekly review, gated so no section can be skipped
- Google sign-in, plus Drive folder and Gmail label sync via a background queue
  (everything nested under a single GTD root in both)
- Editable contexts across all four dimensions
- Waiting For records who you're waiting on, reusing existing names
- Active and Future action buckets per project, drag between them; finish an
  action and name its successor in one step
- Full-text search across projects, actions, list items and inbox captures,
  with ranked results and highlighted snippets
- Full schema for every table in the brief, live on Neon
- Three-pane shell: nav → list → detail
- "What can I do now" filtered by context dimensions
- Projects with status, standby return conditions, stalled detection
- Waiting For with staleness surfacing
- TipTap notes on projects and actions with a formatting toolbar (bold,
  italic, underline, strike, code, headings, lists, quote, links), indexed for
  full-text search
- Areas & goals gap view
- Drag to reorder actions and projects; drag an action onto a project to file
  it (Organise view, or the projects pane)
- Lists (Someday/Maybe, Purchases, Reference, Checklist) with promote-to-action,
  and a Purchases budget separating proposed from committed spend
- Archive of finished projects, grouped by area and goal, newest first, keeping
  the notes and the record of what was done
- Areas and goals: create, rename, retarget, delete, and reassign a project's
  parents
- Comfortable and compact list views, and a drag-to-resize list pane — both
  remembered in the database

## Not built yet

Attachments, photo/audio capture, the Expo capture app.

Search does not yet cover attachment transcriptions or OCR text — the column
and index exist, but nothing can create an attachment until Drive is wired up.

Clarify suggestions come from local entity matching against project and context
names — no model, no API key. Swap `suggester` in
`apps/web/src/lib/ai/suggest.ts` to use a real one.

Currency is set in one place — `CURRENCY` in `apps/web/src/lib/queries.shared.ts`,
currently GBP.
