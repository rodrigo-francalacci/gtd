import 'server-only';

import { recordSpend } from '@/lib/ai/spend';

import type { BoxCategoryRow } from '@/lib/queries.shared';
import { oneEmoji } from '../ai/emoji';
import { isGoogleNative } from '@/lib/google/sync';

/**
 * Reading a document well enough to file it.
 *
 * The enrichment queue asks a model for one thing — the words in a file — so
 * search can reach inside it. This asks for four: a name, a summary, the date
 * printed on it, and which of *this box's* tags apply. The difference matters,
 * because the last one is the only place in the app where a model's output is
 * allowed to become structured data, and so the only place that needs a gate
 * between what it says and what gets stored.
 */

/** What the model proposes, before anything has been checked. */
export type ProposedTag = { category: string; tag: string };

export type Classification = {
  title: string;
  /**
   * One emoji for what this is, or null when the model did not offer a usable
   * one. Free to ask for: the document is already being read, already being
   * titled and already being summarised.
   */
  emoji: string | null;
  description: string;
  /** The date printed on the document, `YYYY-MM-DD`, or null if there isn't one. */
  date: string | null;
  /** Every word, for search. */
  text: string;
  tags: ProposedTag[];
};

export class UnreadableDocument extends Error {}

export interface Classifier {
  classify(
    file: { name: string; mimeType: string; bytes: ArrayBuffer },
    box: { instruction: string; rules: string },
    categories: BoxCategoryRow[],
  ): Promise<Classification>;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Roughly the first few pages. Past that, a summary stops improving. */
const MAX_CHARS = 20_000;

/**
 * The largest file this app will hand to a model, and why there is a limit.
 *
 * Not Drive's problem: a box of scans is measured in megabytes and the free
 * Drive allowance is fifteen gigabytes, so the disk is not what runs out.
 * OpenAI's own ceiling is 50 MB per request, which is also not what bites
 * first. The cost is. A PDF is billed as its extracted text *and* a rendered
 * image of every page, so the price of reading a document rises with its page
 * count whether or not there is anything on those pages worth knowing — and a
 * book is a thousand pages of prose nobody is going to search for by phrase.
 *
 * Twelve megabytes is about a hundred scanned pages, which is comfortably more
 * than any receipt, bill, letter or manual that belongs in a box and
 * comfortably less than a book. Over it, the file is still uploaded, still
 * filed, still previewable and still findable by its name — it simply isn't
 * read. That is a better answer than either of the two this app gave before:
 * pay for it silently, or fail the row and leave a red entry behind.
 */
export const MAX_CLASSIFY_BYTES = 12 * 1024 * 1024;

/**
 * A ceiling on the reply, in tokens.
 *
 * `text` asks for a verbatim transcription, so the output grows with the
 * document exactly as the input does — and output tokens are the dear ones.
 * Without this a long document could bill for a reply nobody would ever read
 * to the end of. The prompt asks for the same restraint in words; this is what
 * makes it true.
 */
const MAX_OUTPUT_TOKENS = 8_000;

/** Stored transcriptions stop here, a little above what the model may return. */
export const MAX_TEXT_CHARS = 60_000;

export function canClassify(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return (
    IMAGE_TYPES.has(mimeType) ||
    mimeType === 'application/pdf' ||
    isGoogleNative(mimeType) ||
    isPlainish(mimeType)
  );
}

function isPlainish(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/x-yaml'
  );
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export type ValidatedTags = {
  /** Tags that already existed and were named correctly. */
  tagIds: string[];
  /** New values for categories that permit them — a city, typically. */
  create: { categoryId: string; name: string }[];
  /** What was thrown away, kept so the item can say why it has fewer tags. */
  dropped: ProposedTag[];
};

/**
 * Match what the model proposed against what the box actually allows.
 *
 * This is code rather than a line in the prompt, and that is the whole point.
 * A prompt is a request: ask for one of five values often enough and you will
 * eventually get a sixth, and by then it is in the database and the filter bar
 * has two tags that mean the same thing. The instruction still goes in the
 * prompt — a model told the rules obeys them most of the time and produces
 * better tags for knowing them — but nothing downstream depends on that.
 *
 * Matching ignores case and surrounding space, so "tesco" reuses "Tesco"
 * rather than creating a second one. The same reasoning as `resolveParty`:
 * without it you end up with three Tescos and renaming one fixes nothing.
 */
export function validateTags(
  categories: BoxCategoryRow[],
  proposed: ProposedTag[],
): ValidatedTags {
  const result: ValidatedTags = { tagIds: [], create: [], dropped: [] };
  const seen = new Set<string>();
  const key = (s: string) => s.trim().toLowerCase();

  const byName = new Map(categories.map((c) => [key(c.name), c]));

  for (const item of proposed) {
    if (!item?.category || !item?.tag) continue;

    const category = byName.get(key(item.category));
    if (!category) {
      result.dropped.push(item);
      continue;
    }

    const existing = category.tags.find((t) => key(t.name) === key(item.tag));

    if (existing) {
      if (!seen.has(existing.id)) {
        seen.add(existing.id);
        result.tagIds.push(existing.id);
      }
      continue;
    }

    if (category.allowNewTags) {
      const name = item.tag.trim();
      const duplicate = result.create.some(
        (c) => c.categoryId === category.id && key(c.name) === key(name),
      );
      if (name && !duplicate) result.create.push({ categoryId: category.id, name });
      continue;
    }

    result.dropped.push(item);
  }

  return result;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'emoji', 'description', 'date', 'text', 'tags'],
  properties: {
    title: { type: 'string' },
    emoji: {
      type: 'string',
      description:
        'A single emoji standing for what this document is. No text, no ' +
        'numbers, no explanation.',
    },
    description: { type: 'string' },
    date: { type: ['string', 'null'] },
    text: { type: 'string' },
    tags: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'tag'],
        properties: {
          category: { type: 'string' },
          tag: { type: 'string' },
        },
      },
    },
  },
} as const;

function buildPrompt(
  box: { instruction: string; rules: string },
  categories: BoxCategoryRow[],
): string {
  const lines = [
    'Read this document and describe it for a personal filing system.',
    '',
    box.instruction.trim() ||
      'These are documents from one person’s life, of no fixed kind.',
    '',
    'Return:',
    '- title: a short descriptive title, 10-15 words at most, suitable for a filename.',
    // It stands in for the type icon in a list, so it wants to say what the
    // document *is* — a receipt, a bill, a ticket — rather than decorate the
    // subject. Two receipts from different shops should look alike; a receipt
    // and a letter should not.
    '- emoji: one emoji standing for what kind of document this is, so it can be recognised in a list at a glance. Prefer the kind of document over its subject: two receipts should get the same emoji as each other, and a different one from a letter or a ticket.',
    '- description: about four lines of prose saying what this is. Do not begin with "This document".',
    '- date: the most relevant date printed on the document, as YYYY-MM-DD. Null if there is no date on it — do not guess one from context.',
    // The transcription is what makes a scan searchable, and it is also the
    // only field whose length is set by the document rather than by the ask.
    // A receipt is a paragraph; twenty pages of terms and conditions is not
    // something anyone will ever read here, and paying to reproduce it in full
    // buys nothing that a summary of the back half doesn't.
    '- text: every word you can read, verbatim, in reading order. If the document runs to more than a few pages, transcribe the first few in full and then summarise the rest — this field exists so the document can be found again, not so it can be reproduced.',
    '  If there is no text at all, describe what is shown in one sentence instead.',
    '- tags: {category, tag} pairs from the lists below.',
  ];

  // The box's own rules for the title and summary, next to the bullets they
  // change. What belongs here is particular — "include the items bought and
  // the final total" is right for receipts and meaningless for letters — which
  // is exactly why it is per box and written by hand rather than guessed at.
  const rules = box.rules.trim();
  if (rules) lines.push('', 'For this box in particular:', rules);

  if (categories.length > 0) {
    lines.push('', 'Categories and their allowed tags:');

    for (const category of categories) {
      const allowed = category.tags.map((t) => t.name).join(', ') || '(none yet)';
      lines.push(
        `- ${category.name}: ${allowed}` +
          (category.allowNewTags
            ? ' — if none of these fit, you may return a new value for this category.'
            : ' — choose ONLY from this exact list. Do not invent, pluralise, abbreviate or rename a tag.'),
      );
    }

    /**
     * Work through every category, and judge by what the document *is*.
     *
     * The first version of this said only "omit a category rather than forcing
     * a match", and the model took the hint: a Shell fuel receipt came back
     * tagged Shell and Swindon but not Receipt, with Receipt sitting right
     * there in a category of its own. Omission was written as the safe
     * default when it should be the exception — and the failure it guards
     * against, an invented tag, is already impossible, because every tag is
     * checked against this list in code before anything is stored.
     */
    lines.push(
      '',
      `Go through all ${categories.length} categories in turn and apply every tag that genuinely fits. A document usually belongs in most of them.`,
      'Judge by what the document is, not by the words it happens to contain: a fuel receipt is a Receipt whether or not it prints that word, and a letter from a council is from that council whether or not it says so in the body.',
      'Omit a category only when none of its tags really applies. Spell tags exactly as above, with no leading "#".',
    );
  }

  return lines.join('\n');
}

/**
 * OpenAI reads the document.
 *
 * The Responses API rather than chat completions, because it takes a PDF
 * directly as `input_file` — a scanned letter needs no OCR step of its own,
 * which is what the Apps Script version had to do by round-tripping through a
 * temporary Google Doc. Structured output is a strict JSON schema rather than
 * "please return JSON", so a malformed reply is the API's problem, not ours.
 *
 * Verified against the real API before this was written: a base64 PDF plus
 * this schema comes back parsed, dated and tagged.
 */
export class OpenAiClassifier implements Classifier {
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.BOX_MODEL ?? 'gpt-5.4-mini',
  ) {}

  async classify(
    file: { name: string; mimeType: string; bytes: ArrayBuffer },
    box: { instruction: string; rules: string },
    categories: BoxCategoryRow[],
  ): Promise<Classification> {
    const prompt = buildPrompt(box, categories);
    const content = this.contentFor(file);

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [
          {
            role: 'user',
            content: [...content, { type: 'input_text', text: prompt }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'document',
            strict: true,
            schema: SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      const message = `OpenAI ${response.status}: ${detail.slice(0, 400)}`;

      // A 4xx that isn't a rate limit means the request was wrong, and the
      // worker must not spend four more attempts proving it again.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new UnreadableDocument(message);
      }
      throw new Error(message);
    }

    const body = (await response.json()) as {
      status?: string;
      incomplete_details?: { reason?: string };
      model?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
      };
      output?: { content?: { type: string; text?: string }[] }[];
    };

    /*
     * The receipt, written even when the reply turns out to be unusable below.
     * A truncated answer is charged for exactly like a good one, and a spend
     * total that only counted the successes would understate the reads that
     * cost the most.
     */
    void recordSpend('box', body.model, body.usage);

    /**
     * A reply that ran out of room is truncated JSON, and truncated JSON does
     * not parse. Left to the generic path that would be an ordinary error and
     * the worker would buy the same truncated answer four more times, so it is
     * caught here and called what it is: this document is too long to read,
     * which no amount of retrying will change.
     */
    if (body.status === 'incomplete') {
      throw new UnreadableDocument(
        `The reply was cut short (${body.incomplete_details?.reason ?? 'no reason given'}). This document is too long to read in one pass.`,
      );
    }

    const text = (body.output ?? [])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text ?? '')
      .join('');

    if (!text) throw new UnreadableDocument('OpenAI returned nothing to parse.');

    const parsed = JSON.parse(text) as Classification;

    return {
      title: (parsed.title ?? '').trim(),
      // Through the same gate the list button uses, so "a receipt" and two
      // emoji in a row are refused in one place rather than two that disagree.
      emoji: oneEmoji(parsed.emoji),
      description: (parsed.description ?? '').trim(),
      date: normaliseDate(parsed.date),
      text: (parsed.text ?? '').trim(),
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  }

  /** How the file itself is handed over, which differs by what it is. */
  private contentFor(file: { name: string; mimeType: string; bytes: ArrayBuffer }) {
    const base64 = () => Buffer.from(file.bytes).toString('base64');

    if (file.mimeType === 'application/pdf') {
      return [
        {
          type: 'input_file',
          filename: file.name,
          file_data: `data:application/pdf;base64,${base64()}`,
        },
      ];
    }

    if (IMAGE_TYPES.has(file.mimeType)) {
      return [
        {
          type: 'input_image',
          image_url: `data:${file.mimeType};base64,${base64()}`,
        },
      ];
    }

    // Anything already text — including a Google Doc, which the worker exports
    // before it gets here — goes as text. Sending it as a file would cost more
    // and read no better.
    const decoded = new TextDecoder().decode(file.bytes).slice(0, MAX_CHARS);
    return [
      {
        type: 'input_text',
        text: `Filename: ${file.name}\n\n${decoded}`,
      },
    ];
  }
}

/** Accept only a real `YYYY-MM-DD`; anything else is treated as no date. */
function normaliseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const date = new Date(`${value.trim()}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : value.trim();
}

/**
 * Null when there's no key.
 *
 * The queue reads that as "don't claim work you can't do" rather than "fail
 * it": documents sit unread, keep their arrival date, and are picked up whole
 * the day a key appears. A box whose documents are only findable by date is
 * still the box — that is how the original worked for years.
 */
export function classifier(): Classifier | null {
  const key = process.env.CHATGPT_API_KEY ?? process.env.OPENAI_API_KEY;
  return key ? new OpenAiClassifier(key) : null;
}
