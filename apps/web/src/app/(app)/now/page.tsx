import { ActionDetail } from '@/components/action-detail';
import { SortableActionList } from '@/components/sortable-action-list';
import { EmojifyButton } from '@/components/emojify-button';
import { ContextFilter } from '@/components/context-filter';
import { ListKeys } from '@/components/list-keys';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import { QuickAddAction } from '@/components/quick-add';
import { AddNowSection, NowLoose, NowSection } from '@/components/now-sections';
import { ACTION_COLUMNS } from '@/lib/columns';
import { attachmentsFor, documentsFor } from '@/lib/file-lists';
import { deleteAction } from '@/lib/actions';
import { getNowSections, getProjectOptions } from '@/lib/queries';
import {
  getAction,
  getContextsByDimension,
  getNowActions,
  getLinkableDocuments,
} from '@/lib/queries';
import { getPreferences, paneWidth } from '@/lib/view-mode';
import { densityKeys, getView } from '@/lib/view-prefs';

export default async function NowPage(props: PageProps<'/now'>) {
  const searchParams = await props.searchParams;

  const raw = searchParams.ctx;
  const contextIds = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const selectedId = typeof searchParams.action === 'string' ? searchParams.action : null;

  const viewKey = densityKeys.path('/now');
  const [groups, rows, sections, selected, prefs, view] = await Promise.all([
    getContextsByDimension(),
    getNowActions(contextIds),
    getNowSections(),
    selectedId ? getAction(selectedId) : Promise.resolve(null),
    getPreferences(),
    getView(viewKey),
  ]);
  const viewMode = view.density ?? prefs.viewMode;

  const qs = (id: string) => {
    const p = new URLSearchParams();
    contextIds.forEach((c) => p.append('ctx', c));
    p.set('action', id);
    return `/now?${p}`;
  };

  /*
   * Cut into the headings you made, in their order, with everything else last.
   *
   * In memory rather than in SQL: the rows are already fetched and already
   * ordered, and grouping them here keeps `getNowActions` a single query that
   * knows nothing about an arrangement no other page uses.
   */
  const bySection = new Map<string, typeof rows>();
  const loose: typeof rows = [];

  for (const action of rows) {
    if (action.sectionId && sections.some((s) => s.id === action.sectionId)) {
      bySection.set(action.sectionId, [
        ...(bySection.get(action.sectionId) ?? []),
        action,
      ]);
    } else {
      // Including an action pointing at a heading that has gone: it is loose,
      // which is what `on delete set null` will make it on the next write.
      loose.push(action);
    }
  }

  // Read once, above the JSX. Each of these is a query plus a
  // preference lookup, and calling them inline would run both twice —
  // once for the rows and again for the order they are in.
  const projectOptions = await getProjectOptions();
  const files = selected ? await attachmentsFor('action', selected.id) : null;
  const docs = selected ? await documentsFor('action', selected.id) : null;

  return (
    <>
      <ListPane
        title="What can I do now"
        viewMode={viewMode}
        viewKey={viewKey}
        paneWidth={paneWidth(prefs)}
        columns={ACTION_COLUMNS}
        subtitle={<ContextFilter groups={groups} />}
        /*
         * The ids are the rows the context filter has left, not every action in
         * the table — what you asked to mark is what you were looking at, and
         * re-reading the table here would quietly bill you for the ones you
         * filtered out.
         */
        actions={
          <EmojifyButton
            target="actions"
            ids={rows.map((a) => a.id)}
            marked={rows.filter((a) => a.emoji).length}
          />
        }
      >
        {/* Arrows walk the list; Delete asks, then removes. The order is
            this page's own, so a context filter narrows what the arrows
            walk rather than leaving them out of step with the rows. */}
        <ListKeys
          /*
           * The order the list is *drawn* in, headings and all — which stops
           * being the query's order the moment a section exists. Built from the
           * same grouping the rows below are, because two expressions of one
           * order is how the arrows end up jumping about.
           */
          rows={[
            ...sections.flatMap((section) => bySection.get(section.id) ?? []),
            ...loose,
          ].map((a) => ({ id: a.id, href: qs(a.id) }))}
          selectedId={selectedId}
          onDelete={deleteAction}
          deleteLabel="Done and delete"
          deleteNote="Its files go to the Drive bin with it."
        />

        <QuickAddAction />

        {/*
          With no headings this is the list exactly as it was — one sortable
          run, dragged into whatever order you like. Headings are opt-in and
          cost nothing until the first one exists.
        */}
        {sections.length === 0 ? (
          <SortableActionList
            actions={rows.map((a) => ({ ...a, href: qs(a.id) }))}
            selectedId={selectedId}
            mode={viewMode}
            emptyState={
              <EmptyList
                message={
                  contextIds.length > 0
                    ? 'Nothing matches this combination of contexts. Loosen a filter.'
                    : 'No next actions. Either you are done, or something needs clarifying.'
                }
              />
            }
          />
        ) : (
          <>
            {sections.map((section, at) => (
              <NowSection
                key={section.id}
                id={section.id}
                title={section.title}
                count={bySection.get(section.id)?.length ?? 0}
                prevId={sections[at - 1]?.id ?? null}
              >
                {/*
                  A real sortable run per heading, which is what makes the
                  gesture work: dragging inside one reorders, and dragging to
                  another is ignored by the list and caught by the heading it
                  lands on — the same bubbling the project buckets rely on.
                */}
                <SortableActionList
                  actions={(bySection.get(section.id) ?? []).map((a) => ({
                    ...a,
                    href: qs(a.id),
                  }))}
                  selectedId={selectedId}
                  mode={viewMode}
                />
              </NowSection>
            ))}

            <NowLoose count={loose.length}>
              <SortableActionList
                actions={loose.map((a) => ({ ...a, href: qs(a.id) }))}
                selectedId={selectedId}
                mode={viewMode}
              />
            </NowLoose>
          </>
        )}

        <AddNowSection />
      </ListPane>

      {selected ? (
        <DetailPane>
          {/* key: `useState(action.title)` only runs on mount. */}
          <ActionDetail
            key={selected.id}
            action={selected}
            attachments={files!.rows}
            fileOrder={files!.order}
            documents={docs!.rows}
            docOrder={docs!.order}
            documentOptions={await getLinkableDocuments('action', selected.id, '')}
            contextGroups={groups}
            parties={groups.person.map((p) => p.name)}
            projects={projectOptions}
          />
        </DetailPane>
      ) : (
        <EmptyDetail message="Select an action" />
      )}
    </>
  );
}
