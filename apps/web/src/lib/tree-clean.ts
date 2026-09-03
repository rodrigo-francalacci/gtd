import type { TreeNode } from '@gtd/db';

/**
 * Whatever a script sent, reduced to the shape this app will store.
 *
 * The script is trusted with the *account*, not with the JSON: it is a program
 * that can be edited by hand, and a tree is rendered straight into a pane. So
 * every field is taken by name and by type, unknown keys are dropped, and the
 * whole thing is bounded — depth, breadth and total nodes — because a cycle or
 * a runaway folder would otherwise become a row that no page can render.
 *
 * Shared by the project trees and the linked-folder trees rather than written
 * twice. Two copies of a sanitiser is the worst kind of duplication: they drift
 * silently, and the half that drifts is the half nobody is looking at.
 */

/** A walk is capped, and the caps are here so a script cannot argue. */
export const MAX_NODES = 4000;
const MAX_DEPTH = 12;

export function cleanTree(
  raw: unknown,
  budget: { left: number },
  depth = 0,
): TreeNode | null {
  if (!raw || typeof raw !== 'object' || budget.left <= 0) return null;

  const node = raw as Record<string, unknown>;
  const kind = node.kind;

  if (kind !== 'folder' && kind !== 'file' && kind !== 'label' && kind !== 'message') {
    return null;
  }

  budget.left -= 1;

  const text = (value: unknown, limit = 300): string | null =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;

  const out: TreeNode = {
    id: text(node.id, 200) ?? '',
    name: text(node.name) ?? '(untitled)',
    kind,
    mimeType: text(node.mimeType, 120),
    size: typeof node.size === 'number' && node.size >= 0 ? node.size : null,
    modified: text(node.modified, 40),
    from: text(node.from, 200),
    // Only somewhere on Google. A tree is rendered as links, and a `javascript:`
    // url in one would be a script that runs when clicked.
    url: /^https:\/\/[a-z]+\.google\.com\//i.test(String(node.url ?? ''))
      ? String(node.url)
      : null,
  };

  if (typeof node.more === 'number' && node.more > 0) out.more = Math.floor(node.more);

  if (Array.isArray(node.children) && depth < MAX_DEPTH) {
    const children = node.children
      .map((child) => cleanTree(child, budget, depth + 1))
      .filter((child): child is TreeNode => child !== null);

    if (children.length > 0) out.children = children;
  }

  return out;
}
