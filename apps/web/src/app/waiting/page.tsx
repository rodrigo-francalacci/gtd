import { ActionDetail } from '@/components/action-detail';
import { SortableActionList } from '@/components/sortable-action-list';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import {
  WAITING_STALE_DAYS,
  getAction,
  getContextsByDimension,
  getWaitingActions,
  isStale,
} from '@/lib/queries';

export default async function WaitingPage(props: PageProps<'/waiting'>) {
  const searchParams = await props.searchParams;
  const selectedId = typeof searchParams.action === 'string' ? searchParams.action : null;

  const [rows, groups, selected] = await Promise.all([
    getWaitingActions(),
    getContextsByDimension(),
    selectedId ? getAction(selectedId) : Promise.resolve(null),
  ]);

  const staleCount = rows.filter((r) => isStale(r.waitingSince)).length;

  return (
    <>
      <ListPane
        title="Waiting for"
        subtitle={
          rows.length === 0
            ? 'Nothing outstanding'
            : `${rows.length} outstanding${
                staleCount > 0 ? ` · ${staleCount} past ${WAITING_STALE_DAYS} days` : ''
              }`
        }
      >
        <SortableActionList
          actions={rows.map((a) => ({ ...a, href: `/waiting?action=${a.id}` }))}
          selectedId={selectedId}
          emptyState={
            <EmptyList message="Nothing is waiting on anyone else right now." />
          }
        />
      </ListPane>

      {selected ? (
        <DetailPane>
          <ActionDetail action={selected} contextGroups={groups} />
        </DetailPane>
      ) : (
        <EmptyDetail message="Select a waiting item" />
      )}
    </>
  );
}
