import 'server-only';

import { recordSpend } from './spend';
import type { ListPhotoKind, ReadItem, ReadList } from '@/lib/list-photo';

/**
 * Read a photograph of a handwritten list into rows you can edit.
 *
 * **Two passes in one call, and that is the whole design.** Asked to "read
 * this list", the model reads and interprets at once — and where the
 * handwriting is hard it writes something plausible instead of something
 * present. Measured on the first real page: a line reading "This is another
 * action with no queue tasks whatsoever" came back as "This is another
 * exercise we can do", marked confident. Nothing downstream can catch that,
 * because it reads perfectly well.
 *
 * So the reply carries `lines` — every physical line, verbatim, with its
 * marker — *before* `items`, which are those lines grouped. Transcribing first
 * is what stops the paraphrase: the same page then came back word for word
 * apart from one misread, and that item was flagged `unsure`.
 *
 * **The whole line, or nothing, is struck.** The first attempt at the
 * crossing-out rule marked a line struck because two words in it were scored
 * out, and dropped the entire item. A few dead words leave the line; only a
 * line crossed out end to end is gone.
 *
 * **Nothing here writes anything.** The reply is a proposal, edited and
 * confirmed by hand before a single row exists — which is the app's standing
 * rule for anything a model produced, and it matters more here than anywhere
 * else: a misread word looks exactly like a read one.
 */

/**
 * The reading model, not the cheap one, and the difference was measured.
 *
 * On the same page `gpt-5.6-luna` misread two words of a line where
 * `gpt-5.6-terra` misread one, and terra's mistake was flagged. A page costs
 * about 1.2p on terra against 0.2p on luna — a penny, on something you do by
 * hand a few times a week, to be told when it is unsure.
 */
function modelName(): string {
  return process.env.HANDWRITING_MODEL ?? process.env.ENRICH_MODEL ?? 'gpt-5.6-terra';
}

/** What a nested line means, which is a fact about where the photo is going. */
const SHAPE: Record<ListPhotoKind, string> = {
  now: 'Each top-level item is an action. Anything nested under one is what that action becomes next, in order — its queue.',
  project:
    'Each top-level item is an action of one project. Anything nested under one is what that action becomes next, in order — its queue.',
  purchases:
    'Each top-level item is something to buy. A nested line is a note on the item above it.',
  list: 'Each top-level item is one line of a list — a book, a place, a thing to check. A nested line is a note on the item above it.',
  inbox: 'Each top-level item is one captured thought. A nested line is a note on it.',
};

function buildPrompt(kind: ListPhotoKind): string {
  return `You are reading a photograph of a handwritten list, written by the person who owns this app.

Work in two passes, and put both in your answer.

PASS ONE — "lines". Go down the page and write out every handwritten line you can see, in order, exactly as written. One entry per physical line on the paper, even when a sentence runs across two lines. For each line record:
- "text": the words on that line, verbatim. Do not join it to another line, do not tidy it, and do not finish a sentence the writer did not finish.
- "marker": what begins the line — "bullet" for a dot or dash at the left margin, "arrow" for an arrow of any shape, "none" for a line that simply starts with words.
- "indented": true if the line starts noticeably to the right of the left margin.
- "struck": true ONLY when the whole line has been crossed out. If just a word or two are crossed out in an otherwise live line, leave "struck" false and leave those words out of "text" — the rest of that line is still something the writer wrote and meant.

Transcribe what is actually on the paper. Where a word is hard to read, give your closest reading of the shapes you can see, letter by letter if you must. **Never replace a word you cannot read with a word that would make sense there.** A wrong guess that reads naturally is the worst possible answer, because nobody can tell it from a right one.

PASS TWO — "items". Group those lines into the list.
${SHAPE[kind]}
- A line with a bullet, or an unindented line that starts a new thought, begins a new item.
- A line with an arrow, or an indented line, belongs to the item above it as a child.
- A line with no marker that continues the sentence above it is part of that item: join it with a single space.
- Lines you marked struck are left out entirely. A line with a few words crossed out is not struck; it keeps its remaining words.
- "unsure" is true for any item built from a line you were not confident reading.

Prices: if an item names one, put the number in "price" and the symbol or code as written in "currency". "~15" and "about 15" are prices; "2x" is a quantity and is not. No price written means null.

Never invent an item. A page with no list on it is an empty list.`;
}

const ITEM_PROPERTIES = {
  text: { type: 'string' },
  price: { type: ['number', 'null'] },
  currency: { type: ['string', 'null'] },
  unsure: { type: 'boolean' },
} as const;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lines', 'items'],
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'marker', 'indented', 'struck'],
        properties: {
          text: { type: 'string' },
          marker: { type: 'string', enum: ['bullet', 'arrow', 'none'] },
          indented: { type: 'boolean' },
          struck: { type: 'boolean' },
        },
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'price', 'currency', 'unsure', 'children'],
        properties: {
          ...ITEM_PROPERTIES,
          children: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'price', 'currency', 'unsure'],
              properties: ITEM_PROPERTIES,
            },
          },
        },
      },
    },
  },
};

/**
 * Reasoning runs before a visible character is written, the trap the emoji
 * batch was caught by — a page of two items spent 1,485 tokens thinking.
 */
const MAX_OUTPUT_TOKENS = 6000;

export class UnreadablePage extends Error {}

export async function readHandwrittenList(
  bytes: ArrayBuffer,
  mimeType: string,
  kind: ListPhotoKind,
): Promise<ReadList> {
  const key = process.env.CHATGPT_API_KEY;
  if (!key) throw new UnreadablePage('No CHATGPT_API_KEY is set, so nothing can read a photo.');

  const model = modelName();

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`,
              detail: 'high',
            },
            { type: 'input_text', text: buildPrompt(kind) },
          ],
        },
      ],
      text: {
        format: { type: 'json_schema', name: 'handwritten_list', strict: true, schema: SCHEMA },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    /* Say what the model said, the rule the emoji button had to learn: a
       retired model name, an exhausted quota and a missing key all read as
       "it didn't work" otherwise. */
    throw new UnreadablePage(`OpenAI ${response.status}: ${detail.slice(0, 300)}`);
  }

  const body = await response.json();

  // Not awaited, and never allowed to fail the read that earned it.
  void recordSpend('handwriting', body?.model, body?.usage);

  /* A truncated reply is unparseable JSON, and reporting *that* would name the
     wrong subject — the classifier's rule, which the emoji path had to be
     taught after it reached somebody as "Unterminated string at position 524". */
  if (body?.status === 'incomplete') {
    throw new UnreadablePage('The page was longer than one reading. Try photographing half of it.');
  }

  const text: string = (body?.output ?? [])
    .flatMap((part: { content?: { type: string; text?: string }[] }) => part.content ?? [])
    .filter((part: { type: string }) => part.type === 'output_text')
    .map((part: { text?: string }) => part.text ?? '')
    .join('');

  let parsed: ReadList;
  try {
    parsed = JSON.parse(text) as ReadList;
  } catch {
    throw new UnreadablePage('The reader answered with something this app could not read.');
  }

  return clean(parsed);
}

/** Keep the trimming rules in one place: the panel gets tidy rows or none. */
function tidy(raw: unknown, limit = 300): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function child(raw: Partial<ReadItem> | undefined): Omit<ReadItem, 'children'> | null {
  const text = tidy(raw?.text);
  if (!text) return null;
  return {
    text,
    price: typeof raw?.price === 'number' && Number.isFinite(raw.price) ? raw.price : null,
    currency: tidy(raw?.currency, 4) || null,
    unsure: raw?.unsure === true,
  };
}

/**
 * The model proposes; code disposes — the same gate the box tags go through.
 * An item with no words is dropped rather than shown as an empty row somebody
 * has to notice and untick.
 */
function clean(parsed: ReadList): ReadList {
  const items = (Array.isArray(parsed?.items) ? parsed.items : []).flatMap((raw) => {
    const head = child(raw);
    if (!head) return [];
    const children = (Array.isArray(raw.children) ? raw.children : []).flatMap(
      (one) => child(one) ?? [],
    );
    return [{ ...head, children }];
  });

  const lines = (Array.isArray(parsed?.lines) ? parsed.lines : []).flatMap((raw) => {
    const text = tidy(raw?.text);
    if (!text) return [];
    return [
      {
        text,
        marker: (['bullet', 'arrow', 'none'] as const).includes(raw?.marker)
          ? raw.marker
          : 'none',
        indented: raw?.indented === true,
        struck: raw?.struck === true,
      },
    ];
  });

  return { lines, items };
}
