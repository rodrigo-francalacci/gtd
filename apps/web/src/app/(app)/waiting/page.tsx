import { ActionDetail } from '@/components/action-detail';
import { ListKeys } from '@/components/list-keys';
import { deleteAction } from '@/lib/actions';
import { attachmentsFor, documentsFor } from '@/lib/file-lists';
import { SortableActionList } from '@/components/sortable-action-list';
import { EmojifyButton } from '@/components/emojify-button';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import { WAITING_COLUMNS } from '@/lib/columns';
import {
  getActionQueue,
  WAITING_STALE_DAYS,
  getAction,
  getLinkableDocuments,
  getContextsByDimension,
  getProjectOptions,
  getWaitingActions,
  isStale,
} from '@/lib/queries';
import { getPreferences, paneWidth } from '@/lib/view-mode';
import { densityKeys, getView } from '@/lib/view-prefs';

export default async function WaitingPage(props: PageProps<'/waiting'>) {
  const searchParams = await props.searchParams;
  const selectedId = typeof searchParams.action === 'string' ? searchParams.action : null;

  const viewKey = densityKeys.path('/waiting');
  const [rows, groups, selected, prefs, view] = await Promise.all([
    getWaitingActions(),
    getContextsByDimension(),
    selectedId ? getAction(selectedId) : Promise.resolve(null),
    getPreferences(),
    getView(viewKey),
  ]);
  const viewMode = view.density ?? prefs.viewMode;

  const staleCount = rows.filter((r) => isStale(r.waitingSince)).length;

  // Read once, above the JSX. Each of these is a query plus a
  // preference lookup, and calling them inline would run both twice —
  // once for the rows and again for the order they are in.
  const projectOptions = await getProjectOptions();
  const files = selected ? await attachmentsFor('action', selected.id) : null;
  const docs = selected ? await documentsFor('action', selected.id) : null;

  /* What the selected step becomes when it is ticked off. */
  const actionQueue = selected ? await getActionQueue(selected.id) : undefined;

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
        /* The ids are the rows on screen — what you asked to mark is what
           you were looking at, filters and all. */
        actions={
          <EmojifyButton
            target="actions"
            ids={rows.map((a) => a.id)}
            marked={rows.filter((a) => a.emoji).length}
          />
        }
      >
        <ListKeys
          rows={rows.map((a) => ({ id: a.id, href: `/waiting?action=${a.id}` }))}
          selectedId={selectedId}
          onDelete={deleteAction}
          deleteLabel="Done and delete"
          deleteNote="Its files go to the Drive bin with it."
        />
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
            queue={actionQueue}
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
