import Link from 'next/link';
import { EmptyList, ListPane } from '@/components/panes';
import { ARCHIVE_COLUMNS } from '@/lib/columns';
import type { ArchivedActionRow, ArchivedProjectRow } from '@/lib/queries';
import { hrefFor, type SearchHit } from '@/lib/search';
import { ArchiveSearch } from './archive-search';
import type { ViewMode } from '@/lib/pane';
import { SimpleRow } from './simple-row';

/**
 * Grouped Area → Goal, newest first inside each group.
 *
 * The grouping is alphabetical rather than by recency: this is a place you
 * come looking for something specific, so a stable, scannable order beats one
 * that reshuffles every time a project finishes. The date ordering that the
 * archive is *for* applies within each group.
 */
export function ArchiveListPane({
  projects,
  actions,
  hits,
  view,
  find,
  selectedId,
  selectedActionId,
  showDropped,
  viewMode,
  viewKey,
  paneWidth,
}: {
  projects: ArchivedProjectRow[];
  /**
   * Finished actions that never had a project.
   *
   * Their own section rather than mixed in among the projects: a project is a
   * record of something that took several steps and is read for what it says,
   * while these are single jobs read as a list of what got done and when. One
   * list containing both would be sorted two ways at once.
   */
  actions: ArchivedActionRow[];
  /** Archive-only search results, when something has been searched for. */
  hits: SearchHit[];
  view: 'projects' | 'actions';
  find: string;
  selectedId: string | null;
  /** Which finished action is open in the third pane, if any. */
  selectedActionId: string | null;
  showDropped: boolean;
  viewMode: ViewMode;
  /** Which list this is, so its density is remembered per list. */
  viewKey?: string;
  paneWidth: number;
}) {
  const rows = showDropped ? projects : projects.filter((p) => p.status === 'completed');
  const droppedCount = projects.filter((p) => p.status === 'dropped').length;

  // Area → Goal → projects. Nulls sort last under an explicit label so nothing
  // silently disappears from the archive.
  const areas = new Map<string, Map<string, ArchivedProjectRow[]>>();
  for (const p of rows) {
    const area = p.areaName ?? '￿No area of focus';
    const goal = p.goalTitle ?? '￿No goal';
    const byGoal = areas.get(area) ?? new Map<string, ArchivedProjectRow[]>();
    byGoal.set(goal, [...(byGoal.get(goal) ?? []), p]);
    areas.set(area, byGoal);
  }

  const clean = (s: string) => s.replace('￿', '');
  const sortedAreas = [...areas.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <ListPane
      title="Archive"
      viewMode={viewMode}
      viewKey={viewKey}
      paneWidth={paneWidth}
      columns={view === 'projects' && !find ? ARCHIVE_COLUMNS : undefined}
      subtitle={
        <div className="flex flex-col gap-2">
          <ArchiveSearch term={find} view={view === 'actions' ? 'actions' : null} />

          {/* The two things the archive holds. Always both, even when one is
              empty — a section you cannot see is one you do not know about,
              which is how the projectless actions went missing in the first
              place. */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={find ? `/archive?find=${encodeURIComponent(find)}` : '/archive'}
              aria-current={view === 'projects' ? 'true' : undefined}
              className={
                view === 'projects'
                  ? 'font-medium text-grey-800'
                  : 'underline underline-offset-2 hover:text-grey-800'
              }
            >
              Projects {projects.length}
            </Link>
            <span aria-hidden className="text-grey-300">
              ·
            </span>
            <Link
              href={
                find
                  ? `/archive?view=actions&find=${encodeURIComponent(find)}`
                  : '/archive?view=actions'
              }
              aria-current={view === 'actions' ? 'true' : undefined}
              className={
                view === 'actions'
                  ? 'font-medium text-grey-800'
                  : 'underline underline-offset-2 hover:text-grey-800'
              }
            >
              Projectless actions {actions.length}
            </Link>

            {view === 'projects' && droppedCount > 0 && !find ? (
              <Link
                href={showDropped ? '/archive' : '/archive?dropped=1'}
                className="underline underline-offset-2"
              >
                {showDropped ? 'Hide dropped' : `Show ${droppedCount} dropped`}
              </Link>
            ) : null}
          </div>
        </div>
      }
    >
      {find ? (
        <ArchiveResults hits={hits} term={find} />
      ) : view === 'actions' ? (
        <ArchiveActions actions={actions} selectedId={selectedActionId} find={find} />
      ) : (
        <>
          {rows.length === 0 ? (
        <EmptyList
          message={
            projects.length === 0
              ? 'Nothing archived yet. Completed and dropped projects land here.'
              : 'No completed projects — only dropped ones, which are hidden.'
          }
        />
      ) : (
        sortedAreas.map(([area, byGoal]) => (
          <section key={area}>
            <h3 className="sticky top-0 z-20 bg-grey-100 px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
              {clean(area)}
            </h3>

            {[...byGoal.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([goal, items]) => (
                <div key={goal}>
                  {/* Only worth a sub-heading when the area actually has goals. */}
                  {byGoal.size > 1 || !goal.startsWith('￿') ? (
                    <h4 className="px-4 pt-2 pb-1 text-[11px] font-medium text-grey-500">
                      {clean(goal)}
                    </h4>
                  ) : null}

                  {items.map((p) => (
                    <ArchiveRow
                      key={p.id}
                      project={p}
                      selected={p.id === selectedId}
                      showDropped={showDropped}
                      mode={viewMode}
                    />
                  ))}
                </div>
              ))}
          </section>
            ))
          )}
        </>
      )}
    </ListPane>
  );
}

/**
 * What got done that was never part of anything bigger, newest first.
 *
 * Dated rather than grouped: these are read as a record of when things
 * happened, and a heading per day over a list that grows by one every few days
 * would be more headings than rows.
 */
function ArchiveActions({
  actions,
  selectedId,
  find,
}: {
  actions: ArchivedActionRow[];
  selectedId: string | null;
  find: string;
}) {
  if (actions.length === 0) {
    return (
      <EmptyList message="Nothing here yet. A finished action with no project lands here — the two-minute jobs you tick off with “Did it”." />
    );
  }

  return (
    <>
      {actions.map((action) => (
        /* A link, because the record is the point: the notes saying what was
           actually done and the files that were on it are in the third pane,
           and a list of finished work you cannot open is a receipt. */
        <Link
          key={action.id}
          href={`/archive?view=actions&action=${action.id}${
            find ? `&find=${encodeURIComponent(find)}` : ''
          }`}
          className={[
            'flex items-baseline gap-2 border-b border-grey-150 px-4 py-2 text-[13px]',
            action.id === selectedId ? 'bg-selected-bg' : 'hover:bg-grey-100',
          ].join(' ')}
        >
          {/* Greyed, not struck through: a finished step is a record of what
              was done, and a line through it says disregard. */}
          {action.emoji ? (
            <span aria-hidden className="w-5 shrink-0">
              {action.emoji}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-grey-500">{action.title}</span>
          {action.hasNotes ? (
            <span className="shrink-0 text-[11px] text-grey-400" title="Has notes">
              ¶
            </span>
          ) : null}
          <span className="shrink-0 tabular-nums text-[11px] text-grey-400">
            {dateFormat.format(action.completedAt ?? action.createdAt)}
          </span>
        </Link>
      ))}
    </>
  );
}

/** Archive-only results, so searching here cannot hand back live work. */
function ArchiveResults({ hits, term }: { hits: SearchHit[]; term: string }) {
  if (hits.length === 0) {
    return <EmptyList message={`Nothing in the archive matches “${term}”.`} />;
  }

  return (
    <>
      {hits.map((hit) => (
        <Link
          key={`${hit.kind}:${hit.id}`}
          href={hrefFor(hit)}
          className="block border-b border-grey-150 px-4 py-2 hover:bg-grey-100"
        >
          <p className="truncate text-[13px] text-grey-800">{hit.title}</p>
          <p className="text-[11px] text-grey-500">
            {hit.kind === 'project' ? 'Project' : 'Action'}
            {hit.context ? ` · ${hit.context}` : ''}
          </p>
        </Link>
      ))}
    </>
  );
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function ArchiveRow({
  project,
  selected,
  showDropped,
  mode,
}: {
  project: ArchivedProjectRow;
  selected: boolean;
  showDropped: boolean;
  mode: ViewMode;
}) {
  const href = `/archive?${showDropped ? 'dropped=1&' : ''}project=${project.id}`;
  const finished = project.completedAt ? dateFormat.format(project.completedAt) : '—';

  if (mode === 'simple') {
    return (
      <SimpleRow
        href={href}
        title={project.title}
        selected={selected}
        muted={project.status === 'dropped'}
        grip={false}
      />
    );
  }

  if (mode === 'compact') {
    return (
      <Link
        href={href}
        style={{ gridTemplateColumns: ARCHIVE_COLUMNS.template }}
        className={[
          'grid items-center gap-2 border-b border-grey-150 px-4 py-1 text-[12px]',
          selected ? 'bg-selected-bg' : 'hover:bg-grey-100',
        ].join(' ')}
      >
        <span
          className={[
            'truncate',
            project.status === 'dropped'
              ? 'text-grey-500'
              : selected
                ? 'font-medium text-grey-900'
                : 'text-grey-800',
          ].join(' ')}
        >
          {project.title}
          {project.status === 'dropped' ? (
            <span className="ml-1.5 text-[11px] text-grey-400">dropped</span>
          ) : null}
        </span>
        <span className="truncate text-grey-500">{project.goalTitle ?? '—'}</span>
        <span className="truncate tabular-nums text-grey-500">{finished}</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={[
        'block border-b border-grey-150 px-4 py-2.5',
        selected ? 'bg-selected-bg' : 'hover:bg-grey-100',
      ].join(' ')}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={[
            'truncate text-[13px]',
            selected ? 'font-medium text-grey-900' : 'text-grey-800',
          ].join(' ')}
        >
          {project.title}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-grey-500">
          {project.completedAt ? dateFormat.format(project.completedAt) : 'undated'}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        {project.status === 'dropped' ? (
          <span className="rounded-sm bg-grey-200 px-1.5 py-px text-grey-600">
            dropped
          </span>
        ) : null}
        {project.doneActionCount > 0 ? (
          <span className="text-grey-500">{project.doneActionCount} done</span>
        ) : null}
        {project.hasNotes ? <span className="text-grey-500">has notes</span> : null}
      </div>
    </Link>
  );
}
