import { notFound } from 'next/navigation';
import { BudgetSummary } from '@/components/budget-summary';
import { ListItemDetail } from '@/components/list-item-detail';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import { QuickAddListItem } from '@/components/quick-add-list-item';
import { SortableListItems } from '@/components/sortable-list-items';
import { LIST_ITEM_COLUMNS, PURCHASE_COLUMNS } from '@/lib/columns';
import {
  formatMoney,
  getAttachments,
  getLinkableDocuments,
  getLinkedDocuments,
  getList,
  getListItem,
  getListItems,
  getProjectOptions,
} from '@/lib/queries';
import { getPreferences, paneWidth } from '@/lib/view-mode';

export default async function ListPage(props: PageProps<'/lists/[id]'>) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;

  const list = await getList(id);
  if (!list) notFound();

  const isPurchases = list.type === 'purchases';
  const selectedId = typeof searchParams.item === 'string' ? searchParams.item : null;
  const impact = typeof searchParams.impact === 'string' ? searchParams.impact : undefined;
  const where = typeof searchParams.where === 'string' ? searchParams.where : undefined;

  const [allItems, selected, projectOptions, prefs] = await Promise.all([
    getListItems(id),
    selectedId ? getListItem(selectedId) : Promise.resolve(null),
    isPurchases ? getProjectOptions() : Promise.resolve([]),
    getPreferences(),
  ]);
  const viewMode = prefs.viewMode;

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

  const openTotal = allItems
    .filter((i) => i.stage !== 'settled')
    .reduce((n, i) => n + (i.fields?.cost ?? 0), 0);

  const candidates = allItems.filter((i) => i.stage === 'candidate').length;

  return (
    <>
      <ListPane
        title={list.name}
        viewMode={viewMode}
        paneWidth={paneWidth(prefs)}
        columns={isPurchases ? PURCHASE_COLUMNS : LIST_ITEM_COLUMNS}
        subtitle={
          isPurchases
            ? `${candidates} candidate${candidates === 1 ? '' : 's'} · ${formatMoney(openTotal)} open${
                impact || where ? ` · showing ${items.length} of ${allItems.length}` : ''
              }`
            : `${candidates} candidate${candidates === 1 ? '' : 's'} of ${allItems.length}`
        }
      >
        <QuickAddListItem listId={id} />
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
            attachments={await getAttachments('list_item', selected.id)}
            documents={await getLinkedDocuments('list_item', selected.id)}
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
          />
        </DetailPane>
      ) : (
        <EmptyDetail message="Select an item" />
      )}
    </>
  );
}
