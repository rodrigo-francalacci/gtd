'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DRAG_TAG } from './sortable';
import { useRef } from 'react';

/**
 * A filter you can turn on, or turn against.
 *
 * Three states, from two gestures. Click includes, as it always did.
 * Right-click — press and hold on a touchscreen — excludes: show me everything
 * *except* this. That second question is the one a box asks constantly and had
 * no way to express: "the fuel receipts that aren't Shell" needed selecting
 * every other vendor by hand, which is not the same thing and stops being
 * possible the moment a new vendor appears.
 *
 * A hidden gesture on a visible control, which is worth being uneasy about —
 * so the state it produces is unmistakable once reached (struck through, in
 * the warning colour) and the title says how to get there. The alternative, a
 * third chip or a mode switch per tag, would double the width of a bar whose
 * whole job is to be scannable.
 *
 * Both gestures are links underneath, because a filtered view is a URL worth
 * keeping. The right-click one has to be driven by the router rather than an
 * `<a>`, since a browser has its own plans for that button.
 */
export function FilterChip({
  label,
  count,
  state,
  includeHref,
  excludeHref,
  dragId,
}: {
  label: string;
  count?: number;
  state: 'off' | 'include' | 'exclude';
  includeHref: string;
  excludeHref: string;
  /**
   * The tag this chip stands for, when it can be dragged onto an entry to
   * apply it. Absent where a chip only filters.
   *
   * Desktop only, and that is a property of the platform rather than a
   * decision: HTML5 drag and drop has no touch support at all, which is why
   * every other drag in this app is a desktop gesture too. Tapping a tag in
   * the detail pane is the touch answer and already exists.
   */
  dragId?: string;
}) {
  const router = useRouter();
  const held = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Set by a long press only, because a long press is the one gesture the
   * browser turns into a click afterwards — and that click would undo the
   * exclusion the hold just made.
   *
   * Deliberately *not* set by the context menu, which produces no click. It
   * was, and the flag then had nothing to clear it: navigation here is
   * client-side, so the component is reused rather than remounted, and the
   * next ordinary click on any chip was swallowed by a guard left standing
   * from a right-click several filters ago.
   */
  const consumed = useRef(false);

  const exclude = () => {
    router.push(excludeHref);
  };

  const cancel = () => {
    if (held.current) clearTimeout(held.current);
    held.current = null;
  };

  return (
    <Link
      href={includeHref}
      draggable={dragId ? true : undefined}
      onDragStart={
        dragId
          ? (e) => {
              /*
               * An anchor is already draggable and already carries its href, so
               * without this a tag dropped anywhere would arrive as a URL. The
               * private type is what a row reads during `dragover` to decide
               * whether to light up — `dataTransfer.types` is the only thing
               * readable then.
               */
              e.dataTransfer.setData(DRAG_TAG, dragId);
              e.dataTransfer.setData('text/plain', label);
              e.dataTransfer.effectAllowed = 'copy';
            }
          : undefined
      }
      onContextMenu={(e) => {
        e.preventDefault();
        exclude();
      }}
      /*
       * Touch only. A mouse already has the context menu, and starting a
       * 500ms timer on every mouse press would make a slow click — which is
       * most clicks — exclude instead of include.
       */
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return;
        consumed.current = false;
        held.current = setTimeout(() => {
          // Set here, where a click really is coming.
          consumed.current = true;
          exclude();
        }, 500);
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      // A finger that has drifted was scrolling, not holding.
      onPointerMove={cancel}
      onClick={(e) => {
        if (!consumed.current) return;
        e.preventDefault();
        consumed.current = false;
      }}
      title={
        state === 'exclude'
          ? `Showing everything except ${label} — click to clear`
          : state === 'include'
            ? `Only ${label} — click to clear, right-click or hold to exclude instead`
            : `Only ${label}. Right-click, or hold on a touchscreen, to exclude it`
      }
      className={[
        'flex select-none items-baseline gap-1 rounded-sm px-1.5 py-px text-[11px]',
        state === 'include'
          ? 'bg-selected-bg font-medium text-selected'
          : state === 'exclude'
            ? 'bg-stale-bg font-medium text-stale line-through'
            : 'bg-grey-200 text-grey-600 hover:bg-grey-300',
      ].join(' ')}
    >
      {state === 'exclude' ? <span aria-hidden>−</span> : null}
      {label}
      {count === undefined ? null : (
        <span className="tabular-nums opacity-60">{count}</span>
      )}
    </Link>
  );
}

/**
 * The URL for putting a filter into a given state.
 *
 * Built from the current parameters rather than from scratch, so the filters
 * that aren't being touched — the dates, the other facet — survive. Include
 * and exclude are mutually exclusive by construction: setting one always
 * removes the value from the other.
 */
export function filterHref(
  basePath: string,
  params: URLSearchParams,
  key: string,
  notKey: string,
  value: string,
  next: 'off' | 'include' | 'exclude',
): string {
  const on = params.getAll(key).filter((v) => v !== value);
  const off = params.getAll(notKey).filter((v) => v !== value);

  if (next === 'include') on.push(value);
  if (next === 'exclude') off.push(value);

  const out = new URLSearchParams(params);
  out.delete(key);
  out.delete(notKey);
  on.forEach((v) => out.append(key, v));
  off.forEach((v) => out.append(notKey, v));
  // Changing what is listed makes the previously selected row meaningless.
  out.delete('doc');

  const query = out.toString();
  return query ? `${basePath}?${query}` : basePath;
}
