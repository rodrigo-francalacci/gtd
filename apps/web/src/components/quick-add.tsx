'use client';

import { useRef } from 'react';
import { createAction, createProject } from '@/lib/actions';
import { ListPhoto } from './list-photo';

/**
 * Zero-friction add: one field, Enter to commit, stays focused for the next
 * one. Nothing else is required — clarification happens later.
 */
export function QuickAddAction({
  projectId,
  /**
   * Which bucket the new action joins. Omitted means Active, which is what
   * adding an action almost always means.
   */
  status,
  placeholder = 'Add an action…',
}: {
  projectId?: string;
  status?: 'next' | 'future';
  placeholder?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await createAction(formData);
        formRef.current?.reset();
      }}
      className="flex flex-wrap items-center gap-2 border-b border-grey-200 bg-paper px-4 py-2"
    >
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      {status ? <input type="hidden" name="status" value={status} /> : null}
      <input
        name="title"
        placeholder={placeholder}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-[13px] text-grey-800 placeholder:text-grey-500 focus:outline-none"
      />

      {/* The same row, because it is the same act: putting things on this list.
          A future bucket is not a page you photograph into, so it keeps the
          plain field. */}
      {status === 'future' ? null : (
        <ListPhoto kind={projectId ? 'project' : 'now'} projectId={projectId} />
      )}
    </form>
  );
}

export function QuickAddProject({ areaId }: { areaId?: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        // createProject redirects to the new project, so no reset is needed.
        await createProject(formData);
      }}
      className="border-b border-grey-200 bg-paper px-4 py-2"
    >
      {areaId ? <input type="hidden" name="areaId" value={areaId} /> : null}
      <input
        name="title"
        placeholder="Add a project…"
        autoComplete="off"
        className="w-full bg-transparent text-[13px] text-grey-800 placeholder:text-grey-500 focus:outline-none"
      />
    </form>
  );
}
