import 'server-only';

import { db } from '@gtd/db';
import { sql } from 'drizzle-orm';

export type SearchKind =
  | 'project'
  | 'action'
  | 'list_item'
  | 'inbox'
  | 'attachment'
  | 'box_item';

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
/**
 * Whether a search should reach into finished work, and what to search for.
 *
 * The archive fills up for ever and is read for a different reason: live search
 * answers *what am I doing about this*, and a year of completed projects
 * crowding those results makes the question harder to answer every month. So it
 * is left out by default and asked for explicitly with an `A:` prefix — short
 * because it is typed, and a prefix rather than a toggle because the decision is
 * part of the question you are asking, not a mode to be left switched on.
 *
 * Case-insensitive, and the prefix is stripped: `A: kitchen` searches for
 * "kitchen", not for "A: kitchen".
 */
export function readArchiveScope(term: string): { term: string; archived: boolean } {
  const match = /^a:\s*/i.exec(term.trim());

  return match
    ? { term: term.trim().slice(match[0].length).trim(), archived: true }
    : { term: term.trim(), archived: false };
}

/**
 * How far a search reaches.
 *
 * `live` leaves finished work out, `all` includes it, and `archive` is *only*
 * finished work — which is what the archive's own box does, so searching there
 * cannot hand back the live projects you were not looking at.
 */
export type SearchScope = 'live' | 'all' | 'archive';

export async function search(
  rawTerm: string,
  limit = 60,
  scope: SearchScope = 'live',
): Promise<SearchHit[]> {
  const trimmed = rawTerm.trim();
  if (!trimmed) return [];

  /*
   * Written as SQL fragments rather than as a `where` on each arm, so the two
   * halves of "what counts as archived" — a project's status, and an action
   * being done or belonging to a finished project — are stated once and cannot
   * drift apart.
   */
  const projectScope =
    scope === 'all'
      ? sql`true`
      : scope === 'archive'
        ? sql`p.status in ('completed', 'dropped')`
        : sql`p.status not in ('completed', 'dropped')`;

  const actionScope =
    scope === 'all'
      ? sql`true`
      : scope === 'archive'
        ? sql`(act.status = 'done' or pr.status in ('completed', 'dropped'))`
        : sql`act.status <> 'done'
              and (pr.id is null or pr.status not in ('completed', 'dropped'))`;

  /*
   * A capture *does* have a finished state, and missing that was a real bug.
   *
   * This used to read "a capture has no finished state" and lump captures in
   * with box documents and list items, which are live by definition. They are
   * not the same: clarifying a capture takes it out of the inbox for good.
   * The row survives — raw capture is immutable, and it stays as the record of
   * what was actually typed — but it is no longer a thing you can go and look
   * at in the inbox.
   *
   * So every clarified capture was coming back from live search for ever, as a
   * hit labelled `inbox`, for a row the inbox does not contain. Searching for
   * "Pink hair mask" returned the list item it became *and* the capture it came
   * from, and clicking the second landed on an inbox with no such row. Worse,
   * it is a duplicate by construction: the capture's first line becomes the
   * outcome's title and its note becomes the outcome's notes, so both halves are
   * already searchable through the thing it turned into.
   *
   * Clarified is therefore the capture's archived state, filtered exactly like a
   * project's and an action's. That also keeps the one case whose words live
   * nowhere else reachable: a `trashed` capture has no outcome row, so `A:` is
   * the only way back to it, and now there is one.
   */
  const captureScope =
    scope === 'all'
      ? sql`true`
      : scope === 'archive'
        ? sql`ib.status = 'clarified'`
        : sql`ib.status <> 'clarified'`;

  /*
   * The rest really are live by definition — a box document, a list item and a
   * file have no finished state — so in `archive` scope they are excluded
   * outright rather than filtered. A box is for keeping, not for finishing, and
   * it has its own search.
   */
  const otherScope = scope === 'archive' ? sql`false` : sql`true`;

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
      where p.search_vector @@ q.tsq and ${projectScope}

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
      where act.search_vector @@ q.tsq and ${actionScope}

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
      where li.search_vector @@ q.tsq and ${otherScope}

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
      where ib.search_vector @@ q.tsq and ${captureScope}

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
      where att.search_vector @@ q.tsq and ${otherScope}

      union all

      -- The Big Box, which was missing from here and should not have been.
      --
      -- box_items.search_vector has existed and been maintained all along --
      -- the classifier writes search_text from the summary, the transcription
      -- and the tags every time it reads a document -- but the only thing that
      -- ever queried it was the "link a document" picker. So the archive was
      -- searchable in principle and unreachable from the search box, which is
      -- the one place you would look.
      --
      -- The title falls back the way documentLabel does: a note has no title
      -- and is its own description, a recording has neither and is known by
      -- its filename. Coalescing here rather than showing a blank row keeps a
      -- hit recognisable whichever kind it is.
      --
      -- meta carries the box id, because a document has no page of its own:
      -- it is a row in a feed, reached as /box/<box>?doc=<id>.
      select
        'box_item',
        bi.id::text,
        coalesce(
          nullif(btrim(coalesce(bi.title, '')), ''),
          nullif(left(btrim(coalesce(bi.description, '')), 80), ''),
          nullif(bi.name, ''),
          'Untitled'
        ),
        ts_headline('english', coalesce(bi.search_text, ''), q.tsq, ${HEADLINE_OPTS}),
        bx.name,
        bi.box_id::text,
        ts_rank(bi.search_vector, q.tsq)
          + (case when to_tsvector('english', coalesce(bi.title, '')) @@ q.tsq then 0.5 else 0 end)
      from box_items bi
      cross join q
      join boxes bx on bx.id = bi.box_id
      where bi.search_vector @@ q.tsq and ${otherScope}
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
  box_item: 'The Big Box',
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
    case 'box_item':
      // A document has no page of its own: it is a row in its box's feed.
      return hit.meta ? `/box/${hit.meta}?doc=${hit.id}` : '/box';
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
