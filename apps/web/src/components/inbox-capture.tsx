'use client';

import { useRef } from 'react';
import { captureInboxItem } from '@/lib/actions';

/**
 * Capture. One field, no classification, nothing required — the whole point is
 * that getting a thought out of your head costs nothing. Deciding what it is
 * happens later, on the clarify screen.
 *
 * Enter commits; Shift+Enter starts a new line, because a captured thought is
 * often more than one.
 */
export function InboxCapture() {
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await captureInboxItem(formData);
        formRef.current?.reset();
        fieldRef.current?.focus();
      }}
      className="border-b border-grey-200 bg-paper px-4 py-3"
    >
      <textarea
        ref={fieldRef}
        name="rawText"
        rows={2}
        autoFocus
        placeholder="What's on your mind?"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            formRef.current?.requestSubmit();
          }
        }}
        className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-grey-800 placeholder:text-grey-400 focus:outline-none"
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[11px] text-grey-400">
          Enter to capture · Shift+Enter for a new line
        </span>
        <button
          type="submit"
          className="rounded-sm bg-grey-800 px-2 py-0.5 text-[11px] text-paper"
        >
          Capture
        </button>
      </div>
    </form>
  );
}
