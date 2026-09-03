'use client';

import { useRef } from 'react';
import { createArea } from '@/lib/actions';

export function NewAreaForm() {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        // createArea redirects to the new area, so no reset is needed.
        await createArea(String(formData.get('name') ?? ''));
      }}
      className="border-b border-grey-200 bg-paper px-4 py-2"
    >
      <input
        name="name"
        placeholder="Add an area of focus…"
        autoComplete="off"
        className="w-full bg-transparent text-[13px] text-grey-800 placeholder:text-grey-500 focus:outline-none"
      />
    </form>
  );
}
