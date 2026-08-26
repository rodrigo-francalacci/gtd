'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AttachmentParentType } from '@gtd/db';
import { requestEmail } from '@/lib/actions';

/**
 * Ask for a message from the thing it is about.
 *
 * The other control in this section — "Link an email" — offers messages already
 * filed in a box. This is the one that fetches a new one, and the two together
 * are the honest pair: *cite one you have*, and *go and get one*. Having only
 * the first meant pasting a Gmail address into a box, waiting, then coming back
 * here to find it, which is two steps too many for the commonest case.
 *
 * The message still goes into a box. A message that existed only as one
 * project's evidence would vanish with the project, and the whole point of a box
 * is that it outlives the reason you filed something in it. The link is what is
 * extra, and it is written by the app when the bridge reports back.
 *
 * Nothing happens immediately, which is the thing to be honest about: the app
 * cannot read Gmail and the script runs on a trigger. The line it leaves behind
 * says so, and the same waiting line appears in the box.
 */
export function AskForEmail({
  parentType,
  parentId,
}: {
  parentType: AttachmentParentType;
  parentId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const body = text.trim();
    if (!body) return;

    setError(null);

    startTransition(async () => {
      // Null box: the default one. Which box a message asked for from a project
      // belongs in is not a question worth stopping to answer.
      const result = await requestEmail(null, body, { parentType, parentId });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setText('');
      setAsked(true);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
      >
        Fetch an email
      </button>
    );
  }

  return (
    <div className="flex min-w-0 basis-full flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <input
          autoFocus
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setAsked(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
            if (event.key === 'Escape') setOpen(false);
          }}
          placeholder="Gmail link, message id, or from:sam worktop"
          aria-label="Find an email"
          /* 16px, or iOS Safari zooms the pane in when this takes focus. */
          className="min-w-0 flex-1 rounded-sm border border-grey-300 bg-paper px-2 py-1 text-[16px] text-grey-800 placeholder:text-grey-400 focus:border-selected focus:outline-none md:text-[12px]"
        />

        <button
          type="button"
          onClick={submit}
          disabled={pending || text.trim() === ''}
          className="shrink-0 rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-40"
        >
          Fetch
        </button>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="shrink-0 text-[11px] text-grey-500 underline underline-offset-2"
        >
          Close
        </button>
      </div>

      {error ? (
        <p className="text-[11px] text-stale">{error}</p>
      ) : asked ? (
        <p className="text-[11px] text-grey-500">
          Asked for. It will appear here once the bridge has fetched it.
        </p>
      ) : (
        /* Said before it is needed, because "nothing happened" is what an
           unexplained delay looks like, and this one is minutes long. */
        <p className="text-[11px] text-grey-400">
          Fetched by the Gmail bridge on its next run — the app cannot read your
          mail itself. A search files every message it matches.
        </p>
      )}
    </div>
  );
}
