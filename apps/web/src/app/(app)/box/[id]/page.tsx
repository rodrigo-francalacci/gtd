import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DayHeading } from '@/components/day-heading';
import { DocumentDetail } from '@/components/document-detail';
import { BoxComposer } from '@/components/box-composer';
import { BoxViewToggle } from '@/components/box-view-toggle';
import { DocumentGalleryRow } from '@/components/document-gallery-row';
import { DocumentRow } from '@/components/document-row';
import { ReadWaiting } from '@/components/read-waiting';
import { TagFilter } from '@/components/tag-filter';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import { BOX_COLUMNS } from '@/lib/columns';
import { groupByDay } from '@/lib/days';
import {
  getBox,
  getBoxCategories,
  getBoxItem,
  getBoxItems,
  getBoxTagIds,
  getBoxes,
  getProjectOptions,
} from '@/lib/queries';
import { getPreferences, paneWidth } from '@/lib/view-mode';

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

  const [items, categories, prefs, boxList] = await Promise.all([
    getBoxItems(id, tagIds),
    getBoxCategories(id),
    getPreferences(),
    getBoxes(),
  ]);

  const targetId =
    selectedId && items.some((i) => i.id === selectedId)
      ? selectedId
      : (items[0]?.id ?? null);

  const [selected, projectOptions] = await Promise.all([
    targetId ? getBoxItem(targetId) : Promise.resolve(null),
    getProjectOptions(),
  ]);

  const href = (docId: string) => {
    const params = new URLSearchParams();
    tagIds.forEach((t) => params.append('tag', t));
    params.set('doc', docId);
    return `/box/${id}?${params}`;
  };

  return (
    <>
      <ListPane
        title={box.name}
        viewMode={prefs.viewMode}
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
          <TagFilter boxId={id} categories={categories} selected={tagIds} />
        }
      >
        <BoxComposer boxId={id} />

        {items.length === 0 ? (
          <EmptyList
            message={
              tagIds.length > 0
                ? 'Nothing in this box carries all of those tags.'
                : box.itemCount === 0
                  ? 'Nothing here yet. Write something above, drop a file in, or scan into the folder this box watches.'
                  : 'Nothing to show.'
            }
          />
        ) : (
          groupByDay(items, (i) => i.capturedAt).map((day) => (
            <section key={day.key}>
              <DayHeading label={day.label} />

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
                    mode={prefs.viewMode}
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
