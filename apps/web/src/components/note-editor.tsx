'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyDoc } from '@/lib/tiptap';
import { EditorToolbar } from './editor-toolbar';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

const AUTOSAVE_MS = 800;

/**
 * Round-trip the document through JSON before handing it to a Server Action.
 *
 * ProseMirror builds node and mark `attrs` with `Object.create(null)`, and
 * React's Server Action serialiser silently drops objects without
 * `Object.prototype` — no error, the property simply never arrives. That cost
 * every link its `href`: the editor showed it, the client sent it, and the
 * server received `{"type":"link"}` with no attrs at all.
 *
 * Anything with attributes is affected, so this belongs here rather than in a
 * link-specific fix.
 */
function toPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * TipTap bound to a `notes` jsonb column. Content is stored as ProseMirror
 * JSON, never HTML, so structure survives round-tripping and attachments can
 * become real nodes later without a migration.
 */
export function NoteEditor({
  initialContent,
  onSave,
  placeholder = 'Notes…',
}: {
  initialContent: unknown;
  onSave: (doc: unknown) => Promise<void>;
  placeholder?: string;
}) {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held in a ref so the debounce callback always sees the latest doc without
  // being re-created on every keystroke.
  const latest = useRef<unknown>(null);

  const flush = useCallback(async () => {
    if (latest.current === null) return;
    setState('saving');
    await onSave(latest.current);
    latest.current = null;
    setState('saved');
  }, [onSave]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Link ships inside StarterKit v3 — configured, not added, or the
        // duplicate extension name throws.
        link: {
          openOnClick: false, // clicking in the editor should place the cursor
          autolink: true,
          defaultProtocol: 'https',
          protocols: ['http', 'https', 'mailto'],
          HTMLAttributes: {
            // Notes can hold anything; treat every link as untrusted.
            rel: 'noopener noreferrer nofollow',
            target: '_blank',
          },
        },
      }),
    ],
    content: (initialContent as object) ?? emptyDoc,
    // Editors render on the client only; rendering on the server first causes
    // a hydration mismatch against ProseMirror's own DOM.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'text-[14px] text-grey-800',
        'data-placeholder': placeholder,
      },
    },
    onUpdate: ({ editor }) => {
      latest.current = toPlainJson(editor.getJSON());
      setState('dirty');

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, AUTOSAVE_MS);
    },
  });

  // Save on unmount / navigation away so a pending debounce isn't lost.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
  }, [flush]);

  // NOTE: there is deliberately no effect resyncing `initialContent`.
  //
  // Saving revalidates the route, so the server sends a fresh `notes` object
  // on every autosave. Calling setContent on that would reset the document
  // mid-sentence and throw away whatever was typed since the save started.
  // Switching to a different project or action is handled by `key={id}` at
  // the call sites, which remounts the editor with the right content.

  return (
    <div>
      <div className="mb-1 flex h-4 items-center justify-end">
        <span className="text-[11px] text-grey-400">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
