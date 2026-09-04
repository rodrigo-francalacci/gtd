import 'server-only';

import { recordSpend } from './spend';

/**
 * One emoji per row, so a list can be scanned rather than read.
 *
 * The point is recognition before reading: in a queue of thirty captures you
 * find the one about the boiler by its shape, not by working along the titles.
 * That only pays off if the same row keeps the same glyph, which is why these
 * are stored rather than derived — and why nothing here runs on its own. You
 * press the button, this runs once over what is on screen, and the answers are
 * written down.
 *
 * **One request for the whole list, not one per row.** Thirty rows is thirty
 * round trips, thirty lots of latency and thirty times the overhead, for a
 * question whose answers are three characters long. It is also *better* asked
 * together: a model that can see the whole list will give the two shopping
 * errands the same trolley, which is exactly the consistency that makes a list
 * scannable. Asked one at a time it cannot know the other rows exist.
 *
 * Structured output, so the reply is parsed rather than scraped, and the ids
 * come back with the emoji — an array in the same order would be a promise the
 * model has no way to keep, and a silent misalignment would put the wrong glyph
 * on every row.
 */

export type EmojiRequest = { id: string; title: string };

/** How many rows to ask about at once. */
/**
 * Twenty-five, down from forty.
 *
 * Not because forty was too many to ask about — because the *answer* has to fit
 * in `max_output_tokens`, and a reply keyed by uuid spends about eighteen
 * tokens per row on the id alone before the emoji. Add the reasoning tokens a
 * current model spends before it writes anything, which count against the same
 * budget, and forty rows was running the reply out of room: the JSON came back
 * cut off mid-string and `JSON.parse` threw "Unterminated string in JSON at
 * position 524" at somebody who had pressed a button.
 *
 * Smaller batches cost nothing extra — this is billed per token, not per call —
 * and the instructions are cached across them.
 */
const BATCH = 25;

/** The longest title worth sending: past this it is a note, not a label. */
const TITLE_LIMIT = 200;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'emoji'],
        properties: {
          id: { type: 'string', description: 'The id exactly as given.' },
          emoji: {
            type: 'string',
            description:
              'A single emoji character that identifies this item at a glance. ' +
              'No text, no numbers, no variation selectors described in words.',
          },
        },
      },
    },
  },
} as const;

/**
 * What kind of list this is, which changes what a good emoji is *for*.
 *
 * A task is found by its subject — the boiler item should look like a boiler —
 * because that is what you are scanning for. A filed document is found by its
 * *kind*: in a box of two hundred, "another receipt" is the useful signal and
 * which shop it came from is not, so two receipts wanting the same glyph is the
 * right answer rather than a failure of imagination. The document emoji also
 * stands in for the type icon, which is a statement about kind by construction.
 */
export type EmojiFlavour = 'task' | 'document';

const COMMON = [
  '',
  'Be consistent within the list. Prefer a plain, widely recognised emoji over',
  'a clever or obscure one.',
  '',
  'Return exactly one entry per id, using the id exactly as given.',
];

const INSTRUCTIONS: Record<EmojiFlavour, string> = {
  task: [
    'Each line below is one item from a personal to-do list or inbox, given as',
    'an id and a title. Choose one emoji for each that makes it recognisable at',
    'a glance in a long list.',
    '',
    'Pick for the *subject* of the item — what it is about — rather than the',
    'verb. "Ring the plumber about the boiler" is about the boiler, not about',
    'ringing. That is what makes a list scannable: the boiler item looks like a',
    'boiler every time you see it.',
    '',
    'If two items are both shopping, give them the same emoji; if two are about',
    'the same person, project or place, match them.',
    ...COMMON,
  ].join('\n'),

  document: [
    'Each line below is one document filed in a personal archive, given as an id',
    'and the title it was filed under. Choose one emoji for each saying what',
    'kind of document it is, so it can be picked out of a long list at a glance.',
    '',
    'Prefer the *kind* over the subject. Two receipts should get the same emoji',
    'as each other and a different one from a letter, a ticket, a bill, a',
    'contract or a photograph — in a list of two hundred, "another receipt" is',
    'the useful thing to see and which shop it came from is not.',
    ...COMMON,
  ].join('\n'),
};

/**
 * A single emoji, or nothing.
 *
 * Models return all sorts here — a word, two emoji, an emoji with a trailing
 * space, occasionally a sentence explaining the choice. A row is a fixed-width
 * slot, so anything but one glyph would break the alignment the slot exists to
 * keep. Rejected rather than trimmed to the first character, because the first
 * character of "fire" is "f".
 *
 * Counted in code points via the spread, not `.length`: almost every emoji is a
 * surrogate pair and half of them are longer still, so `'🔥'.length` is 2 and a
 * flag is 4. Zero-width joiners and variation selectors are dropped first,
 * which is what lets a family or a waving hand with a skin tone through as the
 * single glyph a reader sees.
 */
export function oneEmoji(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Anything ASCII is a word, a digit or punctuation — never an emoji.
  if (/[\x00-\x7f]/.test(trimmed)) return null;

  const glyphs = [...trimmed].filter(
    (c) => c !== '‍' && c !== '️' && c !== '︎',
  );

  // A joined sequence is many code points and one glyph; four is enough for a
  // family or a flag and short of a sentence.
  return glyphs.length >= 1 && glyphs.length <= 4 ? trimmed : null;
}

/** Raised when the API itself refused, so the reason can reach the screen. */
export class EmojiError extends Error {}

/** One definition, so the request and any complaint about it agree. */
function modelName(): string {
  return process.env.EMOJI_MODEL ?? process.env.BOX_MODEL ?? 'gpt-5.6-luna';
}

/** The sentence out of OpenAI's error envelope, or the raw body if it is not one. */
function apiMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

async function askForBatch(
  key: string,
  batch: EmojiRequest[],
  flavour: EmojiFlavour,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName(),
      /*
       * Room for the answer *and* for the thinking.
       *
       * Reasoning tokens are counted in `output_tokens` and come out of this
       * budget before a single visible character is written, so a figure sized
       * to the JSON alone leaves the reply truncated. A uuid is a dozen-odd
       * tokens by itself; 60 a row plus a fixed 600 covers both with room to
       * spare, and an unused allowance costs nothing — you are billed for what
       * is generated, not for what was permitted.
       */
      max_output_tokens: 600 + batch.length * 60,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                INSTRUCTIONS[flavour] +
                '\n\n' +
                batch
                  .map((item) => `${item.id}\t${item.title.slice(0, TITLE_LIMIT)}`)
                  .join('\n'),
            },
          ],
        },
      ],
      text: { format: { type: 'json_schema', name: 'emoji', strict: true, schema: SCHEMA } },
    }),
  });

  /*
   * Say what went wrong, rather than returning nothing and letting the caller
   * guess.
   *
   * This used to `return found` — an empty map — so a refused key, a retired
   * model name, an exhausted quota and a rate limit were all reported to the
   * person pressing the button as "that usually means CHATGPT_API_KEY is not
   * set". A guess presented as a diagnosis, and wrong in every case but one.
   * The model is named too, because the commonest way for this to break is an
   * `EMOJI_MODEL` or `BOX_MODEL` left pointing at something retired.
   */
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new EmojiError(
      `OpenAI refused the request (${response.status}) for model ` +
        `${modelName()}: ${apiMessage(detail)}`,
    );
  }

  /*
   * The Responses API nests the text inside `output[].content[]` rather than
   * offering a top-level `output_text`. Reading the wrong field fails silently:
   * the call succeeds, the parse finds nothing, and every list comes back with
   * no emoji while looking exactly as though the model had run.
   */
  const body = (await response.json()) as {
    model?: string;
    status?: string;
    incomplete_details?: { reason?: string };
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    };
    output?: { content?: { type: string; text?: string }[] }[];
  };

  /*
   * The receipt. Not awaited by anything that matters and never allowed to
   * throw: OpenAI will not say what is left in the account — measured, every
   * billing endpoint 403s with a project key — so what this app spends is only
   * knowable if it writes it down as it goes.
   */
  void recordSpend('emoji', body.model, body.usage);

  const text = (body.output ?? [])
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('');

  /*
   * A reply that ran out of room, recognised before it is parsed.
   *
   * The classifier has checked this since the day it was written; this did not,
   * and the difference showed as a raw `JSON.parse` error reaching the person
   * who pressed the button — "Unterminated string in JSON at position 524",
   * which says nothing about what to do. The reply *was* cut short, and saying
   * so names the fix.
   */
  if (body.status === 'incomplete') {
    throw new EmojiError(
      `${modelName()} ran out of room before finishing its answer ` +
        `(${body.incomplete_details?.reason ?? 'no reason given'}). ` +
        'Fewer rows at a time would fit; this is a bug rather than something ' +
        'you did.',
    );
  }

  if (!text) return found;

  /*
   * And a guard for everything else that can make a reply unreadable — a model
   * that ignored the schema, a proxy that injected a banner. The raw exception
   * would surface as a parser's complaint about a character position, which is
   * a true statement about the wrong subject.
   */
  let parsed: { items?: { id?: string; emoji?: string }[] };

  try {
    parsed = JSON.parse(text) as { items?: { id?: string; emoji?: string }[] };
  } catch {
    throw new EmojiError(
      `${modelName()} answered with something that is not the JSON it was ` +
        `asked for. It began: ${text.slice(0, 120)}`,
    );
  }

  const wanted = new Set(batch.map((item) => item.id));

  for (const item of parsed.items ?? []) {
    // An id we did not ask about is a model inventing a row; dropping it is
    // the same rule the box tags follow — the model proposes, code disposes.
    if (!item.id || !wanted.has(item.id)) continue;

    const emoji = oneEmoji(item.emoji);
    if (emoji) found.set(item.id, emoji);
  }

  return found;
}

/**
 * Emoji for as many of these as the model can name.
 *
 * Returns only what it is confident about: a row the model skipped, or answered
 * with a word, keeps whatever it had. That matters more than it sounds — the
 * alternative is clearing a good emoji because one call went badly, and the
 * button is pressed on a list you are looking at.
 *
 * An empty map is the honest answer when there is no key. The queue rule this
 * app follows everywhere else — never schedule a job nothing can run — becomes,
 * for something you pressed a button for, "say nothing happened".
 */
export async function pickEmoji(
  items: EmojiRequest[],
  flavour: EmojiFlavour = 'task',
): Promise<{ found: Map<string, string>; failure: string | null }> {
  const key = process.env.CHATGPT_API_KEY ?? process.env.OPENAI_API_KEY;
  const found = new Map<string, string>();

  /*
   * Carried back beside the results, not parked in module scope: two presses
   * in flight at once would otherwise read each other's reason, and a
   * diagnostic that can be about a different run is worse than none.
   */
  let failure: string | null = null;

  if (!key) {
    return {
      found,
      failure:
        'No OpenAI key is visible to this deployment. CHATGPT_API_KEY may be ' +
        'set in Vercel but added after the build that is running — a variable ' +
        'only reaches deployments made after it was saved, so redeploy once.',
    };
  }

  const usable = items.filter((item) => item.title.trim().length > 1);

  for (let at = 0; at < usable.length; at += BATCH) {
    try {
      for (const [id, emoji] of await askForBatch(key, usable.slice(at, at + BATCH), flavour)) {
        found.set(id, emoji);
      }
    } catch (error) {
      // One batch failing must not lose the ones that worked. A long list part
      // marked is better than a long list unmarked, and pressing again fills in
      // the rest — but the reason is kept, because a run that marked nothing
      // has to be able to say why rather than blaming the key.
      failure ??= error instanceof Error ? error.message : String(error);
    }
  }

  // Never thrown: partial success is the ordinary case and must not become an
  // error, so the reason rides alongside whatever did come back.
  return { found, failure };
}
