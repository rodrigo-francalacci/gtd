'use client';

import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { NOTE_COLOURS, colourVar } from '@/lib/note-colour';
import { readInternalInput, tokenFor, type InternalTarget } from '@/lib/internal-link';

/** Something a note can point at, offered by name. */
export type LinkTarget = InternalTarget & { title: string };

/**
 * Only http/https/mailto are accepted. TipTap validates too, but a
 * `javascript:` URL pasted into the link box is exactly the kind of thing
 * worth refusing in our own code rather than trusting a library default.
 */
const SAFE_PROTOCOL = /^(https?:|mailto:)/i;

export function normaliseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A bare domain is what people actually type.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  if (!SAFE_PROTOCOL.test(candidate)) return null;

  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

type ButtonSpec = {
  label: string;
  title: string;
  isActive?: () => boolean;
  run: () => void;
  /** Rendered in a heavier weight / italic etc. to hint at what it does. */
  className?: string;
};

export function EditorToolbar({
  editor,
  tight,
  onTight,
  targets,
}: {
  editor: Editor | null;
  /** Whether this note is set compact. */
  tight: boolean;
  onTight: (next: boolean) => void;
  /**
   * Projects and actions this note could point at, by name.
   *
   * Optional, and that is deliberate: the paste-an-id path works with nothing
   * loaded at all, so a pane with no list to hand still offers the feature
   * rather than hiding it. Where a list is passed, choosing by name is the path
   * anybody actually takes.
   */
  targets?: LinkTarget[];
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  const [insideOpen, setInsideOpen] = useState(false);
  const [insideValue, setInsideValue] = useState('');
  const [insideError, setInsideError] = useState(false);
  const insideRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (linkOpen) linkRef.current?.focus();
  }, [linkOpen]);

  useEffect(() => {
    if (insideOpen) insideRef.current?.focus();
  }, [insideOpen]);

  if (!editor) return null;

  const groups: ButtonSpec[][] = [
    [
      {
        label: 'B',
        title: 'Bold (Ctrl+B)',
        className: 'font-bold',
        isActive: () => editor.isActive('bold'),
        run: () => editor.chain().focus().toggleBold().run(),
      },
      {
        label: 'I',
        title: 'Italic (Ctrl+I)',
        className: 'italic',
        isActive: () => editor.isActive('italic'),
        run: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        label: 'U',
        title: 'Underline (Ctrl+U)',
        className: 'underline',
        isActive: () => editor.isActive('underline'),
        run: () => editor.chain().focus().toggleUnderline().run(),
      },
      {
        label: 'S',
        title: 'Strikethrough',
        className: 'line-through',
        isActive: () => editor.isActive('strike'),
        run: () => editor.chain().focus().toggleStrike().run(),
      },
      {
        label: '<>',
        title: 'Inline code',
        className: 'font-mono text-[10px]',
        isActive: () => editor.isActive('code'),
        run: () => editor.chain().focus().toggleCode().run(),
      },
    ],
    [
      {
        label: 'H1',
        title: 'Heading 1',
        isActive: () => editor.isActive('heading', { level: 1 }),
        run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        label: 'H2',
        title: 'Heading 2',
        isActive: () => editor.isActive('heading', { level: 2 }),
        run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        label: 'H3',
        title: 'Heading 3',
        isActive: () => editor.isActive('heading', { level: 3 }),
        run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      {
        label: '• List',
        title: 'Bullet list',
        isActive: () => editor.isActive('bulletList'),
        run: () => editor.chain().focus().toggleBulletList().run(),
      },
      {
        label: '1. List',
        title: 'Numbered list',
        isActive: () => editor.isActive('orderedList'),
        run: () => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        label: '❝',
        title: 'Quote',
        isActive: () => editor.isActive('blockquote'),
        run: () => editor.chain().focus().toggleBlockquote().run(),
      },
      {
        label: '—',
        title: 'Divider',
        run: () => editor.chain().focus().setHorizontalRule().run(),
      },
    ],
  ];

  const openLink = () => {
    setLinkValue(editor.getAttributes('link').href ?? '');
    setLinkError(false);
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = normaliseUrl(linkValue);
    if (!url) {
      setLinkError(true);
      return;
    }

    if (editor.state.selection.empty) {
      // Nothing selected: write the URL as its own text, then mark it.
      //
      // Two things this avoids. `setLink` on an empty cursor leaves an
      // invisible active mark, so the next thing typed silently joins the
      // link. And passing marks inline to `insertContent` drops the attrs —
      // it stores `{"type":"link"}` with no href, which only shows up after a
      // round trip through the database. `setLink` over a real range is the
      // path that actually carries attributes.
      const from = editor.state.selection.from;
      editor
        .chain()
        .focus()
        .insertContent(`${url} `)
        .setTextSelection({ from, to: from + url.length })
        .setLink({ href: url })
        // Collapse past the trailing space, outside the mark.
        .setTextSelection(from + url.length + 1)
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }

    setLinkOpen(false);
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkOpen(false);
  };

  /*
   * What the typed text matches, by name or by id.
   *
   * Capped at eight, because this list sits under a toolbar inside a pane and a
   * scrolling result set there would cover the note being written. Eight is
   * enough to recognise the one you meant; past that the answer is to type
   * another word.
   */
  const typed = insideValue.trim().toLowerCase();
  const matches = (targets ?? [])
    .filter(
      (t) =>
        typed.length > 0 &&
        (t.title.toLowerCase().includes(typed) || t.id.toLowerCase().startsWith(typed)),
    )
    .slice(0, 8);

  const openInside = () => {
    // Seeded with whatever is already there, so pressing this inside an
    // existing internal link shows its token rather than an empty box - the
    // same courtesy the URL field does.
    setInsideValue(String(editor.getAttributes('internalLink').target ?? ''));
    setInsideError(false);
    setInsideOpen(true);
  };

  /**
   * Mark the selection, or write the target's name and mark that.
   *
   * The empty-selection case is the URL field's problem again, with the same
   * two traps: a mark set on a collapsed cursor is invisible and silently
   * swallows whatever is typed next, and marks passed inline to `insertContent`
   * lose their attributes on the way through. So text is inserted, re-selected,
   * and marked over a real range.
   *
   * What gets written is the title, and only as a starting point - the mark
   * stores the id, so renaming the project later leaves this note saying the
   * old name while still pointing at the right thing. That is the right trade:
   * the words in a note are yours, and having the app rewrite them because
   * something was renamed elsewhere would be worse than a name going stale.
   */
  const applyInside = (target: InternalTarget, label?: string) => {
    if (editor.state.selection.empty) {
      const text = label ?? tokenFor(target);
      const from = editor.state.selection.from;
      editor
        .chain()
        .focus()
        .insertContent(`${text} `)
        .setTextSelection({ from, to: from + text.length })
        .setInternalLink(target)
        .setTextSelection(from + text.length + 1)
        .run();
    } else {
      editor.chain().focus().extendMarkRange('internalLink').setInternalLink(target).run();
    }

    setInsideOpen(false);
    setInsideValue('');
  };

  /** Enter, having typed or pasted something rather than picked a row. */
  const applyTyped = () => {
    // A name matching exactly one thing is what you meant; anything else has to
    // be a token, which is what "Copy id" puts on the clipboard.
    if (matches.length === 1) {
      applyInside(matches[0], matches[0].title);
      return;
    }

    // Generous here, strict everywhere else: a person is pasting, and what
    // they have to hand is a Drive link or a copied id, not a token.
    const target = readInternalInput(insideValue);
    if (!target) {
      setInsideError(true);
      return;
    }
    applyInside(target);
  };

  const removeInside = () => {
    editor.chain().focus().extendMarkRange('internalLink').unsetInternalLink().run();
    setInsideOpen(false);
  };

  return (
    <div className="sticky top-0 z-10 -mx-1 mb-2 bg-paper/95 px-1 pb-1.5 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {groups.map((group, i) => (
          <div key={i} className="flex items-center gap-0.5">
            {group.map((b) => (
              <ToolButton key={b.label} spec={b} />
            ))}
          </div>
        ))}

        {/*
          Colour, as swatches rather than a menu.
          
          Four of them, so they fit on one row beside everything else and can be
          hit without opening anything. The swatch paints itself in the token it
          sets, which is also the only honest preview: what blue *is* depends on
          the theme, so a fixed dot in the toolbar would be lying in five of the
          six.
        */}
        <div className="flex items-center gap-1">
          {NOTE_COLOURS.map((colour) => {
            const active = editor.isActive('noteColour', { colour });
            return (
              <button
                key={colour}
                type="button"
                // A button takes focus, which collapses the selection — the
                // same reason every other control here prevents it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  active
                    ? editor.chain().focus().unsetNoteColour().run()
                    : editor.chain().focus().setNoteColour(colour).run()
                }
                title={active ? `Remove ${colour}` : `Write in ${colour}`}
                aria-label={active ? `Remove ${colour}` : `Write in ${colour}`}
                aria-pressed={active}
                className={[
                  'h-4 w-4 rounded-full border transition',
                  active ? 'border-grey-800 ring-1 ring-grey-400' : 'border-grey-300',
                ].join(' ')}
                style={{ backgroundColor: colourVar(colour) }}
              />
            );
          })}
        </div>

        {/*
          Spacing, not formatting — a property of the note rather than of the
          words in it, which is why it sits apart from the marks and stays
          pressed rather than following the cursor.
        */}
        <div className="flex items-center gap-0.5">
          <ToolButton
            spec={{
              label: tight ? 'Airy' : 'Tight',
              title: tight ? 'Give the note more room' : 'Close the note up',
              isActive: () => tight,
              run: () => onTight(!tight),
            }}
          />
        </div>

        <div className="flex items-center gap-0.5">
          <ToolButton
            spec={{
              label: 'Link',
              title: 'Add or edit a link (Ctrl+K)',
              isActive: () => editor.isActive('link'),
              run: openLink,
            }}
          />
          {/*
            Beside the URL link, because they are one verb pointed at two
            different worlds - and sitting together is what makes it discoverable
            that a note can point at a project at all.
          */}
          <ToolButton
            spec={{
              label: 'Inside',
              title: 'Link to a project, an action or a Drive folder',
              isActive: () => editor.isActive('internalLink'),
              run: openInside,
            }}
          />
          <ToolButton
            spec={{
              label: 'Clear',
              title: 'Remove formatting',
              run: () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
            }}
          />
        </div>
      </div>

      {insideOpen ? (
        <div className="mt-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              ref={insideRef}
              value={insideValue}
              onChange={(e) => {
                setInsideValue(e.target.value);
                setInsideError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyTyped();
                }
                if (e.key === 'Escape') setInsideOpen(false);
              }}
              placeholder={
                targets?.length
                  ? 'Name, copied id, or a Drive link'
                  : 'A copied id, or a Drive link'
              }
              className={[
                'w-72 rounded-sm border bg-paper px-2 py-1 text-[12px] focus:outline-none',
                insideError ? 'border-stale' : 'border-grey-300 focus:border-grey-500',
              ].join(' ')}
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyTyped}
              className="rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper"
            >
              Apply
            </button>
            {editor.isActive('internalLink') ? (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={removeInside}
                className="rounded-sm border border-grey-300 px-2 py-1 text-[11px] text-grey-600"
              >
                Remove
              </button>
            ) : null}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setInsideOpen(false)}
              className="text-[11px] text-grey-500 underline underline-offset-2"
            >
              Cancel
            </button>
          </div>

          {insideError ? (
            <p className="mt-1 text-[11px] text-stale">
              Not something this can point at. A Drive folder takes its link or
              its id; a project or an action needs &ldquo;Copy id&rdquo; from its
              row menu, because an id on its own cannot say which of the two it
              is.
            </p>
          ) : null}

          {matches.length > 0 ? (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-sm border border-grey-200">
              {matches.map((t) => (
                <li key={`${t.kind}:${t.id}`}>
                  <button
                    type="button"
                    // A button takes focus and collapses the selection, which is
                    // the very thing the link is being applied to.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyInside(t, t.title)}
                    className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] hover:bg-grey-150"
                  >
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-grey-400">
                      {t.kind === 'project'
                        ? 'Project'
                        : t.kind === 'action'
                          ? 'Action'
                          : t.kind === 'boxItem'
                            ? 'Entry'
                            : 'Folder'}
                    </span>
                    <span className="truncate text-grey-800">{t.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {linkOpen ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <input
            ref={linkRef}
            value={linkValue}
            onChange={(e) => {
              setLinkValue(e.target.value);
              setLinkError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              }
              if (e.key === 'Escape') setLinkOpen(false);
            }}
            placeholder="example.com or https://…"
            className={[
              'w-72 rounded-sm border bg-paper px-2 py-1 text-[12px] focus:outline-none',
              linkError ? 'border-stale' : 'border-grey-300 focus:border-grey-500',
            ].join(' ')}
          />
          <button
            type="button"
            onClick={applyLink}
            className="rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper"
          >
            Apply
          </button>
          {editor.isActive('link') ? (
            <button
              type="button"
              onClick={removeLink}
              className="text-[11px] text-grey-500 underline underline-offset-2"
            >
              Remove
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setLinkOpen(false)}
            className="text-[11px] text-grey-500 underline underline-offset-2"
          >
            Cancel
          </button>
          {linkError ? (
            <span className="text-[11px] text-stale">
              Only http, https and mailto links are allowed.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolButton({ spec }: { spec: ButtonSpec }) {
  const active = spec.isActive?.() ?? false;

  return (
    <button
      type="button"
      title={spec.title}
      aria-label={spec.title}
      aria-pressed={active}
      // Keep focus in the document so the command applies to the selection.
      onMouseDown={(e) => e.preventDefault()}
      onClick={spec.run}
      className={[
        'min-w-[1.6rem] rounded-sm px-1.5 py-0.5 text-[11px] leading-5',
        spec.className ?? '',
        active
          ? 'bg-grey-700 text-paper'
          : 'text-grey-600 hover:bg-grey-200 hover:text-grey-900',
      ].join(' ')}
    >
      {spec.label}
    </button>
  );
}
