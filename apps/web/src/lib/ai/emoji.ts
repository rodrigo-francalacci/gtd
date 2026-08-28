import 'server-only';

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
const BATCH = 40;

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

const INSTRUCTION = [
  'Each line below is one item from a personal to-do list or inbox, given as an',
  'id and a title. Choose one emoji for each that makes it recognisable at a',
  'glance in a long list.',
  '',
  'Pick for the *subject* of the item — what it is about — rather than the verb.',
  '"Ring the plumber about the boiler" is about the boiler, not about ringing.',
  'That is what makes a list scannable: the boiler item looks like a boiler',
  'every time you see it.',
  '',
  'Be consistent within the list. If two items are both shopping, give them the',
  'same emoji; if two are about the same person, project or place, match them.',
  'Prefer a plain, widely recognised emoji over a clever or obscure one.',
  '',
  'Return exactly one entry per id, using the id exactly as given.',
].join('\n');

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
function oneEmoji(raw: unknown): string | null {
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

async function askForBatch(
  key: string,
  batch: EmojiRequest[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.EMOJI_MODEL ?? process.env.BOX_MODEL ?? 'gpt-5.4-mini',
      // Three characters and an id per row, plus room for the structure.
      max_output_tokens: 120 + batch.length * 40,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                INSTRUCTION +
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

  if (!response.ok) return found;

  /*
   * The Responses API nests the text inside `output[].content[]` rather than
   * offering a top-level `output_text`. Reading the wrong field fails silently:
   * the call succeeds, the parse finds nothing, and every list comes back with
   * no emoji while looking exactly as though the model had run.
   */
  const body = (await response.json()) as {
    output?: { content?: { type: string; text?: string }[] }[];
  };

  const text = (body.output ?? [])
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('');

  if (!text) return found;

  const parsed = JSON.parse(text) as { items?: { id?: string; emoji?: string }[] };
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
export async function pickEmoji(items: EmojiRequest[]): Promise<Map<string, string>> {
  const key = process.env.CHATGPT_API_KEY ?? process.env.OPENAI_API_KEY;
  const found = new Map<string, string>();

  if (!key) return found;

  const usable = items.filter((item) => item.title.trim().length > 1);

  for (let at = 0; at < usable.length; at += BATCH) {
    try {
      for (const [id, emoji] of await askForBatch(key, usable.slice(at, at + BATCH))) {
        found.set(id, emoji);
      }
    } catch {
      // One batch failing must not lose the ones that worked. A long list part
      // marked is better than a long list unmarked, and pressing again fills in
      // the rest.
    }
  }

  return found;
}
