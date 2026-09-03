/**
 * A link from a note to something inside the app.
 *
 * The boxes are a journal, and the thing a journal entry most often wants to
 * point at is not a web page — it is the project this was about, or the step it
 * became. Written as a URL that would be one more address to keep working; as a
 * token it is the same promise the rest of this app makes about names: the
 * *id* is stored and everything readable is resolved from it.
 *
 * `P<uuid>` a project, `A<uuid>` an action, `D<id>` a Drive folder. One letter
 * because the three cannot be told apart from a uuid alone, and a note is
 * hand-edited often enough that a JSON shape would be a worse thing to type.
 */
export type InternalKind = 'project' | 'action' | 'drive';

export type InternalTarget = { kind: InternalKind; id: string };

const PREFIX: Record<string, InternalKind> = {
  P: 'project',
  A: 'action',
  D: 'drive',
};

const LETTER: Record<InternalKind, string> = {
  project: 'P',
  action: 'A',
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
    case 'drive':
      return `https://drive.google.com/drive/folders/${target.id}`;
  }
}

/** True where following the link leaves the app entirely. */
export function leavesApp(target: InternalTarget): boolean {
  return target.kind === 'drive';
}

/**
 * The same target, opened in the pane of a page you are already on.
 *
 * `base` is the current URL with its filters intact, because clicking a link
 * inside a note must not throw away the tags and dates that found the entry.
 * A Drive folder is never rewritten this way — there is nothing of it to show.
 */
export function openHref(base: string, target: InternalTarget): string {
  if (leavesApp(target)) return hrefFor(target);

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
