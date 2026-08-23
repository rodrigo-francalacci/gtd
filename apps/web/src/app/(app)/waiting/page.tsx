import { ActionDetail } from '@/components/action-detail';
import { attachmentsFor, documentsFor } from '@/lib/file-lists';
import { SortableActionList } from '@/components/sortable-action-list';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import { WAITING_COLUMNS } from '@/lib/columns';
import {
  WAITING_STALE_DAYS,
  getAction,
  getLinkableDocuments,
  getContextsByDimension,
  getProjectOptions,
  getWaitingActions,
  isStale,
} from '@/lib/queries';
import { getPreferences, paneWidth } from '@/lib/view-mode';
import { densityKeys, getDensity } from '@/lib/view-prefs';

export default async function WaitingPage(props: PageProps<'/waiting'>) {
  const searchParams = await props.searchParams;
  const selectedId = typeof searchParams.action === 'string' ? searchParams.action : null;

  const [rows, groups, selected, prefs] = await Promise.all([
    getWaitingActions(),
    getContextsByDimension(),
    selectedId ? getAction(selectedId) : Promise.resolve(null),
    getPreferences(),
  ]);
  const viewKey = densityKeys.path('/waiting');
  const viewMode = await getDensity(viewKey, prefs.viewMode);

  const staleCount = rows.filter((r) => isStale(r.waitingSince)).length;

  // Read once, above the JSX. Each of these is a query plus a
  // preference lookup, and calling them inline would run both twice —
  // once for the rows and again for the order they are in.
  const projectOptions = await getProjectOptions();
  const files = selected ? await attachmentsFor('action', selected.id) : null;
  const docs = selected ? await documentsFor('action', selected.id) : null;

  return (
    <>
      <ListPane
        title="Waiting for"
        viewMode={viewMode}
        viewKey={viewKey}
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
        <EmptyDetail message="Select a waiting item" />
      )}
    </>
  );
}
