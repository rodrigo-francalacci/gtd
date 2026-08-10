import { ActionDetail } from '@/components/action-detail';
import { SortableActionList } from '@/components/sortable-action-list';
import { ContextFilter } from '@/components/context-filter';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import { QuickAddAction } from '@/components/quick-add';
import { getAction, getContextsByDimension, getNowActions } from '@/lib/queries';

export default async function NowPage(props: PageProps<'/now'>) {
  const searchParams = await props.searchParams;

  const raw = searchParams.ctx;
  const contextIds = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const selectedId = typeof searchParams.action === 'string' ? searchParams.action : null;

  const [groups, rows, selected] = await Promise.all([
    getContextsByDimension(),
    getNowActions(contextIds),
    selectedId ? getAction(selectedId) : Promise.resolve(null),
  ]);

  const qs = (id: string) => {
    const p = new URLSearchParams();
    contextIds.forEach((c) => p.append('ctx', c));
    p.set('action', id);
    return `/now?${p}`;
  };

  return (
    <>
      <ListPane
        title="What can I do now"
        subtitle={<ContextFilter groups={groups} />}
      >
        <QuickAddAction />
        <SortableActionList
          actions={rows.map((a) => ({ ...a, href: qs(a.id) }))}
          selectedId={selectedId}
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
      </ListPane>

      {selected ? (
        <DetailPane>
          <ActionDetail action={selected} contextGroups={groups} />
        </DetailPane>
      ) : (
        <EmptyDetail message="Select an action" />
      )}
    </>
  );
}
