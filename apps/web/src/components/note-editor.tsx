'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { NoteColourMark } from '@/lib/note-colour';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyDoc } from '@/lib/tiptap';
import { useRouter } from 'next/navigation';
import { EditorToolbar, type LinkTarget } from './editor-toolbar';
import { InternalLinkMark } from '@/lib/internal-link-mark';
import {
  hrefFor as internalHref,
  focusedHref,
  openHref,
  readToken,
} from '@/lib/internal-link';
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
  targets,
  openBase,
  fill = false,
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
  /**
   * Projects and actions this note can point at, by name. Absent leaves the
   * paste-an-id path, which is what "Copy id" on a row exists for.
   */
  targets?: LinkTarget[];
  /**
   * The address an internal link should open *on*, if there is a pane here that
   * can show one.
   *
   * A string rather than a function, and that is forced rather than chosen: a
   * Server Component cannot hand a function to a client one, so the page passes
   * its own URL and the resolving happens on this side. Absent, a link falls
   * back to the target's own page.
   */
  openBase?: string;
  /**
   * Take the height available instead of the height you were dragged to.
   *
   * A remembered height is the right answer in a pane, where the note is one
   * section among several and how much of the column it should claim is a real
   * decision. In the focus view it is the *only* thing in its column, and a
   * note sized to a pane sitting in the top third of a full-screen editor with
   * dead space under it is the view failing to be what it is for.
   *
   * The handle goes with it, and so does remembering: there is nothing to
   * choose when the answer is "all of it", and writing a window-sized height
   * back to the row would then follow the note into every pane it appears in.
   */
  fill?: boolean;
}) {
  const router = useRouter();
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
      InternalLinkMark,
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

  /**
   * The measure, when the note has a whole window to itself.
   *
   * Filling the width was wrong and the number says how wrong: on this screen
   * the editor was running to **152 characters a line**, against the 45–75 that
   * every source on the question agrees about — Bringhurst calls 66 ideal for a
   * single column, Butterick asks for two to three alphabets, and WCAG's AAA
   * ceiling is 80. Past that the eye loses the start of the next line on the
   * return sweep, which is exactly the "this gets in the way of focus" feeling:
   * you are not reading slower, you are re-finding your place.
   *
   * **`ch` rather than `rem`, and 60 rather than 66.** `1ch` is the width of a
   * zero, which in a monospace face is one character and in a proportional one
   * is wider than the average letter — measured here, Source Sans averages
   * 6.53px a character against a 7.83px zero. So `66ch` would give 66 characters
   * in the console and riso themes and **79** in the others, which is over the
   * line. 60 lands at 72 and 60 respectively: both inside the range, in a unit
   * that follows whatever face and size the theme is using rather than freezing
   * one theme's arithmetic for all six.
   *
   * The toolbar is inside the measure too. Controls running the full width above
   * a column of text half that wide reads as a mistake rather than as a margin.
   */
  const column = fill ? 'mx-auto w-full max-w-[60ch] text-[14px]' : undefined;

  return (
    <div className={fill ? 'flex h-full min-h-0 flex-col' : undefined}>
      <div className={['mb-1 flex h-4 shrink-0 items-center justify-end', column ?? ''].join(' ')}>
        <span className="text-[11px] text-grey-400">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      <div className={column}>
      <EditorToolbar
        editor={editor}
        targets={targets}
        tight={tight}
        onTight={(next) => {
          setTight(next);
          void setNoteDense(surface, id, next);
        }}
      />
      </div>

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
      {/*
        A click on an internal link follows it, the same courtesy a URL link
        gets - and for the same reason, since these notes are read far more
        often than they are edited.

        Delegated from the wrapper rather than added as a ProseMirror plugin,
        because what happens next is a *navigation* and the router lives out
        here. `closest` is what makes it work over a link that has been split by
        another mark: the span carrying the token is the nearest ancestor of
        whatever was actually clicked.

        A plain click only. A modified one falls through to the browser, which
        is the rule every other link in this app follows - except that these
        spans have no href, so `open` is used to honour it explicitly rather
        than leaving ctrl-click doing nothing at all.
      */}
      <div
        ref={fill ? undefined : box}
        onClickCapture={(event) => {
          const span = (event.target as HTMLElement | null)?.closest?.(
            'span[data-internal]',
          );
          if (!span) return;

          const target = readToken(span.getAttribute('data-internal') ?? '');
          if (!target) return;

          /*
           * Following a link should not drop you back into the panes.
           *
           * `fill` means this editor *is* the full-screen view, so the link goes
           * to the target's own focus view rather than to pane three of a page
           * you can no longer see. Reading a note, following what it points at,
           * and reading that one is a single activity; changing the shape of the
           * window half way through it is the app interrupting.
           */
          const href = fill
            ? focusedHref(target)
            : openBase
              ? openHref(openBase, target)
              : internalHref(target);

          event.preventDefault();
          event.stopPropagation();

          const modified =
            event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1;

          // A new tab for a modified click, and for anything the page has sent
          // outside the app - read off the address, because only the page
          // knows whether it has a pane that can show this.
          if (modified || !href.startsWith('/')) {
            window.open(href, '_blank', 'noopener,noreferrer');
            return;
          }

          router.push(href);
        }}
        style={!fill && height ? { height: `${height}px` } : undefined}
        className={[
          fill
            // `min-h-0` above a scroller in a flex column, or it grows to its
            // content and the whole modal scrolls instead of the note.
            //
            // The measure goes on the *scroller*, so the scrollbar sits at the
            // edge of the column of text rather than out at the panel's edge
            // with a stripe of nothing between them.
            ? `min-h-0 flex-1 overflow-auto rounded-sm ${column}`
            : 'h-[var(--note-height,16rem)] min-h-24 resize-y overflow-auto rounded-sm',
          // The wrapper carries it, so the leading reaches the headings and
          // lists inside as well as the paragraphs.
          tight ? 'note-tight' : '',
        ].join(' ')}
      >
        <EditorContent editor={editor} />
      </div>

      {fill ? null : <RememberedHeight surface={surface} id={id} target={box} />}
    </div>
  );
}
