import Link from 'next/link';
import { AreaDetail, GoalDetail } from '@/components/horizon-detail';
import { NewAreaForm } from '@/components/new-area-form';
import { DetailPane, EmptyList, ListPane } from '@/components/panes';
import {
  getArea,
  getAreaTree,
  getGoal,
  getProjectsFor,
} from '@/lib/queries';
import { getPreferences, paneWidth } from '@/lib/view-mode';

/**
 * Areas and goals are parent fields on projects, not standalone lists — so the
 * job of this view is twofold: let you edit the horizon, and make the gaps
 * visible. An area with nothing active under it is the signal.
 */
export default async function AreasPage(props: PageProps<'/areas'>) {
  const searchParams = await props.searchParams;
  const areaId = typeof searchParams.area === 'string' ? searchParams.area : null;
  const goalId = typeof searchParams.goal === 'string' ? searchParams.goal : null;

  const [{ areas, looseGoals }, prefs] = await Promise.all([
    getAreaTree(),
    getPreferences(),
  ]);

  const [selectedArea, selectedGoal] = await Promise.all([
    areaId ? getArea(areaId) : Promise.resolve(null),
    goalId ? getGoal(goalId) : Promise.resolve(null),
  ]);

  const detailProjects = selectedGoal
    ? await getProjectsFor({ goalId: selectedGoal.id })
    : selectedArea
      ? await getProjectsFor({ areaId: selectedArea.id })
      : [];

  const emptyAreas = areas.filter((a) => a.activeProjects === 0).length;

  return (
    <>
      <ListPane
        title="Areas & goals"
        paneWidth={paneWidth(prefs)}
        subtitle={
          emptyAreas > 0
            ? `${emptyAreas} area${emptyAreas === 1 ? '' : 's'} with nothing active`
            : 'Every area has active work'
        }
      >
        <NewAreaForm />

        {areas.length === 0 && looseGoals.length === 0 ? (
          <EmptyList message="No areas of focus yet. Add one above." />
        ) : null}

        {areas.map((area) => (
          <div key={area.id}>
            <Link
              href={`/areas?area=${area.id}`}
              className={[
                'block border-b border-grey-150 px-4 py-2.5',
                area.id === areaId && !goalId ? 'bg-selected-bg' : 'hover:bg-grey-100',
              ].join(' ')}
            >
              <span
                className={[
                  'block truncate text-[13px]',
                  area.id === areaId && !goalId
                    ? 'font-medium text-grey-900'
                    : 'text-grey-800',
                ].join(' ')}
              >
                {area.name}
              </span>
              <span
                className={[
                  'mt-1 block text-[11px]',
                  area.activeProjects === 0 ? 'text-stale' : 'text-grey-500',
                ].join(' ')}
              >
                {area.activeProjects === 0
                  ? 'nothing active — is this area still yours?'
                  : `${area.activeProjects} active project${
                      area.activeProjects === 1 ? '' : 's'
                    }`}
              </span>
            </Link>

            {area.goals.map((goal) => (
              <Link
                key={goal.id}
                href={`/areas?goal=${goal.id}`}
                className={[
                  'flex items-baseline justify-between gap-2 border-b border-grey-150 py-1.5 pl-9 pr-4',
                  goal.id === goalId ? 'bg-selected-bg' : 'hover:bg-grey-100',
                ].join(' ')}
              >
                <span
                  className={[
                    'truncate text-[12px]',
                    goal.id === goalId
                      ? 'font-medium text-grey-900'
                      : 'text-grey-600',
                  ].join(' ')}
                >
                  {goal.title}
                </span>
                <span
                  className={[
                    'shrink-0 text-[11px]',
                    goal.activeProjects === 0 ? 'text-stale' : 'text-grey-500',
                  ].join(' ')}
                >
                  {goal.activeProjects === 0 ? 'none' : goal.activeProjects}
                </span>
              </Link>
            ))}
          </div>
        ))}

        {looseGoals.length > 0 ? (
          <section>
            <h3 className="sticky top-0 z-20 bg-grey-100 px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
              Goals with no area
            </h3>
            {looseGoals.map((goal) => (
              <Link
                key={goal.id}
                href={`/areas?goal=${goal.id}`}
                className={[
                  'block border-b border-grey-150 px-4 py-2',
                  goal.id === goalId ? 'bg-selected-bg' : 'hover:bg-grey-100',
                ].join(' ')}
              >
                <span className="truncate text-[12px] text-grey-600">{goal.title}</span>
              </Link>
            ))}
          </section>
        ) : null}
      </ListPane>

      <DetailPane>
        {selectedGoal ? (
          <GoalDetail
            goal={selectedGoal}
            areas={areas.map((a) => ({ id: a.id, name: a.name }))}
            projects={detailProjects}
          />
        ) : selectedArea ? (
          <AreaDetail
            area={selectedArea}
            goals={areas.find((a) => a.id === selectedArea.id)?.goals ?? []}
            projects={detailProjects}
          />
        ) : (
          <>
            <h1 className="text-xl font-semibold text-grey-900">Horizons</h1>
            <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-grey-600">
              An area with no active projects, or a goal with nothing under it, is
              the thing worth noticing here — that gap is the whole point of the
              horizon. Select one to edit it, or add an area above.
            </p>
          </>
        )}
      </DetailPane>
    </>
  );
}
