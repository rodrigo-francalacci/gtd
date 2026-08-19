import { ActionDetail } from '@/components/action-detail';
import { SortableActionList } from '@/components/sortable-action-list';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import { WAITING_COLUMNS } from '@/lib/columns';
import {
  WAITING_STALE_DAYS,
  getAction,
  getAttachments,
  getLinkableDocuments,
  getLinkedDocuments,
  getContextsByDimension,
  getWaitingActions,
  isStale,
} from '@/lib/queries';
import { getPreferences, paneWidth } from '@/lib/view-mode';

export default async function WaitingPage(props: PageProps<'/waiting'>) {
  const searchParams = await props.searchParams;
  const selectedId = typeof searchParams.action === 'string' ? searchParams.action : null;

  const [rows, groups, selected, prefs] = await Promise.all([
    getWaitingActions(),
    getContextsByDimension(),
    selectedId ? getAction(selectedId) : Promise.resolve(null),
    getPreferences(),
  ]);
  const viewMode = prefs.viewMode;

  const staleCount = rows.filter((r) => isStale(r.waitingSince)).length;

  return (
    <>
      <ListPane
        title="Waiting for"
        viewMode={viewMode}
        paneWidth={paneWidth(prefs)}
        columns={WAITING_COLUMNS}
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
          mode={viewMode}
          variant="waiting"
          emptyState={
            <EmptyList message="Nothing is waiting on anyone else right now." />
          }
        />
      </ListPane>

      {selected ? (
        <DetailPane>
          {/* key: `useState(action.title)` only runs on mount. */}
          <ActionDetail
            key={selected.id}
            action={selected}
            attachments={await getAttachments('action', selected.id)}
            documents={await getLinkedDocuments('action', selected.id)}
            documentOptions={await getLinkableDocuments('action', selected.id, '')}
            contextGroups={groups}
            parties={groups.person.map((p) => p.name)}
          />
        </DetailPane>
      ) : (
        <EmptyDetail message="Select a waiting item" />
      )}
    </>
  );
}
