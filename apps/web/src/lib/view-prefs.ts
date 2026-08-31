import 'server-only';

import { db, viewPrefs } from '@gtd/db';
import { eq, sql } from 'drizzle-orm';
import {
  DEFAULT_ATTACHMENT_SORT,
  SORT_KEYS,
  canGroup,
  type SortChoice,
  type SortKey,
} from './sort';
import type { ViewMode } from './pane';

/**
 * Which list is being asked about.
 *
 * A view, not a table: the attachments on a project and the documents linked
 * beside them are two lists in the same pane, and each gets its own answer.
 * Keyed by the *kind* of parent rather than the individual row — you want
 * files sorted by use on every project, not to make the decision again on each
 * one — which also means the table stays a handful of rows rather than growing
 * with the data.
 */
export const viewKeys = {
  attachments: (parentType: string) => `attachments:${parentType}`,
  documents: (parentType: string) => `documents:${parentType}`,
} as const;

/**
 * What a list is sorted by, or its own default if nothing has been chosen.
 *
 * A missing row is the normal state, not a gap to repair: nothing is written
 * until something is picked, so an untouched app has an empty table and every
 * list behaves exactly as it did before any of this existed.
 */
export async function getViewPref(
  key: string,
  fallback: SortChoice = DEFAULT_ATTACHMENT_SORT,
): Promise<SortChoice> {
  const [row] = await db.select().from(viewPrefs).where(eq(viewPrefs.key, key)).limit(1);

  if (!row?.sort) return fallback;

  const sort = (SORT_KEYS as readonly string[]).includes(row.sort)
    ? (row.sort as SortKey)
    : fallback.sort;

  return {
    sort,
    descending: row.descending,
    // A stored `grouped` from a sort that could group survives a switch to one
    // that can't, and would otherwise ask for headings nothing can produce.
    grouped: row.grouped && canGroup(sort),
  };
}

/** Store a choice. One row per view, written only when something is picked. */
export async function setViewPref(key: string, choice: SortChoice): Promise<void> {
  await db
    .insert(viewPrefs)
    .values({
      key,
      sort: choice.sort,
      descending: choice.descending,
      grouped: choice.grouped,
    })
    .onConflictDoUpdate({
      target: viewPrefs.key,
      set: {
        sort: choice.sort,
        descending: choice.descending,
        grouped: choice.grouped,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Which list is being asked about, for density.
 *
 * Keyed per list rather than per kind — unlike the sort keys above, and for
 * the opposite reason. How files are sorted is a habit that should hold
 * everywhere; how a *list* is laid out is a fact about that list. The inbox is
 * a queue you scan and wants titles only; purchases is a table of costs and
 * wants the columns. Making one choice serve both is what turned a preference
 * into a chore.
 */
export const densityKeys = {
  path: (pathname: string) => `density:${pathname}`,
  list: (listId: string) => `density:list:${listId}`,
  box: (boxId: string) => `density:box:${boxId}`,
} as const;

const MODES = ['comfortable', 'compact', 'simple'] as const;

/**
 * Remember a density for one list.
 *
 * Upserted against the same row the sort lives in, so a list that has been
 * both sorted and re-laid-out is one row rather than two.
 */
export async function setDensity(key: string, mode: ViewMode): Promise<void> {
  await db
    .insert(viewPrefs)
    .values({ key, density: mode })
    .onConflictDoUpdate({
      target: viewPrefs.key,
      set: { density: mode, updatedAt: sql`now()` },
    });
}

/**
 * Whether a list is read in your order or in date order.
 *
 * Stored beside the density in the same row, because both are answers to
 * "how do I want to look at this particular list" — which is also why one
 * read (`getView`) answers both.
 */
/**
 * How a list's rows are arranged.
 *
 * `list` is your own order, dragged into place. `timeline` reads the same rows
 * as a history, under the day each was written down. `impact` cuts a purchases
 * list into what each thing would *do* — and is offered nowhere else, because
 * nothing else has an impact to cut on.
 */
export type ListLayout = 'list' | 'timeline' | 'impact';

/**
 * Whether this box shows thumbnails.
 *
 * Per box, and in the same row as its density, because they are one question
 * about one box: a box of scanned receipts is recognised by shape long before
 * its title is read, and a box of filed correspondence is a column of subjects
 * with nothing to look at.
 */
export async function setBoxViewFor(key: string, view: 'list' | 'gallery'): Promise<void> {
  await db
    .insert(viewPrefs)
    .values({ key, boxView: view })
    .onConflictDoUpdate({
      target: viewPrefs.key,
      set: { boxView: view, updatedAt: sql`now()` },
    });
}

export async function setLayout(key: string, layout: ListLayout): Promise<void> {
  await db
    .insert(viewPrefs)
    .values({ key, layout })
    .onConflictDoUpdate({
      target: viewPrefs.key,
      set: { layout, updatedAt: sql`now()` },
    });
}

/**
 * How this list is laid out, in one read.
 *
 * Density and layout live in the same row, so asking for them separately is
 * two round trips for one question — and the pages that want both were making
 * them one after the other. It returns the *stored* density rather than
 * resolving the fallback, which is the point: the query never needed
 * `preferences` to run, so waiting for that row before starting it made the
 * page-wide default cost a whole extra trip. Callers fetch both in parallel
 * and pick the fallback afterwards, which is free.
 */
export async function getView(key: string): Promise<{
  density: ViewMode | null;
  layout: ListLayout;
  /** Null means "follow the app-wide default", as with the density above. */
  boxView: 'list' | 'gallery' | null;
}> {
  const [row] = await db
    .select({
      density: viewPrefs.density,
      layout: viewPrefs.layout,
      boxView: viewPrefs.boxView,
    })
    .from(viewPrefs)
    .where(eq(viewPrefs.key, key))
    .limit(1);

  return {
    density: (MODES as readonly string[]).includes(row?.density ?? '')
      ? (row!.density as ViewMode)
      : null,
    layout:
      row?.layout === 'timeline' || row?.layout === 'impact' ? row.layout : 'list',
    boxView:
      row?.boxView === 'gallery' ? 'gallery' : row?.boxView === 'list' ? 'list' : null,
  };
}
