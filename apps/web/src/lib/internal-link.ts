/**
 * A link from a note to something inside the app.
 *
 * The boxes are a journal, and the thing a journal entry most often wants to
 * point at is not a web page — it is the project this was about, or the step it
 * became. Written as a URL that would be one more address to keep working; as a
 * token it is the same promise the rest of this app makes about names: the
 * *id* is stored and everything readable is resolved from it.
 *
 * `P<uuid>` a project, `A<uuid>` an action, `B<uuid>` an entry in a box, `D<id>`
 * a Drive folder. One letter because none of them can be told apart from a uuid
 * alone, and a note is hand-edited often enough that a JSON shape would be a
 * worse thing to type.
 *
 * **A box entry is the one that points sideways.** The others go from a box out
 * to the work; `B` goes from one box to another — a note in the Feed saying
 * "this is the quote I mentioned" about a scan filed in Work. Boxes are kept
 * rather than emptied, so the thing a journal line refers to is very often
 * another thing in a box, and before this the only way to say so was to
 * describe it and hope.
 */
export type InternalKind = 'project' | 'action' | 'boxItem' | 'drive';

export type InternalTarget = { kind: InternalKind; id: string };

const PREFIX: Record<string, InternalKind> = {
  P: 'project',
  A: 'action',
  B: 'boxItem',
  D: 'drive',
};

const LETTER: Record<InternalKind, string> = {
  project: 'P',
  action: 'A',
  boxItem: 'B',
  drive: 'D',
};

/** A uuid, or a Drive id — which is base64-ish and has no fixed length. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,80}$/;

export function tokenFor(target: InternalTarget): string {
  return `${LETTER[target.kind]}${target.id}`;
}

/**
 * Read a token, or refuse it.
 *
 * Refusing is the important half: this parses something a person typed or
 * pasted, and a token that is *nearly* right must not become a link that goes
 * somewhere unexpected. A project id in an `A` token would open the action pane
 * on an id no action has, which looks like a bug in the app rather than a
 * mistyped letter.
 */
export function readToken(raw: string): InternalTarget | null {
  const text = raw.trim();
  const kind = PREFIX[text.slice(0, 1).toUpperCase()];
  if (!kind) return null;

  const id = text.slice(1).trim();

  /*
   * A uuid is never a Drive folder, and this is the one place that has to be
   * said out loud.
   *
   * A Drive id has no fixed shape, so its pattern has to be loose - and it
   * accepts hyphens, which means it accepts a uuid. Without this a project id
   * mistyped with a `D` became a perfectly valid Drive link to a folder that
   * has never existed, opening a Google error page rather than saying anything
   * useful. Measured by the check script rather than reasoned about.
   */
  if (kind === 'drive') {
    return DRIVE_ID.test(id) && !UUID.test(id) ? { kind, id } : null;
  }
  return UUID.test(id) ? { kind, id } : null;
}

/**
 * Where a target opens when there is no pane to open it *in*.
 *
 * A box builds its own address — `?open=<token>` on the box itself, so pane
 * three fills without leaving the feed, which is the whole point of linking
 * from a journal. This is the fallback for everywhere else, and for a Drive
 * folder it is the only answer there is: the app holds `drive.file` and cannot
 * see inside a folder it did not create, so the honest place to send you is
 * Drive.
 */
export function hrefFor(target: InternalTarget): string {
  switch (target.kind) {
    case 'project':
      return `/projects/${target.id}`;
    case 'action':
      // The Now list addresses a selected action by search param, which is what
      // makes this land in pane three rather than on a page of its own.
      return `/now?action=${target.id}`;
    case 'boxItem':
      /*
       * Which box it is in is not stored, and must not be: an entry can be
       * *moved* between boxes, and a token carrying the box would be a copy of
       * a fact that changes — the same mistake as storing a project's name.
       * `/box/find/<id>` looks the box up and redirects, so the link survives
       * every move and every box rename.
       */
      return `/box/find/${target.id}`;
    case 'drive':
      return `https://drive.google.com/drive/folders/${target.id}`;
  }
}

/**
 * What somebody typed or pasted into the link field, read generously.
 *
 * Deliberately *not* `readToken`, and the split is the point: a token is data —
 * it is what the mark stores and what `?open=` carries, and being strict there
 * is what stops a near-miss becoming a link to somewhere unexpected. This is
 * the other end, where a person is pasting something, and being strict there is
 * just being unhelpful.
 *
 * Three shapes, because three are what you actually have to hand:
 *
 * - a token, from "Copy id" — the only one that can name a project or an
 *   action, because a bare uuid cannot say which of the two tables it is from;
 * - a **Drive URL**, which is what the address bar and Drive's own "Copy link"
 *   give you, and which nobody should have to edit down by hand;
 * - a **bare Drive id**, which is what is left after you have edited it down
 *   anyway. Unambiguous precisely because it is *not* a uuid — that is the one
 *   distinction `readToken` already has to make for the `D` prefix, used here
 *   to save the prefix entirely.
 *
 * A bare uuid stays refused. It is genuinely ambiguous, and guessing would put
 * a pane on an id the other table has never heard of.
 */
export function readInternalInput(raw: string): InternalTarget | null {
  const text = raw.trim();
  if (!text) return null;

  const token = readToken(text);
  if (token) return token;

  /*
   * Every Drive address that carries an id, which is more than one shape:
   * `/drive/folders/<id>`, `/drive/u/0/folders/<id>`, `/file/d/<id>/view`, and
   * the older `?id=<id>`. Matched on the *path segment* rather than by pulling
   * the longest word out of the URL, so a query string cannot be mistaken for
   * an id.
   */
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      if (!/(^|\.)google\.com$/i.test(url.hostname)) return null;

      const fromPath = url.pathname.match(
        /\/(?:folders|d)\/([A-Za-z0-9_-]{10,80})/,
      );
      const id = fromPath?.[1] ?? url.searchParams.get('id');

      if (id && DRIVE_ID.test(id) && !UUID.test(id)) return { kind: 'drive', id };
    } catch {
      // Not a URL after all; fall through to the bare-id case.
    }
    return null;
  }

  if (DRIVE_ID.test(text) && !UUID.test(text)) return { kind: 'drive', id: text };

  return null;
}

/**
 * The same target, opened in the pane of a page you are already on.
 *
 * `base` is the current URL with its filters intact, because clicking a link
 * inside a note must not throw away the tags and dates that found the entry.
 *
 * **A Drive folder goes here too, now that there is something to show.** It
 * did not at first — the app holds `drive.file` and cannot list a folder it did
 * not create, so the only honest destination was Drive itself. An Apps Script
 * walks the linked folders and posts back a tree, so the pane can now answer
 * "what is in there" the way it does for a project. What it still cannot do is
 * *open* any of it, which is why every row in a tree is a real link out.
 */
export function openHref(base: string, target: InternalTarget): string {
  const [path, query = ''] = base.split('?');
  const params = new URLSearchParams(query);
  params.set('open', tokenFor(target));
  return `${path}?${params}`;
}

/**
 * Every internal token a document mentions.
 *
 * Lives here rather than beside the renderer because it is not rendering: a
 * page calls it to find out what to look up *before* anything is drawn, and a
 * list of two hundred rows must not ask two hundred questions. Anything the
 * parser refuses is dropped here rather than passed on as a target that could
 * never resolve.
 */
export function tokensIn(doc: unknown): InternalTarget[] {
  type Node = {
    content?: Node[];
    marks?: { type?: string; attrs?: Record<string, unknown> }[];
  };

  const found: InternalTarget[] = [];

  const walk = (node: Node) => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== 'internalLink') continue;
      const target = readToken(String(mark.attrs?.target ?? ''));
      if (target) found.push(target);
    }
    for (const child of node.content ?? []) walk(child);
  };

  if (doc && typeof doc === 'object') walk(doc as Node);
  return found;
}
