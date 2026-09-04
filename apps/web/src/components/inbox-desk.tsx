'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { dropCapture, type CaptureDrop } from '@/lib/actions';
import { DRAG_CAPTURE } from './drag-capture';
import { FullScreen } from './full-screen';
import { IconBox, IconLists, IconNow, IconProject, IconSomeday } from './icons';

/**
 * The inbox with everywhere it could go, side by side.
 *
 * Processing an inbox is a sequence of small obvious decisions, and the cost of
 * each is not the thinking — you know where a line goes the moment you read it
 * — it is the *reaching*. In the panes you either open the clarify form and
 * fill it in, or you drag to the sidebar, which can only name pages: "make this
 * a project", never "a step of *that* project".
 *
 * Here the destinations are real rows, so a capture can be dropped on the
 * project it belongs to, on the step it is evidence for, or into a box, in one
 * movement with both ends on screen. That is the same argument the boards make
 * about the impact lanes, applied to the one list whose whole purpose is to be
 * emptied.
 *
 * **Ctrl means "this is evidence", not "this is work".** Every other drop
 * *clarifies* — the capture becomes an action, a project, a list item, a
 * document. Holding Ctrl attaches its file to the thing you dropped it on and
 * creates nothing, which is the `attached` decision reached by pointing rather
 * than by form. The modifier is read during `dragover` so the cursor says which
 * it will be *before* you let go, exactly as copying a box entry does.
 *
 * **Desktop, like every drag here.** HTML5 drag-and-drop has no touch support
 * anywhere in this app; the phone processes an inbox through the panel.
 */

type Row = { id: string; title: string; note: string | null; when: string };

type ProjectNode = {
  id: string;
  title: string;
  status: string;
  actions: { id: string; title: string }[];
};

/**
 * One drop target, wherever it sits in the tree.
 *
 * Defined at module scope, not inside `InboxDesk`, and that is not tidiness: a
 * component declared inside a render is a *new type* on every render, so React
 * unmounts and remounts its whole subtree — which during a drag means the
 * element under the cursor is destroyed the moment the highlight changes, and
 * the drop never lands. Everything it needs is a prop for that reason.
 *
 * `attach` says whether Ctrl means anything here. A box is a place you *file* a
 * document, which is already what a plain drop does, so a modifier could add
 * nothing; a list item is a candidate rather than somewhere evidence is kept.
 * Projects and actions are the two things a file can hang off, which is exactly
 * what `AttachTarget` says.
 */
function DeskTarget({
  id,
  label,
  icon,
  depth = 0,
  drop,
  attach,
  children,
  expandable,
  openIds,
  onToggle,
  dropping,
  setDropping,
  onFile,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  depth?: number;
  drop: CaptureDrop;
  attach?: { parentType: 'project' | 'action'; parentId: string };
  children?: ReactNode;
  expandable?: boolean;
  openIds: Set<string>;
  onToggle: (id: string) => void;
  dropping: string | null;
  setDropping: (next: string | null) => void;
  onFile: (itemId: string, target: CaptureDrop) => void;
}) {
  const isOpen = openIds.has(id);

  return (
    <li>
      <div
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(DRAG_CAPTURE)) return;
          event.preventDefault();

          const attaching = Boolean(attach) && (event.ctrlKey || event.metaKey);
          // Setting `dropEffect` is what changes the cursor, so which of the two
          // it will be is visible before you let go rather than after.
          event.dataTransfer.dropEffect = attaching ? 'copy' : 'move';
          setDropping(attaching ? `${id}:attach` : id);
        }}
        onDragLeave={(event) => {
          // `relatedTarget` rather than `currentTarget === target`: leave bubbles
          // out of every child, so the strict test only sees a departure that
          // happens to cross this element's own edge.
          const to = event.relatedTarget as Node | null;
          if (event.currentTarget.contains(to)) return;
          setDropping(null);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes(DRAG_CAPTURE)) return;
          event.preventDefault();
          event.stopPropagation();

          // Read before the transition starts: a pooled event's modifier keys
          // are unreadable once the handler has returned.
          const attaching = Boolean(attach) && (event.ctrlKey || event.metaKey);
          const itemId = event.dataTransfer.getData(DRAG_CAPTURE);

          setDropping(null);
          if (!itemId) return;

          onFile(
            itemId,
            attaching && attach
              ? { kind: 'attached', parentType: attach.parentType, parentId: attach.parentId }
              : drop,
          );
        }}
        style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
        className={[
          'flex items-center gap-1.5 rounded-sm py-1 pr-2 text-[12px]',
          dropping === id
            ? 'bg-selected-bg ring-1 ring-inset ring-selected'
            : dropping === `${id}:attach`
              ? 'bg-journal-bg ring-1 ring-inset ring-journal'
              : 'hover:bg-grey-100',
        ].join(' ')}
      >
        {expandable ? (
          <button
            type="button"
            onClick={() => onToggle(id)}
            aria-expanded={isOpen}
            aria-label={isOpen ? `Collapse ${label}` : `Expand ${label}`}
            className="w-3 shrink-0 text-[10px] text-grey-400 hover:text-grey-800"
          >
            {isOpen ? '\u25be' : '\u25b8'}
          </button>
        ) : (
          <span className="w-3 shrink-0" aria-hidden />
        )}

        <span className="shrink-0 text-grey-400">{icon}</span>
        <span className="truncate text-grey-800">{label}</span>
      </div>

      {expandable && isOpen ? <ul>{children}</ul> : null}
    </li>
  );
}

export function InboxDesk({
  rows,
  projects,
  lists,
  boxes,
  closeHref,
}: {
  rows: Row[];
  projects: ProjectNode[];
  lists: { id: string; name: string }[];
  boxes: { id: string; name: string }[];
  closeHref: string;
}) {
  const [pending, startTransition] = useTransition();

  /*
   * Which branches are open, and it starts *closed* apart from the boxes.
   *
   * A tree that arrives fully expanded is a wall — and the branch you want is
   * usually the one you were already thinking about, so opening it yourself
   * costs one click and reading past forty rows you did not want costs more.
   */
  const [open, setOpen] = useState<Set<string>>(new Set(['boxes']));

  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const [dropping, setDropping] = useState<string | null>(null);

  const file = (itemId: string, target: CaptureDrop) => {
    startTransition(async () => {
      await dropCapture(itemId, target);
    });
  };

  /*
   * The shared half of every target, spread at each call site.
   *
   * A plain object rather than a wrapper component, for the same reason
   * `DeskTarget` is at module scope: a component declared inside a render is a
   * new type on every render, and React would unmount the tree under the cursor
   * mid-drag.
   */
  const common = {
    openIds: open,
    onToggle: toggle,
    dropping,
    setDropping,
    onFile: file,
  };

  return (
    <FullScreen
      title="Inbox"
      subtitle={
        rows.length === 0
          ? 'Empty. Nothing to decide.'
          : `${rows.length} to clarify · drag one across · hold Ctrl to attach it as evidence instead`
      }
      closeHref={closeHref}
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:overflow-hidden">
        {/* The queue. Oldest first, which is how an inbox is processed. */}
        <section
          data-surface="list"
          className={[
            'min-h-0 overflow-y-auto overflow-x-clip rounded-sm border border-grey-200',
            pending ? 'opacity-60' : '',
          ].join(' ')}
        >
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-[12px] text-grey-400">
              Nothing here. That is the point of an inbox.
            </p>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG_CAPTURE, row.id);
                  event.dataTransfer.effectAllowed = 'copyMove';
                }}
                className="cursor-grab select-none border-b border-grey-150 px-4 py-2.5 last:border-b-0 hover:bg-grey-100"
              >
                <p className="truncate text-[13px] text-grey-800">{row.title}</p>
                {row.note ? (
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-grey-500">
                    {row.note}
                  </p>
                ) : null}
                <p className="mt-1 text-[10px] tabular-nums text-grey-400">{row.when}</p>
              </div>
            ))
          )}
        </section>

        {/* Everywhere it could go. */}
        <aside
          data-surface="detail"
          className="min-h-0 overflow-y-auto overflow-x-clip rounded-sm border border-grey-200 py-2"
        >
          <ul>
            <DeskTarget
              {...common}
              id="now"
              label="What can I do now"
              icon={<IconNow />}
              drop={{ kind: 'now' }}
            />
            <DeskTarget
              {...common}
              id="waiting"
              label="Waiting for"
              icon={<IconSomeday />}
              drop={{ kind: 'waiting' }}
            />
            <DeskTarget
              {...common}
              id="new-project"
              label="A project of its own"
              icon={<IconProject />}
              drop={{ kind: 'project' }}
            />

            <li className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-wider text-grey-400">
              Projects
            </li>
            {projects.map((project) => (
              <DeskTarget
                {...common}
                key={project.id}
                id={`p:${project.id}`}
                label={project.title}
                icon={<IconProject />}
                expandable={project.actions.length > 0}
                drop={{ kind: 'in_project', projectId: project.id }}
                attach={{ parentType: 'project', parentId: project.id }}
              >
                {project.actions.map((action) => (
                  <DeskTarget
                    {...common}
                    key={action.id}
                    id={`a:${action.id}`}
                    label={action.title}
                    icon={<IconNow />}
                    depth={1}
                    /*
                     * An action is not somewhere a capture *becomes* something,
                     * so the plain drop files it as a step of the same project.
                     * Ctrl is the interesting one here: this step is what the
                     * photograph is evidence for.
                     */
                    drop={{ kind: 'in_project', projectId: project.id }}
                    attach={{ parentType: 'action', parentId: action.id }}
                  />
                ))}
              </DeskTarget>
            ))}

            <li className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-wider text-grey-400">
              Lists
            </li>
            {lists.map((list) => (
              <DeskTarget
                {...common}
                key={list.id}
                id={`l:${list.id}`}
                label={list.name}
                icon={<IconLists />}
                drop={{ kind: 'list', listId: list.id }}
              />
            ))}

            <li className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-wider text-grey-400">
              Boxes
            </li>
            {boxes.map((box) => (
              <DeskTarget
                {...common}
                key={box.id}
                id={`b:${box.id}`}
                label={box.name}
                icon={<IconBox />}
                drop={{ kind: 'box', boxId: box.id }}
              />
            ))}
          </ul>
        </aside>
      </div>
    </FullScreen>
  );
}
