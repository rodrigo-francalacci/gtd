import 'server-only';

import { db } from '@gtd/db';
import { sql } from 'drizzle-orm';

export type SearchKind = 'project' | 'action' | 'list_item' | 'inbox' | 'attachment';

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  /** ts_headline output — contains <mark> around the matched terms. */
  snippet: string;
  context: string | null;
  meta: string | null;
  rank: number;
};

/** Shared ts_headline options: short fragments, marked up for the UI. */
const HEADLINE_OPTS =
  'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, FragmentDelimiter= … , MaxWords=14, MinWords=4';

/**
 * One ranked pass over everything searchable.
 *
 * `websearch_to_tsquery` rather than `plainto_tsquery` so the box behaves the
 * way a search box is expected to: "quoted phrases", -exclusions and OR all
 * work, and malformed input yields an empty query instead of throwing.
 *
 * Ranking is `ts_rank` with a nudge for title matches — finding a project
 * called "kitchen" should beat an action that merely mentions kitchens in its
 * notes.
 */
export async function search(term: string, limit = 60): Promise<SearchHit[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];

  const rows = await db.execute(sql`
    with q as (select websearch_to_tsquery('english', ${trimmed}) as tsq)
    select * from (
      select
        'project' as kind,
        p.id::text as id,
        p.title as title,
        ts_headline('english', coalesce(p.search_text, ''), q.tsq, ${HEADLINE_OPTS}) as snippet,
        a.name as context,
        p.status::text as meta,
        ts_rank(p.search_vector, q.tsq)
          + (case when to_tsvector('english', p.title) @@ q.tsq then 0.5 else 0 end) as rank
      from projects p
      cross join q
      left join areas_of_focus a on a.id = p.area_id
      where p.search_vector @@ q.tsq

      union all

      select
        'action',
        act.id::text,
        act.title,
        ts_headline('english', coalesce(act.search_text, ''), q.tsq, ${HEADLINE_OPTS}),
        pr.title,
        act.status::text,
        ts_rank(act.search_vector, q.tsq)
          + (case when to_tsvector('english', act.title) @@ q.tsq then 0.5 else 0 end)
      from actions act
      cross join q
      left join projects pr on pr.id = act.project_id
      where act.search_vector @@ q.tsq

      union all

      select
        'list_item',
        li.id::text,
        li.title,
        '',
        l.name,
        li.list_id::text,
        ts_rank(li.search_vector, q.tsq) + 0.5
      from list_items li
      cross join q
      join lists l on l.id = li.list_id
      where li.search_vector @@ q.tsq

      union all

      select
        'inbox',
        ib.id::text,
        coalesce(left(ib.raw_text, 80), ''),
        ts_headline('english', coalesce(ib.raw_text, ''), q.tsq, ${HEADLINE_OPTS}),
        null,
        ib.status::text,
        ts_rank(ib.search_vector, q.tsq)
      from inbox_items ib
      cross join q
      where ib.search_vector @@ q.tsq

      union all

      -- Reaches into what a file says: a photographed page, a whiteboard, a
      -- PDF. The meta column carries the parent, so a hit can be clicked
      -- through to the thing the file hangs off rather than to the file
      -- alone. Aliased att, not at: AT is a keyword in SQL.
      select
        'attachment',
        att.id::text,
        att.name,
        ts_headline('english', coalesce(att.ocr_text, '') || ' ' || coalesce(att.transcription, ''), q.tsq, ${HEADLINE_OPTS}),
        coalesce(
          pr.title, act.title, li.title,
          -- A photo captured straight to the inbox often has no note beside
          -- it, so the parent has no title to borrow. Say where it lives
          -- rather than showing a hit with a blank context.
          nullif(btrim(coalesce(ibp.raw_text, '')), ''),
          case when ibp.id is not null then 'Inbox capture' end
        ),
        att.parent_type::text || ':' || att.parent_id::text,
        ts_rank(att.search_vector, q.tsq)
      from attachments att
      cross join q
      left join projects pr on pr.id = att.parent_id and att.parent_type = 'project'
      left join actions act on act.id = att.parent_id and att.parent_type = 'action'
      left join list_items li on li.id = att.parent_id and att.parent_type = 'list_item'
      left join inbox_items ibp on ibp.id = att.parent_id and att.parent_type = 'inbox_item'
      where att.search_vector @@ q.tsq
    ) hits
    order by rank desc, title asc
    limit ${limit}
  `);

  return (rows.rows ?? rows) as unknown as SearchHit[];
}

export const KIND_LABELS: Record<SearchKind, string> = {
  project: 'Projects',
  action: 'Actions',
  list_item: 'List items',
  inbox: 'Inbox',
  attachment: 'Files',
};

/** Where a hit sends you when clicked. */
export function hrefFor(hit: SearchHit): string {
  switch (hit.kind) {
    case 'project':
      return `/projects/${hit.id}`;
    case 'action':
      return `/now?action=${hit.id}`;
    case 'list_item':
      return `/lists/${hit.meta}?item=${hit.id}`;
    case 'inbox':
      return `/inbox?item=${hit.id}`;
    case 'attachment':
      return attachmentHref(hit.meta);
  }
}

/**
 * A file has no page of its own — it lives on a project, an action, a list
 * item or an unclarified capture, and that is where a search hit should land
 * you. `meta` carries "<parent_type>:<uuid>" because the union has one column
 * set for every kind.
 */
function attachmentHref(meta: string | null): string {
  const [type, id] = (meta ?? '').split(':');
  if (!id) return '/projects';

  if (type === 'project') return `/projects/${id}`;
  if (type === 'action') return `/now?action=${id}`;
  if (type === 'inbox_item') return `/inbox?item=${id}`;
  return `/lists?item=${id}`;
}
