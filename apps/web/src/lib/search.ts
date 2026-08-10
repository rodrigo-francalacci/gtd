import 'server-only';

import { db } from '@gtd/db';
import { sql } from 'drizzle-orm';

export type SearchKind = 'project' | 'action' | 'list_item' | 'inbox';

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
  }
}
