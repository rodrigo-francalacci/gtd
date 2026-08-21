/**
 * The kinds of row whose opens are counted.
 *
 * Files, and only files. Opening a project or an action is navigation — you
 * pass through those on the way to something — where opening a file is a
 * deliberate act with an obvious meaning: this is the one I wanted. Counting
 * the first kind would mostly record how the app is laid out.
 *
 * Split out of `usage.ts` because that file is `server-only` — it holds the
 * table map and the writes — and the client needs the vocabulary to say what
 * it just opened. Same arrangement as `queries.shared.ts`.
 */
export const USABLE = ['attachment', 'box_item'] as const;

export type UsableType = (typeof USABLE)[number];

export function isUsableType(value: unknown): value is UsableType {
  return typeof value === 'string' && (USABLE as readonly string[]).includes(value);
}
