'use client';

import { useRef } from 'react';
import { createAction, createProject } from '@/lib/actions';

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
      className="border-b border-grey-200 bg-paper px-4 py-2"
    >
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      {status ? <input type="hidden" name="status" value={status} /> : null}
      <input
        name="title"
        placeholder={placeholder}
        autoComplete="off"
        className="w-full bg-transparent text-[13px] text-grey-800 placeholder:text-grey-500 focus:outline-none"
      />
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
