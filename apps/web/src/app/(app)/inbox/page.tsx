import Link from 'next/link';
import { attachmentsFor } from '@/lib/file-lists';
import { ClarifyPanel } from '@/components/clarify-panel';
import { InboxCapture } from '@/components/inbox-capture';
import { DetailPane, EmptyDetail, EmptyList, ListPane } from '@/components/panes';
import {
  getAreasAndGoals,
  getContextsByDimension,
  getInboxItem,
  getInboxItems,
  getListOptions,
  getProjectOptions,
} from '@/lib/queries';
import { IconNote, IconPaperclip } from '@/components/icons';
import { DayHeading } from '@/components/day-heading';
import { SimpleRow } from '@/components/simple-row';
import { INBOX_COLUMNS } from '@/lib/columns';
import { groupByDay } from '@/lib/days';
import { captureHasNote, captureLabel } from '@/lib/queries.shared';
import { getPreferences, paneWidth } from '@/lib/view-mode';

const stamp = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Capture and clarify — the front of the GTD loop. Everything else in the app
 * assumes an item has already been decided about; this is where that happens.
 */
export default async function InboxPage(props: PageProps<'/inbox'>) {
  const searchParams = await props.searchParams;
  const selectedId = typeof searchParams.item === 'string' ? searchParams.item : null;

  const [items, prefs] = await Promise.all([getInboxItems(), getPreferences()]);
  const simple = prefs.viewMode === 'simple';

  // The queue is oldest-first, which is the right way to *process* an inbox.
  // Grouped by day it reads the other way round — the most recent day belongs
  // at the top, where a day-grouped list is always read from.
  const ordered = simple ? [...items].reverse() : items;

  // `items` is pending-only, so an id that isn't in it has just been clarified.
  // Falling back to the head of the list makes processing advance by itself:
  // clarify one, and the next capture is already in front of you. The head of
  // the *displayed* list, so the selection is never the row furthest from the
  // one you just dealt with.
  const targetId =
    selectedId && items.some((i) => i.id === selectedId)
      ? selectedId
      : (ordered[0]?.id ?? null);

  const [selected, files, projects, horizons, listOptions, contextGroups] =
    await Promise.all([
      targetId ? getInboxItem(targetId) : Promise.resolve(null),
      targetId ? attachmentsFor('inbox_item', targetId) : Promise.resolve(null),
      getProjectOptions(),
      getAreasAndGoals(),
      getListOptions(),
      getContextsByDimension(),
    ]);

  return (
    <>
      <ListPane
        title="Inbox"
        viewMode={prefs.viewMode}
        paneWidth={paneWidth(prefs)}
        columns={INBOX_COLUMNS}
        subtitle={
          items.length === 0
            ? 'Empty — nothing waiting to be clarified'
            : `${items.length} to clarify · ${simple ? 'newest first' : 'oldest first'}`
        }
      >
        <InboxCapture />

        {items.length === 0 ? (
          <EmptyList message="Nothing here. Capture anything above — you can decide what it is later." />
        ) : simple ? (
          groupByDay(ordered, (i) => i.createdAt).map((day) => (
            <section key={day.key}>
              <DayHeading label={day.label} />
              {day.items.map((item) => (
                <SimpleRow
                  key={item.id}
                  href={`/inbox?item=${item.id}`}
                  selected={item.id === targetId}
                  grip={false}
                  after={
                    <>
                      {item.attachmentCount > 0 ? (
                        <span className="shrink-0 text-grey-400">
                          <IconPaperclip />
                        </span>
                      ) : null}
                      {captureHasNote(item) ? (
                        <span className="shrink-0 text-grey-400" title="Has a note">
                          <IconNote />
                        </span>
                      ) : null}
                    </>
                  }
                  title={
                    <span className={item.rawText ? '' : 'italic text-grey-500'}>
                      {captureLabel(item)}
                    </span>
                  }
                />
              ))}
            </section>
          ))
        ) : (
          ordered.map((item) =>
            prefs.viewMode === 'compact' ? (
              <Link
                key={item.id}
                href={`/inbox?item=${item.id}`}
                style={{ gridTemplateColumns: INBOX_COLUMNS.template }}
                className={[
                  'grid items-center gap-2 border-b border-grey-150 px-4 py-1 text-[12px]',
                  item.id === targetId ? 'bg-selected-bg' : 'hover:bg-grey-100',
                ].join(' ')}
              >
                {/* One line: the capture is often a sentence, so it takes the
                    space and the date becomes a column rather than a row. */}
                <span
                  className={[
                    'flex items-center gap-1.5 truncate',
                    item.id === targetId
                      ? 'font-medium text-grey-900'
                      : 'text-grey-800',
                    item.rawText ? '' : 'italic text-grey-500',
                  ].join(' ')}
                >
                  {item.attachmentCount > 0 ? (
                    <span className="shrink-0 text-grey-400">
                      <IconPaperclip />
                    </span>
                  ) : null}
                  {captureHasNote(item) ? (
                    <span className="shrink-0 text-grey-400" title="Has a note">
                      <IconNote />
                    </span>
                  ) : null}
                  <span className="truncate">{captureLabel(item)}</span>
                </span>
                <span className="truncate text-grey-500">
                  {item.aiSuggestion?.projectId ? 'suggestion' : '—'}
                </span>
                <span className="truncate tabular-nums text-grey-500">
                  {stamp.format(item.createdAt)}
                </span>
              </Link>
            ) : (
              <Link
                key={item.id}
                href={`/inbox?item=${item.id}`}
                className={[
                  'block border-b border-grey-150 px-4 py-2.5',
                  item.id === targetId ? 'bg-selected-bg' : 'hover:bg-grey-100',
                ].join(' ')}
              >
                {/* One line here too, now that a capture can carry a note.
                    `line-clamp-2` was for a long single thought; wrapping the
                    note in as well made every row a paragraph. */}
                <span
                  className={[
                    'block truncate text-[13px]',
                    item.id === targetId
                      ? 'font-medium text-grey-900'
                      : 'text-grey-800',
                    item.rawText ? '' : 'italic text-grey-500',
                  ].join(' ')}
                >
                  {captureLabel(item)}
                </span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-grey-500">
                  {stamp.format(item.createdAt)}
                  {item.attachmentCount > 0 ? (
                    <span className="flex items-center gap-1 text-grey-400">
                      <IconPaperclip />
                      <span className="tabular-nums">{item.attachmentCount}</span>
                    </span>
                  ) : null}
                  {captureHasNote(item) ? (
                    <span className="flex items-center gap-1 text-grey-400" title="Has a note">
                      <IconNote />
                    </span>
                  ) : null}
                  {item.aiSuggestion?.projectId ? (
                    <span className="rounded-sm bg-grey-200 px-1.5 py-px text-grey-600">
                      suggestion
                    </span>
                  ) : null}
                </span>
              </Link>
            ),
          )
        )}
      </ListPane>

      {selected ? (
        <DetailPane>
          {/* key: the panel holds draft state (title, project, contexts)
              seeded from the item. Without a fresh mount per item, selecting
              a different capture would keep the previous one's draft and
              clarify it under the wrong title. */}
          <ClarifyPanel
            key={selected.id}
            item={selected}
            attachments={files?.rows ?? []}
            fileOrder={files?.order}
            projects={projects}
            areas={horizons.areas}
            lists={listOptions}
            contextGroups={contextGroups}
          />
        </DetailPane>
      ) : (
        <EmptyDetail message="Inbox zero" />
      )}
    </>
  );
}
