import 'server-only';

import { attachments, db } from '@gtd/db';
import { eq } from 'drizzle-orm';
import { recordSpend } from './spend';
import { safeName } from '@/lib/google/sync';

/**
 * Name a file after what it turns out to be.
 *
 * A photograph attached to a project arrives called `IMG_4821.jpg`, and a scan
 * arrives called whatever the scanner's clock said. Neither is a name anybody
 * picks out of a list in six months, which is the whole reason the box titles
 * its documents — this is the same idea, aimed at the files that arrive through
 * a capture instead.
 *
 * **It never reads the file.** That is the entire cost design, and it is the
 * same rule the box's emojify button follows: the app already reads attachments
 * in the background to fill `ocr_text` for search, so the words are either
 * already there or on their way, and paying a second time to look at bytes that
 * have already been looked at is the expensive mistake available here. A PDF
 * bills as its extracted text *and* an image of every page; a photograph of a
 * receipt is an image. Re-reading forty of them to improve their filenames
 * would cost more than the reading that made them findable in the first place.
 *
 * So this is one small text request over words the app already holds, capped
 * hard, and skipped entirely when there is nothing to go on. A file with no
 * reading yet keeps the name it came with — the enrichment queue will fill
 * `ocr_text` shortly, and nothing stops it being renamed by hand meanwhile.
 */

/**
 * How much of a reading to send.
 *
 * Twelve hundred characters is a page of prose, which is far more than naming
 * needs — a receipt says who and how much in its first two lines, and a letter
 * says what it is in its first paragraph. The cap is what stops a forty-page
 * scan turning a filename into a real cost.
 */
const TEXT_LIMIT = 1200;

const INSTRUCTIONS = [
  'Name this file so its owner can find it in a folder months from now.',
  '',
  'Reply with a short name: what the document is, and whose or which where that',
  'is what distinguishes it — "Npower bill March 2026", "Kitchen worktop quote',
  'from Hanson", "Passport photo". Six words at most.',
  '',
  'No file extension, no date prefix, no quotes, no trailing full stop. If the',
  'text does not say what the document is, reply with an empty string rather',
  'than guessing.',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
  additionalProperties: false,
} as const;

/**
 * A name that is worth replacing.
 *
 * A camera's name, a scanner's name, a screenshot's name — all of them describe
 * the machine rather than the document. A name somebody typed is left alone:
 * being renamed by a model after you have named something yourself is the app
 * overruling you, which is the line the whole raw-capture rule is drawn on.
 */
const MACHINE_NAME =
  /^(img[-_ ]?\d+|dsc[-_ ]?\d+|pxl[-_ ]?\d+|photo[-_ ]?\d*|image[-_ ]?\d*|screenshot[\w\-. ]*|scan[-_ ]?\d*|document[-_ ]?\d*|untitled[\w\- ]*|\d{4}[-_]\d{2}[-_]\d{2}[\w\-. :]*)$/i;

function looksAutomatic(name: string): boolean {
  const base = name.replace(/\.[a-z0-9]{1,8}$/i, '').trim();
  return base.length === 0 || MACHINE_NAME.test(base);
}

/**
 * Rename one attachment from what is already known about it.
 *
 * Returns quietly in every case where it should not act: no key, no such row, a
 * name somebody chose, or nothing read yet. Those are the ordinary cases, not
 * failures — most files keep the name they arrived with.
 */
export async function nameAttachment(attachmentId: string): Promise<void> {
  const key = process.env.CHATGPT_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) return;

  const [file] = await db
    .select({
      name: attachments.name,
      kind: attachments.kind,
      mimeType: attachments.mimeType,
      ocrText: attachments.ocrText,
    })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  if (!file) return;

  // A gallery is a folder somebody named; there is nothing to read and nothing
  // to improve.
  if (file.kind === 'gallery') return;
  if (!looksAutomatic(file.name)) return;

  const text = file.ocrText?.trim();
  if (!text) return;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.BOX_MODEL ?? 'gpt-5.6-luna',
      // A short name and the JSON around it. Nothing here should be long.
      max_output_tokens: 80,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `${INSTRUCTIONS}\n\n${text.slice(0, TEXT_LIMIT)}`,
            },
          ],
        },
      ],
      text: {
        format: { type: 'json_schema', name: 'filename', strict: true, schema: SCHEMA },
      },
    }),
  });

  if (!response.ok) return;

  const body = (await response.json()) as {
    model?: string;
    usage?: Record<string, unknown>;
    output?: { content?: { type: string; text?: string }[] }[];
  };

  void recordSpend('filename', body.model, body.usage);

  const raw = (body.output ?? [])
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('');

  let suggested = '';

  try {
    suggested = String((JSON.parse(raw) as { name?: unknown }).name ?? '');
  } catch {
    return;
  }

  /*
   * The model proposes and code disposes, as everywhere else here: anything
   * empty, absurdly long, or full of path characters is refused rather than
   * stored. `safeName` is the same rule Drive filenames already go through, so
   * a name written here and a name written by the box cannot disagree.
   */
  const cleaned = safeName(suggested.trim()).slice(0, 80).trim();
  if (cleaned.length < 3) return;

  /*
   * The extension is kept whatever the model says, for the reason renaming by
   * hand keeps it: a file the operating system no longer knows how to open is
   * a worse outcome than a dull name.
   */
  const extension = /\.[a-z0-9]{1,8}$/i.exec(file.name)?.[0] ?? '';
  const next = cleaned.toLowerCase().endsWith(extension.toLowerCase())
    ? cleaned
    : `${cleaned}${extension}`;

  if (next === file.name) return;

  /*
   * Only our row. `drive_name` still holds what Drive has, so the disagreement
   * *is* the outstanding work and the rename sweep on the cron tick carries it
   * over — exactly as renaming by hand does.
   */
  await db.update(attachments).set({ name: next }).where(eq(attachments.id, attachmentId));
}
