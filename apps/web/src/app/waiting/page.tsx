import { ActionDetail } from '@/components/action-detail';
import { ActionItem } from '@/components/action-item';
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
        {rows.length === 0 ? (
          <EmptyList message="Nothing is waiting on anyone else right now." />
        ) : (
          rows.map((a) => (
            <ActionItem
              key={a.id}
              action={a}
              href={`/waiting?action=${a.id}`}
              selected={a.id === selectedId}
            />
          ))
        )}
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
