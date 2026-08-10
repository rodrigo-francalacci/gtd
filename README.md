# GTD

A personal Getting Things Done system. Single user (Rod).

See `gtd-app-brief.md` for the full product brief.

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

- Full schema for every table in the brief, live on Neon
- Three-pane shell: nav → list → detail
- "What can I do now" filtered by context dimensions
- Projects with status, standby return conditions, stalled detection
- Waiting For with staleness surfacing
- TipTap notes on projects and actions, indexed for full-text search
- Areas & goals gap view
- Drag to reorder actions and projects; drag an action onto a project to file
  it (Organise view, or the projects pane)

## Not built yet

Inbox and clarify screen, lists (Someday/Maybe, Purchases, budget view),
weekly review mode, search UI, attachments, real Google Drive/Gmail sync,
the Expo capture app.
