/**
 * Does anything in the database point at something that is gone?
 *
 * Three tables address their parent by a plain uuid across four possible
 * tables — `attachments`, `box_item_links` and `email_requests` — so none of
 * them has a foreign key and *nothing cascades*. Every delete has to clean up
 * after itself by hand, and a delete that forgets does not fail: it leaves rows
 * pointing at nothing, quietly, and the symptom arrives months later as a file
 * that cannot be reached from anywhere in the app.
 *
 * This is the check that would have caught it. It reads only, names what it
 * finds, and is worth running after touching any delete path:
 *
 *   node scripts/check-orphans.mjs
 *
 * A non-zero exit means something is orphaned. The repair is usually to fix the
 * delete that let it happen *and* to tidy the rows it already made.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const line of readFileSync(join(root, 'apps/web/.env.local'), 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (match) process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, '');
}

const sql = neon(process.env.DATABASE_URL);

/** Each check: what it means, and the rows that should not exist. */
const CHECKS = [
  {
    name: 'attachments whose parent row is gone',
    why: 'the file is unreachable from anywhere in the app, and its Drive file with it',
    rows: () => sql`
      select a.id, a.parent_type, a.name from attachments a where
        (a.parent_type='project'    and not exists (select 1 from projects    p where p.id=a.parent_id)) or
        (a.parent_type='action'     and not exists (select 1 from actions     x where x.id=a.parent_id)) or
        (a.parent_type='list_item'  and not exists (select 1 from list_items  l where l.id=a.parent_id)) or
        (a.parent_type='inbox_item' and not exists (select 1 from inbox_items i where i.id=a.parent_id))
      limit 20`,
  },
  {
    name: 'box_item_links citing a parent that is gone',
    why: 'a document filed as evidence for something that no longer exists',
    rows: () => sql`
      select k.item_id, k.parent_type from box_item_links k where
        (k.parent_type='project'    and not exists (select 1 from projects    p where p.id=k.parent_id)) or
        (k.parent_type='action'     and not exists (select 1 from actions     x where x.id=k.parent_id)) or
        (k.parent_type='list_item'  and not exists (select 1 from list_items  l where l.id=k.parent_id)) or
        (k.parent_type='inbox_item' and not exists (select 1 from inbox_items i where i.id=k.parent_id))
      limit 20`,
  },
  {
    name: 'email_requests asked on behalf of something that is gone',
    why: 'when the bridge answers one, the message is hidden from the feed and cited on nothing',
    rows: () => sql`
      select r.id, r.parent_type, r.status, r.query from email_requests r
      where r.parent_id is not null and (
        (r.parent_type='project'   and not exists (select 1 from projects   p where p.id=r.parent_id)) or
        (r.parent_type='action'    and not exists (select 1 from actions    x where x.id=r.parent_id)) or
        (r.parent_type='list_item' and not exists (select 1 from list_items l where l.id=r.parent_id)))
      limit 20`,
  },
  {
    name: 'box entries kept out of the feed with no citation left',
    why: 'invisible from every direction: not in the box, and evidence for nothing',
    rows: () => sql`
      select b.id, b.title, b.name from box_items b
      where b.listed = false
        and not exists (select 1 from box_item_links k where k.item_id = b.id)
      limit 20`,
  },
  {
    name: 'milestones whose project is gone',
    why: 'a timeline row that can name nothing — the cascade should make this impossible',
    rows: () => sql`
      select b.id, b.event from box_items b
      where b.kind = 'event'
        and (b.project_id is null
             or not exists (select 1 from projects p where p.id = b.project_id))
      limit 20`,
  },
  {
    name: 'sync jobs for a project that is gone',
    why: 'the worker will claim it and can only fail',
    rows: () => sql`
      select j.id, j.kind from sync_jobs j
      where j.status in ('pending', 'running')
        and not exists (select 1 from projects p where p.id = j.project_id)
      limit 20`,
  },
];

let bad = 0;

for (const check of CHECKS) {
  const rows = await check.rows();

  if (rows.length === 0) {
    console.log(`ok    ${check.name}`);
    continue;
  }

  bad += rows.length;
  console.log(`FAIL  ${check.name} — ${rows.length}`);
  console.log(`        ${check.why}`);
  for (const row of rows.slice(0, 5)) console.log('        ', JSON.stringify(row));
}

console.log(bad ? `\n${bad} orphaned rows` : '\nnothing orphaned');
process.exit(bad ? 1 : 0);
