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

/** This list's density, or the app-wide default when it has never been set. */
export async function getDensity(key: string, fallback: ViewMode): Promise<ViewMode> {
  const [row] = await db
    .select({ density: viewPrefs.density })
    .from(viewPrefs)
    .where(eq(viewPrefs.key, key))
    .limit(1);

  return (MODES as readonly string[]).includes(row?.density ?? '')
    ? (row!.density as ViewMode)
    : fallback;
}

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
