import 'server-only';

import { recordSpend } from './spend';

/**
 * Where, how long, and how much of you it takes — guessed, so you can amend.
 *
 * Filling in three dimensions by hand is the slowest part of clarifying, and it
 * is slow in a particular way: none of the three is *hard*, they are just three
 * more decisions between a thought and being finished with it. Amending one
 * wrong guess is far less work than making three right ones, which is the whole
 * argument for this — the model proposes a starting point and the row you were
 * going to build by hand is already most of the way there.
 *
 * **Not `who`.** The other three are properties of the work — a phone call is a
 * phone call wherever it came from — while who you need is a fact about your
 * life that the text of a capture almost never states and a model would be
 * guessing at from a name it has no reason to recognise. A wrong person on an
 * action is worse than no person: it puts the row on somebody's agenda.
 *
 * **Only what the box already knows.** The contexts are user data, not an enum,
 * so the model is given this account's own vocabulary and every id that comes
 * back is checked against it. Anything invented is dropped — the same rule the
 * box tags follow, in code rather than in the prompt, because a prompt is a
 * request and a filter is a guarantee.
 */

export type ContextOption = { id: string; name: string };

/** The three dimensions worth guessing, in the order the pane shows them. */
export type ContextGroups = {
  place: ContextOption[];
  time: ContextOption[];
  energy: ContextOption[];
};

/** Past this a capture is a note, and the first paragraph has said it already. */
const TEXT_LIMIT = 600;

const INSTRUCTIONS = [
  'Below is something someone wrote down to do, and the labels they use to sort',
  'their work. Choose the labels that fit.',
  '',
  'Pick AT MOST ONE from each group, using the exact id given. Leave a group out',
  'entirely when the text does not say — a guess that is wrong costs more to',
  'undo than an empty field costs to fill in. "Where" is the place or tool the',
  'work needs, "Time" is roughly how long it takes, "Energy" is how much',
  'concentration it wants.',
].join('\n');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['place', 'time', 'energy'],
  properties: {
    // Nullable rather than optional: `strict` requires every key to be present,
    // and null is how the model says "this one does not apply".
    place: { type: ['string', 'null'] },
    time: { type: ['string', 'null'] },
    energy: { type: ['string', 'null'] },
  },
} as const;

/**
 * Suggest contexts for one capture. Returns the ids that survived checking.
 *
 * Never throws: a failure here must cost the suggestion and nothing else, since
 * the panel it feeds is perfectly usable with three empty rows — which is
 * exactly what it was before this existed.
 */
export async function suggestContexts(
  text: string,
  groups: ContextGroups,
): Promise<string[]> {
  const key = process.env.CHATGPT_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!key) return [];

  const trimmed = text.trim();
  if (!trimmed) return [];

  // Nothing to choose from is not a failure, but it is not worth a request.
  const all = [...groups.place, ...groups.time, ...groups.energy];
  if (all.length === 0) return [];

  const vocabulary = (['place', 'time', 'energy'] as const)
    .map((dimension) => {
      const options = groups[dimension];
      if (options.length === 0) return null;

      return `${dimension}:\n${options.map((o) => `  ${o.id}\t${o.name}`).join('\n')}`;
    })
    .filter(Boolean)
    .join('\n\n');

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.CONTEXT_MODEL ?? process.env.BOX_MODEL ?? 'gpt-5.4-mini',
        // Three ids and the structure around them. Nothing here is long.
        max_output_tokens: 200,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `${INSTRUCTIONS}\n\nThe labels:\n${vocabulary}\n\nWhat they wrote:\n${trimmed.slice(0, TEXT_LIMIT)}`,
              },
            ],
          },
        ],
        text: {
          format: { type: 'json_schema', name: 'contexts', strict: true, schema: SCHEMA },
        },
      }),
    });

    if (!response.ok) return [];

    const body = (await response.json()) as {
      model?: string;
      usage?: Record<string, unknown>;
      output?: { content?: { type: string; text?: string }[] }[];
    };

    void recordSpend('contexts', body.model, body.usage);

    const raw = (body.output ?? [])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text ?? '')
      .join('');

    const parsed = JSON.parse(raw) as Record<string, unknown>;

    /*
     * The model proposes and code disposes. An id is kept only if it is a real
     * context *in the dimension it was offered for* — a time id returned under
     * `place` is a mistake, not a preference, and letting it through would put
     * "30 min" in the Where row where nothing would ever explain it.
     */
    return (['place', 'time', 'energy'] as const)
      .map((dimension) => {
        const proposed = parsed[dimension];
        if (typeof proposed !== 'string') return null;

        return groups[dimension].some((o) => o.id === proposed) ? proposed : null;
      })
      .filter((id): id is string => id !== null);
  } catch {
    // A missing suggestion is the state this feature replaced. It is fine.
    return [];
  }
}
