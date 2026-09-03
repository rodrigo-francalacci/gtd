import { tokenFor, type InternalKind } from './internal-link';

/**
 * "Copy id", for a row menu.
 *
 * The token rather than the bare uuid, because the token is what the note
 * editor accepts and a uuid on its own cannot say whether it names a project or
 * an action — the two tables both use them, and a project id pasted into an
 * `A` link would open a pane on an id no action has. One press, one thing on
 * the clipboard, and it is the thing the other end asks for.
 *
 * `writeText` needs a secure context, which localhost and https both are; the
 * fallback is the old selection trick rather than a failure, since a menu item
 * that silently does nothing is worse than a deprecated API.
 */
export function copyIdItem(kind: InternalKind, id: string) {
  return {
    label: 'Copy id',
    run: async () => {
      const token = tokenFor({ kind, id });

      try {
        await navigator.clipboard.writeText(token);
        return;
      } catch {
        // Fall through.
      }

      const field = document.createElement('textarea');
      field.value = token;
      // Off screen rather than hidden: `display: none` cannot be selected.
      field.style.position = 'fixed';
      field.style.left = '-9999px';
      document.body.append(field);
      field.select();
      try {
        document.execCommand('copy');
      } finally {
        field.remove();
      }
    },
  };
}
