'use client';

import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';

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

export function EditorToolbar({ editor }: { editor: Editor | null }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (linkOpen) linkRef.current?.focus();
  }, [linkOpen]);

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

        <div className="flex items-center gap-0.5">
          <ToolButton
            spec={{
              label: 'Link',
              title: 'Add or edit a link (Ctrl+K)',
              isActive: () => editor.isActive('link'),
              run: openLink,
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
