'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  createGoal,
  deleteArea,
  deleteGoal,
  updateArea,
  updateGoal,
} from '@/lib/actions';
import type { ProjectRow } from '@/lib/queries.shared';

/** Shared: an inline-editable heading that saves on blur. */
function EditableTitle({
  value,
  onSave,
  pending,
}: {
  value: string;
  onSave: (next: string) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() && draft !== value) onSave(draft);
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      disabled={pending}
      className="w-full border-none bg-transparent text-xl font-semibold text-grey-900 focus:outline-none"
    />
  );
}

function ProjectList({ projects }: { projects: ProjectRow[] }) {
  if (projects.length === 0) {
    return (
      <p className="mt-1 text-[12px] text-grey-400">
        No active projects. That gap is the thing worth noticing here.
      </p>
    );
  }

  return (
    <ul className="mt-1 space-y-0.5">
      {projects.map((p) => (
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
  );
}

export function AreaDetail({
  area,
  goals,
  projects,
}: {
  area: { id: string; name: string };
  goals: { id: string; title: string; activeProjects: number }[];
  projects: ProjectRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [newGoal, setNewGoal] = useState('');
  const run = (fn: () => Promise<unknown>) => startTransition(() => void fn());

  return (
    <div className={pending ? 'opacity-60' : ''}>
      <EditableTitle
        value={area.name}
        pending={pending}
        onSave={(next) => run(() => updateArea(area.id, next))}
      />
      <p className="mt-1 text-[12px] text-grey-500">Area of focus</p>

      <section className="mt-6">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          Goals under this area
        </h2>

        {goals.length === 0 ? (
          <p className="text-[12px] text-grey-400">No goals yet.</p>
        ) : (
          <ul className="space-y-1">
            {goals.map((g) => (
              <li key={g.id} className="flex items-baseline justify-between gap-2">
                <Link
                  href={`/areas?goal=${g.id}`}
                  className="text-[13px] text-grey-700 underline-offset-2 hover:underline"
                >
                  {g.title}
                </Link>
                <span
                  className={[
                    'text-[11px]',
                    g.activeProjects === 0 ? 'text-stale' : 'text-grey-500',
                  ].join(' ')}
                >
                  {g.activeProjects === 0
                    ? 'nothing active'
                    : `${g.activeProjects} active`}
                </span>
              </li>
            ))}
          </ul>
        )}

        <form
          action={() => {
            if (!newGoal.trim()) return;
            run(async () => {
              await createGoal(area.id, newGoal);
              setNewGoal('');
            });
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={newGoal}
            onChange={(e) => setNewGoal(e.target.value)}
            placeholder="Add a goal…"
            className="flex-1 rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[12px] focus:border-grey-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!newGoal.trim()}
            className="rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-40"
          >
            Add
          </button>
        </form>
      </section>

      <section className="mt-7">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          Active projects
        </h2>
        <ProjectList projects={projects} />
      </section>

      <footer className="mt-8 border-t border-grey-150 pt-3">
        <button
          type="button"
          onClick={() => run(() => deleteArea(area.id))}
          className="text-[11px] text-grey-400 underline underline-offset-2 hover:text-stale"
        >
          Delete area
        </button>
        <p className="mt-1 text-[11px] text-grey-400">
          Projects and goals under it survive — they just lose their parent.
        </p>
      </footer>
    </div>
  );
}

export function GoalDetail({
  goal,
  areas,
  projects,
}: {
  goal: {
    id: string;
    title: string;
    targetDate: string | null;
    areaId: string | null;
  };
  areas: { id: string; name: string }[];
  projects: ProjectRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState(goal.targetDate ?? '');
  const run = (fn: () => Promise<unknown>) => startTransition(() => void fn());

  return (
    <div className={pending ? 'opacity-60' : ''}>
      <EditableTitle
        value={goal.title}
        pending={pending}
        onSave={(next) => run(() => updateGoal(goal.id, { title: next }))}
      />
      <p className="mt-1 text-[12px] text-grey-500">Goal</p>

      <section className="mt-6 grid max-w-md grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
            Area of focus
          </label>
          <select
            value={goal.areaId ?? ''}
            onChange={(e) =>
              run(() => updateGoal(goal.id, { areaId: e.target.value || null }))
            }
            className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
          >
            <option value="">No area</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-grey-500">
            Target date
          </label>
          <input
            type="date"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={() => run(() => updateGoal(goal.id, { targetDate: target }))}
            className="mt-1 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[13px] focus:border-grey-500 focus:outline-none"
          />
        </div>
      </section>

      <section className="mt-7">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-grey-500">
          Active projects
        </h2>
        <ProjectList projects={projects} />
      </section>

      <footer className="mt-8 border-t border-grey-150 pt-3">
        <button
          type="button"
          onClick={() => run(() => deleteGoal(goal.id))}
          className="text-[11px] text-grey-400 underline underline-offset-2 hover:text-stale"
        >
          Delete goal
        </button>
      </footer>
    </div>
  );
}
