'use client';

import type { ProjectStatus } from '@gtd/db';
import { useState, useTransition } from 'react';
import {
  deleteProject,
  setProjectStatus,
  updateProjectNotes,
  updateProjectTitle,
} from '@/lib/actions';
import { NoteEditor } from './note-editor';

type ProjectDetailData = {
  id: string;
  title: string;
  status: ProjectStatus;
  standbyReason: string | null;
  notes: unknown;
  areaName: string | null;
  driveFolderId: string | null;
  gmailLabelId: string | null;
};

const STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'standby', label: 'Standby' },
  { value: 'someday', label: 'Someday' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped', label: 'Dropped' },
];

export function ProjectDetail({
  project,
  stalled,
}: {
  project: ProjectDetailData;
  stalled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(project.title);
  const [error, setError] = useState<string | null>(null);

  // Standby demands a return condition, so picking it opens a prompt inline
  // rather than silently accepting an empty reason.
  const [pendingStandby, setPendingStandby] = useState(false);
  const [reason, setReason] = useState(project.standbyReason ?? '');

  const changeStatus = (status: ProjectStatus) => {
    setError(null);

    if (status === 'standby') {
      setPendingStandby(true);
      return;
    }

    startTransition(async () => {
      await setProjectStatus(project.id, status);
    });
  };

  const confirmStandby = () => {
    if (!reason.trim()) {
      setError('Standby needs a return condition — what brings this back?');
      return;
    }
    startTransition(async () => {
      await setProjectStatus(project.id, 'standby', reason);
      setPendingStandby(false);
    });
  };

  return (
    <div className={pending ? 'opacity-60' : ''}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title.trim() && title !== project.title) {
            startTransition(async () => {
              await updateProjectTitle(project.id, title);
            });
          }
        }}
        className="w-full border-none bg-transparent text-xl font-semibold text-grey-900 focus:outline-none"
      />

      <p className="mt-1 text-[12px] text-grey-500">
        {project.areaName ?? 'No area of focus'}
      </p>

      {stalled ? (
        <div className="mt-4 rounded-sm bg-stale-bg px-3 py-2 text-[12px] text-stale">
          Stalled — this project is active but has no next action.
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => changeStatus(s.value)}
            className={[
              'rounded-sm border px-2 py-1 text-[12px]',
              project.status === s.value
                ? 'border-grey-800 bg-grey-800 text-paper'
                : 'border-grey-300 text-grey-600 hover:border-grey-500',
            ].join(' ')}
          >
            {s.label}
          </button>
        ))}
      </div>

      {pendingStandby ? (
        <div className="mt-3 rounded-sm border border-grey-300 bg-grey-50 px-3 py-2.5">
          <label className="block text-[11px] font-medium text-grey-600">
            Return condition — what brings this back?
          </label>
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmStandby()}
            placeholder="e.g. awaiting the bonus in October"
            className="mt-1.5 w-full rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[12px] focus:border-grey-500 focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={confirmStandby}
              className="rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper"
            >
              Set standby
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingStandby(false);
                setError(null);
              }}
              className="text-[11px] text-grey-500 underline underline-offset-2"
            >
              Cancel
            </button>
          </div>
          {error ? <p className="mt-1.5 text-[11px] text-stale">{error}</p> : null}
        </div>
      ) : project.status === 'standby' && project.standbyReason ? (
        <div className="mt-3 rounded-sm bg-waiting-bg px-3 py-2 text-[12px] text-waiting">
          On standby until: {project.standbyReason}
        </div>
      ) : null}

      <section className="mt-7 border-t border-grey-150 pt-5">
        <NoteEditor
          key={project.id}
          initialContent={project.notes}
          placeholder="Project notes, outcome, reference…"
          onSave={async (doc) => {
            await updateProjectNotes(project.id, doc);
          }}
        />
      </section>

      <footer className="mt-8 space-y-2 border-t border-grey-150 pt-3">
        <p className="text-[11px] text-grey-400">
          Drive folder:{' '}
          {project.driveFolderId ?? 'not linked (Google sync stubbed this session)'}
          {' · '}Gmail label: {project.gmailLabelId ?? 'not linked'}
        </p>
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              await deleteProject(project.id);
            })
          }
          className="text-[11px] text-grey-400 underline underline-offset-2 hover:text-stale"
        >
          Delete project
        </button>
      </footer>
    </div>
  );
}
