'use client';

import { useRef } from 'react';
import { emojifyLater } from '@/lib/emojify-later';
import { createListItem } from '@/lib/actions';

/** Zero-friction capture onto a list. Nothing here is a commitment yet. */
export function QuickAddListItem({ listId }: { listId: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        /* Not awaited: adding the next line must not wait on a model. */
        emojifyLater('list_items', await createListItem(formData));
        formRef.current?.reset();
      }}
      className="border-b border-grey-200 bg-paper px-4 py-2"
    >
      <input type="hidden" name="listId" value={listId} />
      <input
        name="title"
        placeholder="Add to this list…"
        autoComplete="off"
        className="w-full bg-transparent text-[13px] text-grey-800 placeholder:text-grey-500 focus:outline-none"
      />
    </form>
  );
}
