'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { NoteColourMark } from '@/lib/note-colour';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyDoc } from '@/lib/tiptap';
import { EditorToolbar } from './editor-toolbar';
import { RememberedHeight } from './remembered-height';
import { setNoteDense, type NoteSurface } from '@/lib/actions';

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
  surface,
  id,
  height,
  dense,
}: {
  initialContent: unknown;
  onSave: (doc: unknown) => Promise<void>;
  /** Which table this note lives in, so its height is saved against the row. */
  surface: NoteSurface;
  id: string;
  /**
   * What this note was last dragged to. Null means never, and the variable's
   * default — the last height used anywhere — applies instead.
   */
  height: number | null;
  /**
   * Whether this note is compact. **Null means yes.**
   *
   * Tight is the default, so the column records a *departure* from it: only a
   * note somebody has deliberately opened out stores `false`. That way every
   * note written before this existed reads the way a new one does, with nothing
   * to migrate — the alternative was writing `true` across four tables to say
   * what the absence of a value already says.
   */
  dense: boolean | null;
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
          /**
           * A click follows the link.
           *
           * This was false, on the reasoning that a click inside an editor
           * should place the cursor — true of a text editor, wrong here. These
           * notes are read far more often than they are edited, and a link you
           * cannot click is not really a link; you end up copying the address
           * out by hand, which is what a link exists to save you.
           *
           * The cursor is still reachable: click just past the link, or arrow
           * into it. Editing an existing link is the toolbar's job either way —
           * `extendMarkRange` means the cursor need only be somewhere in it.
           * And `target="_blank"` means a mis-click opens a tab rather than
           * navigating away from an unsaved note.
           */
          openOnClick: true,
          autolink: true,
          // The protocol list is what makes a clickable link safe: a
          // `javascript:` href in a note would otherwise be a script that runs
          // when clicked, and notes hold whatever gets pasted into them.
          defaultProtocol: 'https',
          protocols: ['http', 'https', 'mailto'],
          HTMLAttributes: {
            // Notes can hold anything; treat every link as untrusted.
            rel: 'noopener noreferrer nofollow',
            target: '_blank',
          },
        },
      }),
      NoteColourMark,
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

  /** The resizable box around the editor, watched so its height is kept. */
  const box = useRef<HTMLDivElement>(null);

  /*
   * Local, so the spacing changes as you press it rather than after a round
   * trip. Seeded from the row and never resynced: the call sites key this
   * component on the row's id, so a different note remounts with its own value.
   */
  const [tight, setTight] = useState(dense !== false);

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
      <EditorToolbar
        editor={editor}
        tight={tight}
        onTight={(next) => {
          setTight(next);
          void setNoteDense(surface, id, next);
        }}
      />

      {/*
        Resizable, and it remembers.

        TipTap renders a plain div that grows with its content, so there was no
        way to make the editor taller at all — the only "resize" available was
        the one on a textarea somewhere else in the app. A wrapper with
        `resize-y` gives it the handle, `overflow-auto` is what makes the handle
        do anything (an element that cannot scroll has nothing to resize *to*),
        and the height comes from a variable the layout sets on the server so it
        is right on first paint rather than jumping after one.
      */}
      {/*
        This note's own height wins; the variable is the fallback for one that
        has never been dragged, and carries the last height used anywhere so a
        fresh note is not short again.
      */}
      <div
        ref={box}
        style={height ? { height: `${height}px` } : undefined}
        className={[
          'h-[var(--note-height,16rem)] min-h-24 resize-y overflow-auto rounded-sm',
          // The wrapper carries it, so the leading reaches the headings and
          // lists inside as well as the paragraphs.
          tight ? 'note-tight' : '',
        ].join(' ')}
      >
        <EditorContent editor={editor} />
      </div>

      <RememberedHeight surface={surface} id={id} target={box} />
    </div>
  );
}
