import 'server-only';

import { recordSpend } from './spend';

import type { PurchaseWhere } from '../queries.shared';

/**
 * What a thing you want to buy looks like once it has been read.
 *
 * Every field is a guess and every field is editable. Nothing here files
 * itself, which is the same rule the clarify suggester works under: a
 * suggestion is a pre-filled answer you accept or overwrite.
 */
export type PurchaseRead = {
  title: string;
  cost: number | null;
  where: PurchaseWhere | null;
  url: string | null;
};

/**
 * The first address in the text, if there is one.
 *
 * Shared from a shop, most of what arrives is a URL with some marketing around
 * it — and the URL is the single most useful thing in it, because it is what
 * you will click when you decide to buy.
 */
function firstUrl(text: string): string | null {
  return /https?:\/\/[^\s<>"']+/i.exec(text)?.[0]?.replace(/[.,;:)]+$/, '') ?? null;
}

/**
 * "1.299,00" and "1,299.00" are the same number written two ways, and
 * `Number()` reads only one of them. The last separator with one or two digits
 * after it is the decimal point; everything else is a thousands mark.
 */
function toNumber(raw: string): number | null {
  const clean = raw.replace(/\s/g, '');
  const decimal = /[.,](\d{1,2})$/.exec(clean);

  const value = decimal
    ? Number(clean.slice(0, decimal.index).replace(/[.,]/g, '') + '.' + decimal[1])
    : Number(clean.replace(/[.,]/g, ''));

  return Number.isFinite(value) && value > 0 ? value : null;
}

/** What a price is called when it is *not* the one you would pay. */
const WAS_PRICE = /\b(was|rrp|list|before|instead of|típico|typical|save)\b[^\d£$€]{0,12}$/i;

/**
 * A price, read the way a person reads one.
 *
 * Requiring a currency marker is what separates "£19.99" from the "19" in "19
 * reviews" — a wrong price is worse than none, because it goes into a budget
 * total and is believed.
 *
 * Which of several is harder. A share almost always carries more than one
 * number: "Was £329.00 Now £274.99" is the ordinary case, and taking the first
 * gets it exactly backwards — the first tested share here returned the price
 * the thing *isn't*. So any price introduced by was/RRP/save is discarded, and
 * if that leaves nothing the smallest wins, a sale price being lower than the
 * thing it is discounted from.
 */
function firstPrice(text: string): number | null {
  const found: { value: number; discounted: boolean }[] = [];

  const amount = String.raw`\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?`;

  const patterns = [
    // Symbol first: £24.99.
    new RegExp(String.raw`[£$€]\s?(${amount})`, 'g'),
    /*
     * Symbol after: 24,99 €. Its own pattern rather than one alternation with
     * the letter codes, because `\b` is what stops "50" in "GBP50x" matching
     * and `\b` after `€` can never match at all — a symbol is not a word
     * character, so at the end of a string there is no boundary to find. One
     * combined pattern silently dropped every European-style price.
     */
    new RegExp(String.raw`(${amount})\s?[£$€]`, 'g'),
    new RegExp(String.raw`(${amount})\s?(?:GBP|EUR|USD)\b`, 'gi'),
  ];

  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const value = toNumber(m[1]);
      if (value === null) continue;

      // The dozen characters in front are enough to catch "Was £", "RRP £"
      // and "save £" without reaching back into the previous sentence.
      const before = text.slice(Math.max(0, m.index - 14), m.index);
      found.push({ value, discounted: WAS_PRICE.test(before) });
    }
  }

  if (found.length === 0) return null;

  const asking = found.filter((f) => !f.discounted);
  if (asking.length > 0) return asking[0].value;

  return Math.min(...found.map((f) => f.value));
}

/**
 * A title, from text that is mostly not one.
 *
 * The first line that is neither an address nor a price nor boilerplate,
 * trimmed to something that fits a row. Shared text usually opens with the
 * product name, which is why the first usable line is a better guess than
 * anything cleverer.
 */
function firstTitle(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 2 && !/^https?:\/\//i.test(l) && !/^[£$€]\s?\d/.test(l));

  return (line ?? '').replace(/\s+/g, ' ').slice(0, 120);
}

/**
 * Read a share without asking anyone.
 *
 * This runs first and always, and for the common case — a link shared out of a
 * shop app, which carries the name and the price in its preview text — it is
 * the whole answer. No key, no network, no wait. The model below only ever
 * improves on it.
 */
export function readPurchaseLocally(text: string): PurchaseRead {
  const url = firstUrl(text);

  return {
    title: firstTitle(text),
    cost: firstPrice(text),
    // An address means a shop. Nothing else in the text tells us where, and
    // guessing "in town" from its absence would be inventing a fact.
    where: url ? 'online' : null,
    url,
  };
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'cost', 'where'],
  properties: {
    title: {
      type: 'string',
      description:
        'The item itself, as short as it can be while still identifying which ' +
        'one — model or size included where they matter. No shop name, no ' +
        'marketing words, no price.',
    },
    cost: {
      type: ['number', 'null'],
      description:
        'The price you would actually pay, as a plain number. Null if the text ' +
        'does not say. Never a was-price, a monthly instalment or a delivery ' +
        'charge.',
    },
    where: {
      type: ['string', 'null'],
      enum: ['online', 'in_town', null],
      description:
        'online if it is bought from a website, in_town if the text describes ' +
        'a shop you would walk into. Null if it does not say.',
    },
  },
} as const;

/**
 * Ask a model to do better, when there is a key.
 *
 * Worth the call because the local pass is deliberately literal: it takes the
 * first plausible line as the title, which on a real listing is often
 * "Amazon.co.uk: BRAND New 2024 Model, 3-Pack, Blue, Free Delivery". Cutting
 * that down to the thing you are buying is exactly the sort of judgement a
 * model is for and a regular expression is not.
 *
 * It never replaces a value with nothing: a price the local pass found and the
 * model missed is kept, because the regex only matches text that really was in
 * the share and losing it would make the answer worse for having asked.
 */
export async function readPurchase(text: string): Promise<PurchaseRead> {
  const local = readPurchaseLocally(text);

  const key = process.env.CHATGPT_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key || text.trim().length < 3) return local;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.BOX_MODEL ?? 'gpt-5.4-mini',
        max_output_tokens: 400,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text:
                  'Someone wants to buy something and has shared this. Work out ' +
                  'what the item is and what it costs.\n\n' +
                  text.slice(0, 4000),
              },
            ],
          },
        ],
        text: {
          format: { type: 'json_schema', name: 'purchase', strict: true, schema: SCHEMA },
        },
      }),
    });

    if (!response.ok) return local;

    /*
     * The same shape the classifier reads, and worth being exact about: the
     * Responses API returns the text nested inside `output[].content[]`, not
     * as a top-level `output_text`. Reading the wrong field fails silently —
     * the call succeeds, the parse finds nothing, and every answer quietly
     * falls back to the local one while looking like the model ran.
     */
    const body = (await response.json()) as {
      model?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
      };
      output?: { content?: { type: string; text?: string }[] }[];
    };

    void recordSpend('purchase', body.model, body.usage);

    const text_ = (body.output ?? [])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text ?? '')
      .join('');

    if (!text_) return local;

    const read = JSON.parse(text_) as Partial<PurchaseRead>;

    return {
      title: read.title?.trim() || local.title,
      // `?? local` rather than the model's null: it only ever adds.
      cost: typeof read.cost === 'number' && read.cost > 0 ? read.cost : local.cost,
      where:
        read.where === 'online' || read.where === 'in_town' ? read.where : local.where,
      url: local.url,
    };
  } catch {
    // A model that is down, slow or misconfigured must not cost you the
    // capture. The local reading is already a usable answer.
    return local;
  }
}
