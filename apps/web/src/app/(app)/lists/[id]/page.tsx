import Link from 'next/link';
import { notFound } from 'next/navigation';
import { attachmentsFor, documentsFor } from '@/lib/file-lists';
import { BudgetSummary } from '@/components/budget-summary';
import { BudgetTrialProvider, TrialTotal } from '@/components/budget-trial';
import { ListItemDetail } from '@/components/list-item-detail';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import { QuickAddListItem } from '@/components/quick-add-list-item';
import { SortableListItems } from '@/components/sortable-list-items';
import { LIST_ITEM_COLUMNS, PURCHASE_COLUMNS } from '@/lib/columns';
import {
  formatMoney,
  getLinkableDocuments,
  getList,
  getListItem,
  getListItems,
  getProjectOptions,
} from '@/lib/queries';
import { getPreferences, paneWidth } from '@/lib/view-mode';
import { densityKeys, getView } from '@/lib/view-prefs';
import { DayHeading } from '@/components/day-heading';
import { LayoutToggle } from '@/components/layout-toggle';
import { EmojifyButton } from '@/components/emojify-button';
import { ListItemRow } from '@/components/list-item-row';
import { groupByDay } from '@/lib/days';

export default async function ListPage(props: PageProps<'/lists/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;

  const list = await getList(id);
  if (!list) notFound();

  const isPurchases = list.type === 'purchases';

  /**
   * The budget, asked for rather than fallen back to.
   *
   * Side by side it is simply what fills the pane when no item is selected, and
   * that was the whole design. One pane at a time it isn't reachable at all:
   * selecting an item replaces it, and there is no "nothing" to click to get
   * back — the way out on a desktop is clicking empty space, which a phone
   * hasn't got. So it gets a name in the URL, which makes it somewhere you can
   * go, a link the list header can point at, and a place the carousel knows to
   * travel to.
   *
   * It wins over a selected item rather than clearing it: come back from the
   * budget and the item you were looking at is still the one selected.
   */
  const wantsBudget = isPurchases && searchParams.budget !== undefined;
  const selectedId =
    !wantsBudget && typeof searchParams.item === 'string' ? searchParams.item : null;
  const impact =
    typeof searchParams.impact === 'string' ? searchParams.impact : undefined;
  const where = typeof searchParams.where === 'string' ? searchParams.where : undefined;

  const viewKey = densityKeys.list(id);
  const [allItems, selected, projectOptions, prefs, view] = await Promise.all([
    getListItems(id),
    selectedId ? getListItem(selectedId) : Promise.resolve(null),
    isPurchases ? getProjectOptions() : Promise.resolve([]),
    getPreferences(),
    getView(viewKey),
  ]);
  const viewMode = view.density ?? prefs.viewMode;
  const layout = view.layout;

  // Filters narrow the list, but the budget totals stay over the whole list —
  // a filtered subtotal masquerading as the budget would be misleading.
  const items = allItems.filter(
    (i) =>
      (!impact || i.fields?.impact === impact) && (!where || i.fields?.where === where),
  );

  const qs = (itemId: string) => {
    const p = new URLSearchParams();
    if (impact) p.set('impact', impact);
    if (where) p.set('where', where);
    p.set('item', itemId);
    return `/lists/${id}?${p}`;
  };

  /** The budget, keeping whichever filters are on. */
  const budgetHref = (() => {
    const p = new URLSearchParams();
    if (impact) p.set('impact', impact);
    if (where) p.set('where', where);
    p.set('budget', '1');
    return `/lists/${id}?${p}`;
  })();

  const openTotal = allItems
    .filter((i) => i.stage !== 'settled')
    .reduce((n, i) => n + (i.fields?.cost ?? 0), 0);

  const candidates = allItems.filter((i) => i.stage === 'candidate').length;

  // Read once, above the JSX. Each of these is a query plus a
  // preference lookup, and calling them inline would run both twice —
  // once for the rows and again for the order they are in.
  const files = selected ? await attachmentsFor('list_item', selected.id) : null;
  const docs = selected ? await documentsFor('list_item', selected.id) : null;

  /*
   * Wraps both panes because the two halves of one question live in each: you
   * tick candidates in the list and read the total in the budget beside it. It
   * renders no DOM, so the panes stay direct children of the pane track — which
   * is what the phone's carousel counts.
   *
   * Only a purchases list gets it. Everywhere else the hook returns null and
   * the ticks never render, so no other list grows a control about money.
   */
  const Frame = isPurchases ? BudgetTrialProvider : Passthrough;

  return (
    <Frame>
      <ListPane
        title={list.name}
        viewMode={viewMode}
        viewKey={viewKey}
        paneWidth={paneWidth(prefs)}
        columns={isPurchases ? PURCHASE_COLUMNS : LIST_ITEM_COLUMNS}
        /* In the header because that is the one part of a purchases list
           always on screen, whichever pane you are looking at. */
        actions={
          <>
            {/* The rows on screen, so a filtered list marks what the filter
                left rather than the whole list. */}
            <EmojifyButton
              target="list_items"
              ids={items.map((i) => i.id)}
              marked={items.filter((i) => i.emoji).length}
            />
            <LayoutToggle layout={layout} viewKey={viewKey} />
            {isPurchases ? (
              <Link
                href={budgetHref}
                aria-current={wantsBudget ? 'page' : undefined}
                className={[
                  'text-[11px] underline underline-offset-2',
                  wantsBudget ? 'text-selected' : 'text-grey-500 hover:text-grey-800',
                ].join(' ')}
              >
                Budget
              </Link>
            ) : null}
          </>
        }
        subtitle={
          isPurchases ? (
            <>
              {`${candidates} candidate${candidates === 1 ? '' : 's'} · ${formatMoney(openTotal)} open${
                impact || where ? ` · showing ${items.length} of ${allItems.length}` : ''
              }`}
              {/* Beside the ticking, so the running total is readable while a
                  selected item is covering the budget pane. */}
              <TrialTotal items={allItems} />
            </>
          ) : (
            `${candidates} candidate${candidates === 1 ? '' : 's'} of ${allItems.length}`
          )
        }
      >
        <QuickAddListItem listId={id} />

        {layout === 'timeline' ? (
          /*
           * The same rows read as a history: what you were thinking about in
           * March, under the day you wrote it down. The manual order is not
           * changed, only looked past — which is the difference between this
           * and a sort, and the reason both can exist.
           *
           * No drag here. Position means nothing in a view ordered by a date,
           * and offering a grip that silently reorders a list you cannot see
           * the order of would be worse than not offering one.
           */
          items.length === 0 ? (
            <EmptyList
              message={
                allItems.length === 0
                  ? 'Nothing on this list yet. Add a candidate above — it commits you to nothing.'
                  : 'No items match these filters.'
              }
            />
          ) : (
            groupByDay(items, (i) => i.createdAt).map((day) => (
              <section key={day.key}>
                <DayHeading label={day.label} />
                {day.items.map((i) => (
                  <ListItemRow
                    key={i.id}
                    item={i}
                    href={qs(i.id)}
                    selected={i.id === selectedId}
                    isPurchases={isPurchases}
                    mode={viewMode}
                  />
                ))}
              </section>
            ))
          )
        ) : (
          <SortableListItems
            items={items.map((i) => ({ ...i, href: qs(i.id) }))}
            selectedId={selectedId}
            isPurchases={isPurchases}
            mode={viewMode}
            emptyState={
              <EmptyList
                message={
                  allItems.length === 0
                    ? 'Nothing on this list yet. Add a candidate above — it commits you to nothing.'
                    : 'No items match these filters.'
                }
              />
            }
          />
        )}
      </ListPane>

      {selected ? (
        <DetailPane>
          {/* key: the panel seeds title and cost into useState, and an
              initialiser only runs on mount. Without a fresh mount per item,
              selecting another one keeps the previous item's title in the
              field while everything around it updates — and saving would
              rename the wrong row. */}
          <ListItemDetail
            key={selected.id}
            item={selected}
            attachments={files!.rows}
            fileOrder={files!.order}
            documents={docs!.rows}
            docOrder={docs!.order}
            documentOptions={await getLinkableDocuments('list_item', selected.id, '')}
            isPurchases={isPurchases}
            projectOptions={projectOptions}
          />
        </DetailPane>
      ) : isPurchases ? (
        <DetailPane>
          <BudgetSummary
            items={allItems}
            filters={{ impact, where }}
            basePath={`/lists/${id}`}
            listId={id}
            budget={list.budget}
          />
        </DetailPane>
      ) : (
        <EmptyDetail message="Select an item" />
      )}
    </Frame>
  );
}

/** Keeps the non-budget case free of a provider it would never read. */
function Passthrough({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
