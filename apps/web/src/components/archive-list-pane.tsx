import Link from 'next/link';
import { EmptyList, ListPane } from '@/components/panes';
import { ARCHIVE_COLUMNS } from '@/lib/columns';
import type { ArchivedProjectRow } from '@/lib/queries';
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
  selectedId,
  showDropped,
  viewMode,
  paneWidth,
}: {
  projects: ArchivedProjectRow[];
  selectedId: string | null;
  showDropped: boolean;
  viewMode: ViewMode;
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
      paneWidth={paneWidth}
      columns={ARCHIVE_COLUMNS}
      subtitle={
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {rows.length} finished project{rows.length === 1 ? '' : 's'}
          </span>
          {droppedCount > 0 ? (
            <Link
              href={showDropped ? '/archive' : '/archive?dropped=1'}
              className="underline underline-offset-2"
            >
              {showDropped ? 'Hide dropped' : `Show ${droppedCount} dropped`}
            </Link>
          ) : null}
        </div>
      }
    >
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
    </ListPane>
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
