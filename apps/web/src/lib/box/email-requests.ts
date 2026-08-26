import 'server-only';

import { boxItemLinks, boxes, db, emailRequests } from '@gtd/db';
import type { AttachmentParentType } from '@gtd/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

/**
 * Asking the bridge for a message you have not labelled.
 *
 * Labelling in Gmail is the main way in and needs none of this — it is two taps
 * in the app you are already reading the message in. This is the other case: you
 * are at a desk, the message is in front of you, and reaching for the label menu
 * is more friction than pasting the thing you are already looking at.
 *
 * The app cannot fetch it. It holds `gmail.labels` and nothing more, and
 * widening that to read a body means a restricted scope, which means either an
 * annual security assessment or a refresh token Google expires every seven days
 * — and that token is the one Drive sync and the calendar run on. So the app
 * writes down *that you asked*, and the Apps Script — which is yours, bound to
 * your account, reading your own mail, and needs no verification at all — picks
 * the request up on its next run.
 *
 * **A row rather than a file in Drive.** Handing the script a JSON or CSV file
 * would work and costs more than it looks: a format to agree on, a race between
 * the thing writing it and the thing reading it, and no way for the app to show
 * you what is outstanding or why one failed. The script already calls an
 * authenticated endpoint on every run. It can ask.
 */

export type EmailRequestRow = {
  id: string;
  query: string;
  status: 'pending' | 'done' | 'failed';
  note: string | null;
  filed: number;
  createdAt: Date;
};

/**
 * Why a Gmail permalink cannot be used, and the three things that can.
 *
 * Worth being this long. It is the one dead end in the feature, the reason is
 * genuinely not the user’s fault, and every alternative is two clicks away —
 * so the message that names them is doing more good than a shorter one that
 * only says no.
 */
const PERMALINK_REFUSAL =
  'That id is one only Gmail’s own interface understands — no API accepts it, and there is no way to convert it. Three things that do work: open the message, choose "Show original", and paste the Message-ID from the top of that page (it looks like <abc@mail.gmail.com>); or paste a search such as subject:"the exact subject" or from:sam worktop; or label the message GTD/Relevant in Gmail and the bridge will collect it on its next run.';

/**
 * What you pasted, and whether it is worth sending at all.
 *
 * An id, an RFC822 `Message-ID` and a search are all things Gmail can
 * resolve, and deciding which is which happens in the script, where Gmail
 * can actually be asked. The one shape refused here is the permalink, which
 * nothing can resolve — and refusing it at the moment you paste it is far
 * better than a request that sits pending until a script fails on it an hour
 * later, or worse, searches for it literally and finds nothing.
 */
export function readEmailQuery(raw: string): { query: string } | { refuse: string } {
  /*
   * The `email:` prefix is stripped here as well as in `readEmailPaste`.
   *
   * That prefix exists so a composer can tell a search from a note; a field
   * labelled "find an email" needs no such thing, but people type it anyway
   * because it is what they were told to type elsewhere. Left on, it reaches
   * Gmail as part of the search and matches nothing — a request that fails for
   * a reason nobody could see. Two entry points, one normalisation.
   */
  const text = raw.trim().replace(/^e?mail:\s*/i, '').trim();
  if (!text) return { refuse: 'Nothing to look up.' };

  const gmail = /^https?:\/\/mail\.google\.com\/.*#[^/]+\/([^/?&#]+)/i.exec(text);
  const token = gmail ? gmail[1] : text;

  // A legacy hex id is usable as it stands, in a URL or on its own.
  if (/^[0-9a-f]{16,}$/i.test(token)) return { query: token };

  /*
   * The permalink id, refused whether it arrives in a URL or on its own.
   *
   * It only checked the URL form at first, on the assumption that nobody would
   * take the id out by hand. Somebody did, immediately — the advice for the
   * *other* id shape is "copy the id out of the URL", so of course they did —
   * and a bare `FMfcgz…` fell through as a plain search, which Gmail then ran
   * literally and matched nothing. A silent nothing is the worst answer of the
   * three available here.
   *
   * The shape is unmistakable: Gmail mints these as long mixed-case tokens
   * beginning `FMfcg` or `QgrcJ`, and no Gmail search term looks like that.
   */
  if (gmail || /^(FMfcg|QgrcJ)[A-Za-z0-9_-]{12,}$/.test(token)) {
    return { refuse: PERMALINK_REFUSAL };
  }

  return { query: text };
}

/**
 * Where a fetched message should be cited, when it was asked for from a pane
 * rather than from a box.
 */
export type RequestParent = {
  parentType: AttachmentParentType;
  parentId: string;
};

/** Write down that a message was asked for. */
export async function createEmailRequest(
  boxId: string,
  query: string,
  parent?: RequestParent,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(emailRequests)
    .values({
      boxId,
      query,
      parentType: parent?.parentType ?? null,
      parentId: parent?.parentId ?? null,
    })
    .returning({ id: emailRequests.id });

  return row;
}

/**
 * What is outstanding for a box, and what went wrong with anything that did.
 *
 * Failures are included on purpose and stay until dismissed. A request that
 * quietly disappeared would be indistinguishable from one that worked, and the
 * usual failure — an id Gmail does not recognise, a search that matched nothing
 * — is something you can act on the moment you see it.
 */
export async function getEmailRequests(boxId: string): Promise<EmailRequestRow[]> {
  return db
    .select({
      id: emailRequests.id,
      query: emailRequests.query,
      status: emailRequests.status,
      note: emailRequests.note,
      filed: emailRequests.filed,
      createdAt: emailRequests.createdAt,
    })
    .from(emailRequests)
    .where(
      and(
        eq(emailRequests.boxId, boxId),
        inArray(emailRequests.status, ['pending', 'failed']),
      ),
    )
    .orderBy(desc(emailRequests.createdAt));
}

/** Drop a request. Used to clear a failure you have read. */
export async function forgetEmailRequest(id: string): Promise<void> {
  await db.delete(emailRequests).where(eq(emailRequests.id, id));
}

/**
 * The script asks for work.
 *
 * `attempts` goes up as they are handed out, which is the only thing standing
 * between a request the script can never satisfy and a run that spends its whole
 * six minutes on it. Past a few tries it is marked failed with a sentence saying
 * so, rather than being retried until someone notices.
 */
export async function claimEmailRequests(limit = 10) {
  const rows = await db
    .select({
      id: emailRequests.id,
      query: emailRequests.query,
      attempts: emailRequests.attempts,
      box: boxes.name,
    })
    .from(emailRequests)
    .innerJoin(boxes, eq(boxes.id, emailRequests.boxId))
    .where(eq(emailRequests.status, 'pending'))
    .orderBy(asc(emailRequests.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  await db
    .update(emailRequests)
    .set({ attempts: sql`${emailRequests.attempts} + 1` })
    .where(
      inArray(
        emailRequests.id,
        rows.map((r) => r.id),
      ),
    );

  return rows.map(({ id, query, box }) => ({ id, query, box }));
}

/** Three, because a request that has failed three times will fail again. */
const MAX_ATTEMPTS = 3;

/**
 * The script reports what happened.
 *
 * It sends the ids of the entries it filed rather than only a count, which
 * is what lets the linking happen *here*. The script has no business
 * knowing about `box_item_links` — it knows about Gmail and Drive — and the
 * app is where "this message is evidence for that project" already means
 * something.
 */
export async function resolveEmailRequest(
  id: string,
  itemIds: string[],
  note: string | null,
): Promise<void> {
  const [row] = await db
    .select({
      attempts: emailRequests.attempts,
      parentType: emailRequests.parentType,
      parentId: emailRequests.parentId,
    })
    .from(emailRequests)
    .where(eq(emailRequests.id, id))
    .limit(1);

  if (!row) return;

  const filed = itemIds.length;

  /*
   * Cited on the thing you asked from, if you asked from one. Written before
   * the request is marked done: a link missing from a request that says it
   * succeeded is a message you would go looking for on a project and not
   * find, whereas a request still pending with the links already in place
   * simply resolves on the next run and writes them again — which
   * `onConflictDoNothing` makes free.
   */
  if (filed > 0 && row.parentType && row.parentId) {
    await db
      .insert(boxItemLinks)
      .values(
        itemIds.map((itemId) => ({
          itemId,
          parentType: row.parentType!,
          parentId: row.parentId!,
        })),
      )
      .onConflictDoNothing();
  }

  /*
   * Filed anything at all and it is done. Nothing, and it goes back in the
   * queue until the attempts run out — a run can end early on time, and a
   * request that was simply not reached should not be marked failed for it.
   */
  const done = filed > 0;
  const exhausted = row.attempts >= MAX_ATTEMPTS;

  await db
    .update(emailRequests)
    .set({
      status: done ? 'done' : exhausted ? 'failed' : 'pending',
      filed,
      note:
        note ??
        (done
          ? null
          : exhausted
            ? 'Gmail found nothing for that, after three tries.'
            : null),
      resolvedAt: done || exhausted ? new Date() : null,
    })
    .where(eq(emailRequests.id, id));
}
