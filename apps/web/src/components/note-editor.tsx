'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyDoc } from '@/lib/tiptap';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

const AUTOSAVE_MS = 800;

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
    extensions: [StarterKit],
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
      latest.current = editor.getJSON();
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

  // Swap content when the selected item changes without remounting the editor.
  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent((initialContent as object) ?? emptyDoc, {
      emitUpdate: false,
    });
    latest.current = null;
    setState('idle');
  }, [editor, initialContent]);

  return (
    <div>
      <div className="mb-1 flex h-4 items-center justify-end">
        <span className="text-[11px] text-grey-400">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
