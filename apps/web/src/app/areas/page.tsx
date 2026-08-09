import Link from 'next/link';
import { DetailPane, EmptyList, ListPane } from '@/components/panes';
import { getAreasWithCounts, getProjects } from '@/lib/queries';

/**
 * Areas and goals are parent fields on projects, not standalone lists — so
 * this view exists to surface the gaps: an area carrying no active projects is
 * the signal worth seeing.
 */
export default async function AreasPage() {
  const [areas, projects] = await Promise.all([getAreasWithCounts(), getProjects()]);
  const empty = areas.filter((a) => a.activeProjects === 0);

  return (
    <>
      <ListPane
        title="Areas & goals"
        subtitle={
          empty.length > 0
            ? `${empty.length} area${empty.length === 1 ? '' : 's'} with nothing active`
            : 'Every area has active work'
        }
      >
        {areas.length === 0 ? (
          <EmptyList message="No areas of focus yet." />
        ) : (
          areas.map((a) => (
            <div key={a.id} className="border-b border-grey-150 px-4 py-2.5">
              <span className="block text-[13px] text-grey-800">{a.name}</span>
              <span
                className={[
                  'mt-1 block text-[11px]',
                  a.activeProjects === 0 ? 'text-stale' : 'text-grey-500',
                ].join(' ')}
              >
                {a.activeProjects === 0
                  ? 'nothing active — is this area still yours?'
                  : `${a.activeProjects} active project${a.activeProjects === 1 ? '' : 's'}`}
              </span>
            </div>
          ))
        )}
      </ListPane>

      <DetailPane>
        <h1 className="text-xl font-semibold text-grey-900">Horizons</h1>
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-grey-600">
          An area with no active projects, or a goal with nothing under it, is the
          thing worth noticing here — that gap is the whole point of the horizon.
        </p>

        <section className="mt-6">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
            Projects by area
          </h2>
          {areas.map((a) => {
            const mine = projects.filter(
              (p) => p.areaName === a.name && p.status === 'active',
            );
            return (
              <div key={a.id} className="mb-4">
                <h3 className="text-[13px] font-medium text-grey-800">{a.name}</h3>
                {mine.length === 0 ? (
                  <p className="mt-1 text-[12px] text-grey-400">No active projects</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {mine.map((p) => (
                      <li key={p.id}>
                        <Link
                          href={`/projects/${p.id}`}
                          className="text-[12px] text-grey-600 underline-offset-2 hover:underline"
                        >
                          {p.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>

        <p className="mt-8 border-t border-grey-150 pt-3 text-[11px] text-grey-400">
          Editing areas and goals, and reassigning a project&apos;s parent, come next
          session.
        </p>
      </DetailPane>
    </>
  );
}
