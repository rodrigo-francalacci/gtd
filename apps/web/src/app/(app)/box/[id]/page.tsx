import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DayHeading } from '@/components/day-heading';
import { DayJournal } from '@/components/day-journal';
import { DocumentDetail } from '@/components/document-detail';
import { BoxComposer } from '@/components/box-composer';
import { BoxViewToggle } from '@/components/box-view-toggle';
import { DateRange } from '@/components/date-range';
import { DocumentGalleryRow } from '@/components/document-gallery-row';
import { DocumentRow } from '@/components/document-row';
import { ReadWaiting } from '@/components/read-waiting';
import { TagFilter } from '@/components/tag-filter';
import { TypeFilter } from '@/components/type-filter';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import { BOX_COLUMNS } from '@/lib/columns';
import { groupByDay } from '@/lib/days';
import {
  getBox,
  getBoxCategories,
  getBoxDayNotes,
  getBoxItem,
  getBoxItems,
  getBoxRange,
  getBoxTagIds,
  getBoxes,
  getProjectOptions,
} from '@/lib/queries';
import { ENTRY_TYPE_ORDER, entryTypeOf, type EntryType } from '@/lib/queries.shared';
import { getPreferences, paneWidth } from '@/lib/view-mode';
import { densityKeys, getView } from '@/lib/view-prefs';

/**
 * One box, read from the top.
 *
 * Always grouped by day, in every density — unlike the inbox, where grouping
 * is the simple view's answer to having no timestamps. Here the arrival date
 * *is* the filing system, so it is the one thing that can't be a preference.
 */
export default async function BoxPage(props: PageProps<'/box/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;

  const box = await getBox(id);
  if (!box) notFound();

  const raw = searchParams.tag;
  const requested = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const selectedId = typeof searchParams.doc === 'string' ? searchParams.doc : null;

  // A tag id from the URL that isn't in this box would silently return nothing
  // and look like an empty box rather than a bad filter.
  const known = await getBoxTagIds(id);
  const tagIds = requested.filter((t) => known.has(t));

  /**
   * Tags being filtered *against*: show everything that does *not* carry one.
   *
   * The other question a box asks constantly — "the fuel receipts that aren't
   * Shell" — which previously needed every other vendor selected by hand. That
   * is not the same query, and it stops being right the moment a new vendor
   * appears.
   *
   * A separate parameter rather than a `-` prefix on `tag`, because the values
   * are uuids and a prefix would make the parser responsible for telling a
   * sign apart from an id. Two lists cannot be misread.
   */
  const notRaw = searchParams.nottag;
  const excludedTags = (
    notRaw === undefined ? [] : Array.isArray(notRaw) ? notRaw : [notRaw]
  ).filter((t) => known.has(t) && !tagIds.includes(t));

  /**
   * A day from the URL, or nothing. An unparseable one is ignored rather than
   * refused: a filter you cannot see is better than a page that won't load.
   */
  const day = (value: unknown): Date | undefined => {
    if (typeof value !== 'string') return undefined;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? undefined : date;
  };

  const range = { from: day(searchParams.from), to: day(searchParams.to) };

  const viewKey = densityKeys.box(id);
  const [matched, categories, dayNotes, prefs, boxList, span, view] = await Promise.all([
    getBoxItems(id, tagIds, range),
    getBoxCategories(id),
    getBoxDayNotes(),
    getPreferences(),
    getBoxes(),
    getBoxRange(id),
    getView(viewKey),
  ]);

  const viewMode = view.density ?? prefs.viewMode;

  /*
   * Exclusions are applied in memory, where the positive tags were matched in
   * SQL — because the rows already carry their tags, so the answer is here and
   * a second query would only ask the database something it has just told us.
   *
   * NONE rather than NOT ALL: excluding Shell and Tesco means an entry
   * carrying either is out. Anything else would make adding a second exclusion
   * *widen* the result, which is the trap the positive tags avoid by being AND.
   */
  const items =
    excludedTags.length === 0
      ? matched
      : matched.filter((item) => !item.tags.some((t) => excludedTags.includes(t.id)));

  /**
   * The type filter is applied here rather than in SQL.
   *
   * `entryTypeOf` turns a kind and a mime type into one of a dozen words, and
   * expressing that twice — once in TypeScript, once as a pile of `like`
   * clauses — would be two definitions to keep in agreement, which is exactly
   * the trap `canClassify` and `READABLE` had to be warned about. A box holds
   * tens or hundreds of rows, so filtering them in memory costs nothing worth
   * the duplication.
   *
   * Types are OR-ed, unlike the tags: nothing is both audio and a place, so
   * requiring all of them would always return nothing.
   */
  const requestedTypes = (
    typeof searchParams.type === 'string'
      ? [searchParams.type]
      : Array.isArray(searchParams.type)
        ? searchParams.type
        : []
  ).filter((t): t is EntryType => (ENTRY_TYPE_ORDER as string[]).includes(t));

  const excludedTypes = (
    typeof searchParams.nottype === 'string'
      ? [searchParams.nottype]
      : Array.isArray(searchParams.nottype)
        ? searchParams.nottype
        : []
  )
    .filter((t): t is EntryType => (ENTRY_TYPE_ORDER as string[]).includes(t))
    // A type cannot be both wanted and unwanted; the positive one wins.
    .filter((t) => !requestedTypes.includes(t));

  const shown = items.filter((item) => {
    const type = entryTypeOf(item);
    // Included types are OR — nothing is both audio and a place. Excluded ones
    // are NONE, so adding a second exclusion narrows rather than widens.
    if (requestedTypes.length > 0 && !requestedTypes.includes(type)) return false;
    return !excludedTypes.includes(type);
  });

  /**
   * Counts for each facet are taken with the *other* filters applied but not
   * its own — otherwise picking Audio would leave Audio as the only type on
   * offer, and there would be no way to see what else was there.
   */
  const typeCounts: Record<string, number> = {};
  for (const item of items) {
    const type = entryTypeOf(item);
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
  }

  const tagCounts: Record<string, number> = {};
  for (const item of shown) {
    for (const tag of item.tags) {
      tagCounts[tag.id] = (tagCounts[tag.id] ?? 0) + 1;
    }
  }

  const targetId =
    selectedId && shown.some((i) => i.id === selectedId)
      ? selectedId
      : (shown[0]?.id ?? null);

  const [selected, projectOptions] = await Promise.all([
    targetId ? getBoxItem(targetId) : Promise.resolve(null),
    getProjectOptions(),
  ]);

  const href = (docId: string) => {
    const params = new URLSearchParams();
    tagIds.forEach((t) => params.append('tag', t));
    excludedTags.forEach((t) => params.append('nottag', t));
    // The filters have to survive selecting a row, or clicking a result would
    // throw away the search that found it.
    requestedTypes.forEach((t) => params.append('type', t));
    excludedTypes.forEach((t) => params.append('nottype', t));
    if (typeof searchParams.from === 'string') params.set('from', searchParams.from);
    if (typeof searchParams.to === 'string') params.set('to', searchParams.to);
    params.set('doc', docId);
    return `/box/${id}?${params}`;
  };

  return (
    <>
      <ListPane
        title={box.name}
        viewMode={viewMode}
        viewKey={viewKey}
        paneWidth={paneWidth(prefs)}
        columns={prefs.boxView === 'gallery' ? undefined : BOX_COLUMNS}
        actions={
          <>
            <ReadWaiting waiting={box.pendingCount} />
            <BoxViewToggle view={prefs.boxView} />
            <Link
              href={`/box?box=${id}`}
              className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
            >
              Tags
            </Link>
          </>
        }
        subtitle={
          <div className="flex flex-col gap-2">
            {span ? (
              /* key: the handles are local state so they can follow the
                 cursor, and this is how they re-seed when the URL changes for
                 another reason — a remount rather than an effect syncing two
                 sources of truth. */
              <DateRange
                key={`${searchParams.from ?? ''}|${searchParams.to ?? ''}`}
                boxId={id}
                earliest={span.from}
                latest={span.to}
                from={typeof searchParams.from === 'string' ? searchParams.from : undefined}
                to={typeof searchParams.to === 'string' ? searchParams.to : undefined}
              />
            ) : null}
            <TypeFilter
              boxId={id}
              counts={typeCounts}
              selected={requestedTypes}
              excluded={excludedTypes}
            />
            <TagFilter
              boxId={id}
              categories={categories}
              selected={tagIds}
              excluded={excludedTags}
              counts={tagCounts}
            />
          </div>
        }
      >
        <BoxComposer boxId={id} />

        {shown.length === 0 ? (
          <EmptyList
            message={
              tagIds.length > 0 || requestedTypes.length > 0 || range.from || range.to
                ? 'Nothing here matches that. Widen the dates, or drop a tag.'
                : box.itemCount === 0
                  ? 'Nothing here yet. Write something above, drop a file in, or scan into the folder this box watches.'
                  : 'Nothing to show.'
            }
          />
        ) : (
          groupByDay(shown, (i) => i.capturedAt).map((day) => (
            <section key={day.key}>
              <DayHeading label={day.label} />

              {/* Under the date, above the entries: it is about the day, not
                  one of the things that arrived in it. */}
              <DayJournal day={day.key} note={dayNotes.get(day.key) ?? ''} />

              {/* The day headings survive the gallery: arrival is the filing
                  system here, and a wall of thumbnails with no sense of when
                  is a folder, not a box. */}
              {prefs.boxView === 'gallery' ? (
                day.items.map((item) => (
                  <DocumentGalleryRow
                    key={item.id}
                    item={item}
                    href={href(item.id)}
                    selected={item.id === targetId}
                  />
                ))
              ) : (
                day.items.map((item) => (
                  <DocumentRow
                    key={item.id}
                    item={item}
                    href={href(item.id)}
                    selected={item.id === targetId}
                    mode={viewMode}
                  />
                ))
              )}
            </section>
          ))
        )}
      </ListPane>

      {selected ? (
        <DetailPane>
          {/* key: the panel seeds its title and summary drafts from the row,
              and `useState` initialisers only run on mount. Without it,
              clicking a second document would save the first one's title
              onto it. */}
          <DocumentDetail
            key={selected.id}
            item={selected}
            categories={categories}
            boxes={boxList}
            projects={projectOptions}
          />
        </DetailPane>
      ) : (
        <EmptyDetail message="Select a document" />
      )}
    </>
  );
}
