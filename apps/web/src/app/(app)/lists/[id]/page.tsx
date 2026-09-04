import Link from 'next/link';
import { notFound } from 'next/navigation';
import { attachmentsFor, documentsFor } from '@/lib/file-lists';
import { BudgetSummary } from '@/components/budget-summary';
import { BudgetTrialProvider, TrialTotal } from '@/components/budget-trial';
import { ListItemDetail } from '@/components/list-item-detail';
import { ListKeys } from '@/components/list-keys';
import { deleteListItem } from '@/lib/actions';
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
import { ImpactBucket } from '@/components/impact-bucket';
import { Board } from '@/components/board';
import { FocusView } from '@/components/focus-view';
import { NoteEditor } from '@/components/note-editor';
import { updateListItemNotes } from '@/lib/actions';
import { IMPACT_LABELS, type PurchaseImpact } from '@/lib/queries.shared';
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
  /**
   * The board, which is a place rather than a mode.
   *
   * In the URL like everything else here: it survives a refresh, it is a link
   * the header can point at, and the server renders it — so there is no moment
   * where the panes are drawn and then replaced. Only a purchases list has the
   * four buckets it is made of, so nothing else can be asked for it.
   */
  const wantsBoard = isPurchases && searchParams.board !== undefined;

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

  /*
   * The order the rows are actually drawn in, which the layout decides.
   *
   * Worked out once, here, so the arrows and the list cannot disagree —
   * `impact` reads down its four buckets and `timeline` down its days, and
   * neither is the order the query returned. Same reasoning as the Now list's
   * sections.
   */
  const keyOrder =
    layout === 'impact' && isPurchases
      ? (['blocks', 'improves', 'nice_to_have', null] as const).flatMap((bucket) =>
          items.filter((i) => (i.fields?.impact ?? null) === bucket),
        )
      : layout === 'timeline'
        ? groupByDay(items, (i) => i.createdAt).flatMap((day) => day.items)
        : items;

  /** Selecting a row on the board keeps you on the board. */
  const boardItemHref = (itemId: string) => listUrl({ board: true, item: itemId });

  /**
   * Opened to work on, from wherever you were.
   *
   * `board` is carried through, so closing the focus view from a lane puts
   * you back on the board rather than dropping you into the panes — the
   * gesture should not quietly change which view you are in.
   */
  const focusOf = (itemId: string, fromBoard = false) =>
    `${listUrl({ board: fromBoard, item: itemId })}&focus=1`;

  const qs = (itemId: string) => {
    const p = new URLSearchParams();
    if (impact) p.set('impact', impact);
    if (where) p.set('where', where);
    p.set('item', itemId);
    return `/lists/${id}?${p}`;
  };

  /**
   * The board, with or without something selected, and the way back out.
   *
   * One builder rather than three near-identical ones: the filters have to
   * survive opening the board, selecting a row on it, clicking empty space to
   * get the budget back, and closing it — and four separate constructions of
   * the same query string is how one of those quietly stops carrying a filter.
   */
  const listUrl = (opts: { board?: boolean; item?: string | null }) => {
    const p = new URLSearchParams();
    if (impact) p.set('impact', impact);
    if (where) p.set('where', where);
    if (opts.item) p.set('item', opts.item);
    if (opts.board) p.set('board', '1');
    const query = p.toString();
    return query ? `/lists/${id}?${query}` : `/lists/${id}`;
  };

  const boardHref = listUrl({ board: true, item: selectedId });
  const closeBoardHref = listUrl({ item: selectedId });

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

  /**
   * The four buckets, described once.
   *
   * The pane stacks them and the board lays them side by side, but *what* they
   * are — which impact, what it is called, what it comes to — is one answer.
   * Written twice it would be four labels and four totals to keep in agreement,
   * and the two views would drift the first time either changed.
   */
  const impactBuckets: {
    impact: PurchaseImpact | null;
    title: string;
    hint: string;
  }[] = [
    { impact: 'blocks', title: IMPACT_LABELS.blocks, hint: 'in the way' },
    { impact: 'improves', title: IMPACT_LABELS.improves, hint: 'worth doing' },
    { impact: 'nice_to_have', title: IMPACT_LABELS.nice_to_have, hint: 'some day' },
    { impact: null, title: 'Not said yet', hint: 'drag these somewhere' },
  ];

  const bucketFacts = (bucket: (typeof impactBuckets)[number]) => {
    const mine = items.filter((i) => (i.fields?.impact ?? null) === bucket.impact);

    // Only what has a price. A bucket of six unpriced wants totalling zero
    // would be a lie with a number on it.
    const priced = mine.filter((i) => typeof i.fields?.cost === 'number');

    return {
      mine,
      total:
        priced.length > 0
          ? formatMoney(priced.reduce((t, i) => t + (i.fields?.cost ?? 0), 0))
          : null,
    };
  };

  /**
   * One item, opened to work on. Before the board, because a row opened *from*
   * a lane should show the item rather than the lanes again.
   */
  if (searchParams.focus !== undefined && selected) {
    return (
      <Frame>
        <FocusView
          title={selected.title}
          subtitle={list.name}
          closeHref={wantsBoard ? boardItemHref(selected.id) : qs(selected.id)}
          notes={
            <NoteEditor
              key={selected.id}
              surface="list_item"
              id={selected.id}
              height={selected.noteHeight ?? null}
              dense={selected.noteDense ?? null}
              initialContent={selected.notes}
              onSave={updateListItemNotes.bind(null, selected.id)}
              placeholder="Why this is here, what it depends on…"
              fill
            />
          }
          rest={
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
              hideNotes
            />
          }
        />
      </Frame>
    );
  }

  if (wantsBoard) {
    /*
     * The board *instead of* the panes, not on top of them.
     *
     * It covers the window either way, so drawing both would be work nobody
     * sees — and worse than wasted: the note editor inside pane three would be
     * mounted twice against the same row, two autosaves for one document, which
     * is exactly the shape of bug that costs somebody a paragraph.
     */
  /*
     * The reading side of the board, which is pane three by another name: the
     * selected item, or the budget when nothing is selected. Built here because
     * both halves are Server Components with their own queries behind them, and
     * the board only decides where they sit.
     */
    const boardSide = selected ? (
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
    ) : (
      <BudgetSummary
        items={allItems}
        filters={{ impact, where }}
        basePath={`/lists/${id}`}
        listId={id}
        budget={list.budget}
      />
    );

    return (
      <Frame>
        <Board
          title={list.name}
          subtitle={`${candidates} candidate${candidates === 1 ? '' : 's'} · ${formatMoney(openTotal)} open${
            impact || where ? ` · showing ${items.length} of ${allItems.length}` : ''
          }`}
          closeHref={closeBoardHref}
          deselectHref={listUrl({ board: true })}
          viewMode={viewMode}
          viewKey={viewKey}
          laneCount={impactBuckets.length}
          side={boardSide}
          columns={impactBuckets.map((bucket) => {
            const { mine, total } = bucketFacts(bucket);

            /*
             * Every lane is drawn, *including* the undecided one — which the
             * pane hides when it is empty. A lane is a place here, and a board
             * whose columns come and went as you emptied them would rearrange
             * itself under the drag that emptied it.
             */
            return (
              <ImpactBucket
                key={bucket.impact ?? 'unsaid'}
                variant="column"
                impact={bucket.impact}
                title={bucket.title}
                hint={bucket.hint}
                count={mine.length}
                total={total}
              >
                <SortableListItems
                  items={mine.map((i) => ({
                    ...i,
                    href: boardItemHref(i.id),
                    focusHref: focusOf(i.id, true),
                  }))}
                  selectedId={selectedId}
                  isPurchases={isPurchases}
                  mode={viewMode}
                  emptyState={
                    <p className="px-3 py-6 text-center text-[11px] text-grey-400">
                      Drag something in.
                    </p>
                  }
                />
              </ImpactBucket>
            );
          })}
        />
      </Frame>
    );
  }

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
            <LayoutToggle layout={layout} viewKey={viewKey} impact={isPurchases} />
            {isPurchases ? (
              /*
               * Hidden on a phone, and that is the honest bound rather than a
               * preference: the board is four lanes you drag between, and
               * HTML5 drag-and-drop has no touch support anywhere in this app.
               * A button that opened a view you could look at and not use would
               * be worse than no button.
               */
              <Link
                href={boardHref}
                className="hidden text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800 lg:inline"
              >
                Board
              </Link>
            ) : null}
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

        {/*
          Arrows walk the list as it is *drawn*, which the layout decides — an
          impact grouping reads down its buckets and a timeline down its days,
          neither of which is the order the rows were fetched in. One instance
          for the pane, outside the layout branch, because two expressions of one
          order is how the arrows end up jumping about.
        */}
        <ListKeys
          rows={keyOrder.map((i) => ({ id: i.id, href: qs(i.id) }))}
          selectedId={selectedId}
          onDelete={deleteListItem}
          deleteLabel="Delete"
        />

        {layout === 'impact' && isPurchases ? (
          /*
           * The same rows, cut by what each one would *do*.
           *
           * A purchases list in one column answers "what shall I buy" badly:
           * the thing holding a project up sits beside the thing you fancy, in
           * whatever order they were written down. Grouped by impact the list
           * answers it directly, and the total under each heading says what
           * answering it would cost — which is the number that actually
           * decides, since "nice to have" reads differently at nine hundred
           * pounds.
           *
           * All three buckets are rendered whether or not they hold anything,
           * for the reason the project statuses are: an empty group you cannot
           * see is an empty group you cannot drop into. The fourth is only
           * there while something is still undecided, and disappears when the
           * last one has been placed — it is a backlog, not a category.
           *
           * Each bucket holds a real sortable list, which is what makes the
           * gesture work at all: the grip lives there, so the rows are
           * draggable, and one drag does both jobs — dropped inside its own
           * bucket it reorders, dropped on another it changes the impact.
           * `SortableList` ignores a row it does not contain without
           * preventing the default, so the bucket underneath sees it. That is
           * the arrangement the action and project buckets already run on.
           *
           * The first attempt rendered the rows directly, on the reasoning
           * that position means nothing in a view arranged by something else.
           * True, and it left no grip anywhere — so the one interaction this
           * view exists for could not be performed.
           */
          (() => {
            return impactBuckets.map((bucket) => {
              const { mine, total } = bucketFacts(bucket);

              // The undecided bucket is a backlog, not a category: it appears
              // while something is unplaced and goes when the last one lands.
              if (bucket.impact === null && mine.length === 0) return null;

              return (
                <ImpactBucket
                  key={bucket.impact ?? 'unsaid'}
                  impact={bucket.impact}
                  title={bucket.title}
                  hint={bucket.hint}
                  count={mine.length}
                  total={total}
                >

                  <SortableListItems
                    items={mine.map((i) => ({ ...i, href: qs(i.id), focusHref: focusOf(i.id) }))}
                    selectedId={selectedId}
                    isPurchases={isPurchases}
                    mode={viewMode}
                    emptyState={
                      <p className="px-3 py-2 text-[11px] text-grey-400">
                        Nothing here. Drag something in.
                      </p>
                    }
                  />
                </ImpactBucket>
              );
            });
          })()
        ) : layout === 'timeline' ? (
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
            items={items.map((i) => ({ ...i, href: qs(i.id), focusHref: focusOf(i.id) }))}
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
