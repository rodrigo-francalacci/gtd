import 'server-only';

import { recordSpend } from './spend';

/**
 * A vocabulary proposed for a box, read off what is already filed in it.
 *
 * Every other model call here fills in a vocabulary somebody wrote: the
 * classifier is handed the box's categories and tags and picks from them, and
 * anything it invents is dropped. This asks the question one step up — *what
 * axes would sort this box* — which is the one that has to be answered before
 * any of that works, facing an empty tag panel and two hundred filed
 * documents.
 *
 * **It reads the stored titles and summaries, never the files.** That is the
 * same rule the emojify button follows and it is a cost decision with a large
 * number attached: a PDF bills as its extracted text *and* an image of every
 * page, so re-reading two hundred documents to propose a dozen words would
 * cost more than the readings that made them findable in the first place. The
 * titles and summaries are already there, already written by a model that did
 * look at the file, and they are what a person skimming the box would use.
 *
 * **One call for the whole box, and that is what makes the answer any good.**
 * A vocabulary is a statement about a *set* — that these forty things are all
 * receipts and those six are letters from the council — and a model shown one
 * entry at a time cannot make it. It is the emojify argument at a larger
 * scale: asked separately you get forty plausible words and no vocabulary.
 *
 * **Nothing it says is applied to a document.** The entries each proposal
 * names come back so the proposal can be *judged* — a word with nothing behind
 * it cannot be told from a good one — and the tagging itself stays where it
 * already was: your hand, or the classifier reading the file. This answers
 * "what are the axes here", which is the hard question and a reading of the
 * whole box; "is this one a receipt" is the easy one and has two answers
 * already.
 */

/** One entry as the model sees it: a short key and whatever the box calls it. */
export type SuggestEntry = { key: string; label: string };

/** A category already in the box, so the model can add to it rather than beside it. */
export type ExistingCategory = { name: string; tags: string[] };

export type RawSuggestion = {
  category: string;
  tag: string;
  why: string;
  entries: string[];
};

/**
 * The longest label worth sending.
 *
 * A title plus the opening of its summary is what a person skimming the box
 * reads; past that it is the document, and the document is the thing this is
 * deliberately not paying to look at.
 */
export const LABEL_LIMIT = 220;

/**
 * How many entries are read.
 *
 * Not a token limit — four hundred labels is around twenty thousand tokens,
 * which on the cheap model is a fraction of a penny. It is an *answer* limit:
 * past a few hundred entries the vocabulary stops changing, and the reply has
 * to carry a key for every entry each tag covers, which is the part that grows.
 * Newest first, because a box's recent half is the half whose vocabulary you
 * are still deciding.
 */
export const MAX_ENTRIES = 400;

/** As many proposals as anybody will work through in one sitting. */
export const MAX_SUGGESTIONS = 40;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'tag', 'why', 'entries'],
        properties: {
          category: {
            type: 'string',
            description:
              'The axis this tag sorts on — an existing category name where one ' +
              'fits, otherwise a new one. Two or three words at most.',
          },
          tag: {
            type: 'string',
            description: 'The value on that axis. A word or two, as it would read on a chip.',
          },
          why: {
            type: 'string',
            description:
              'What somebody would be looking for when they filter on this — the ' +
              'use, not the definition. Never restate the tag name: "these are ' +
              'receipts" says nothing that the word Receipt did not. Empty is ' +
              'better than a tautology.',
          },
          entries: {
            type: 'array',
            description:
              'The keys of the entries this tag belongs on, exactly as given. ' +
              'Only entries you are confident about.',
            items: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

/**
 * Raised when the API refused or answered unusably, so the reason can reach
 * the screen rather than being reported as a guess about the API key.
 */
export class TagSuggestError extends Error {}

/** One definition, so the request and any complaint about it name the same model. */
function modelName(): string {
  return process.env.BOX_MODEL ?? 'gpt-5.6-luna';
}

function apiMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

function instructions(
  boxName: string,
  boxInstruction: string | null,
  existing: ExistingCategory[],
): string {
  const lines = [
    `These are the entries filed in a personal archive box called "${boxName}".`,
    'Each line is a short key, a tab, and what the box calls that entry — a',
    'title, sometimes with the opening of a summary after it.',
    '',
    'Propose a set of tags that would make this box worth filtering: the axes',
    'these entries actually vary along, and the values on them. A category is',
    'the axis ("Vendor", "Document type", "Place"); a tag is one value on it',
    '("Tesco", "Receipt", "Swindon").',
    '',
    'What makes a good proposal here:',
    '',
    '- A tag has to earn its place by *dividing* the box. One that would go on',
    '  everything sorts nothing, and one that would go on a single entry is a',
    '  title, not a tag.',
    '- Prefer few axes with several values each over many axes with one value.',
    '- Use the words this box already uses. If the entries say "invoice", the',
    '  tag is Invoice, not "Financial document".',
    '- Every axis must be a real question about an entry — what kind of thing',
    '  it is, who it came from, where it happened, what it is about. Never',
    '  propose a catch-all like "Named entity", "Keyword", "Topic" or "Other":',
    '  those are not angles to look from, and their values always belong on a',
    '  real axis instead. If a value fits two axes, put it on the more specific',
    '  one and do not repeat it on the other.',
    '- Only list an entry under a tag when the line you were given actually',
    '  says so. Do not guess from what a document of that kind usually is.',
    '- A tag nothing belongs to is not worth proposing.',
    '',
    'Nothing you list is applied to anything. The entries under each tag are',
    'the *evidence* for proposing it — they are shown to the owner so they can',
    'see what the word would mean here before deciding whether to keep it. So',
    'list the ones you are sure of and leave out the ones you are not: a short,',
    'certain list makes a better case than a long, hopeful one.',
  ];

  if (boxInstruction?.trim()) {
    lines.push(
      '',
      'What the owner says this box is for — the axes that matter to them are',
      'more likely to be in here than in any general scheme:',
      boxInstruction.trim().slice(0, 1200),
    );
  }

  if (existing.length > 0) {
    lines.push(
      '',
      'The box already has these categories and tags. Add to them where',
      'something fits — reuse the category name exactly — and propose a new',
      'category only for an axis genuinely missing. Never propose a tag that is',
      'already there.',
      '',
      ...existing.map(
        (c) => `${c.name}: ${c.tags.length > 0 ? c.tags.join(', ') : '(no tags yet)'}`,
      ),
    );
  } else {
    lines.push(
      '',
      'This box has no tags at all yet, so this is the whole vocabulary. Three',
      'to five categories is usually the right size.',
    );
  }

  lines.push(
    '',
    'Return the entry keys exactly as they are given to you.',
    '',
  );

  return lines.join('\n');
}

/**
 * Ask for a vocabulary. Throws with a readable reason; never returns a lie.
 *
 * The keys going out are short (`e1`, `e2`) rather than uuids, and that is a
 * cost decision with a real saving behind it: a uuid is around eighteen tokens,
 * and a reply where thirty tags each name twenty entries would spend ten
 * thousand tokens on identifiers alone.
 *
 * It does **not** weaken the rule the emoji batch pays for — "matched back by
 * id, never by position". A short key is still an id: the model is given it,
 * echoes it, and anything that comes back unrecognised is dropped by the
 * caller. What that rule forbids is an array whose *order* carries the
 * meaning, which is a promise a model has no way to keep.
 */
export async function suggestTags(
  key: string,
  boxName: string,
  boxInstruction: string | null,
  existing: ExistingCategory[],
  entries: SuggestEntry[],
): Promise<RawSuggestion[]> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName(),
      /*
       * Room for the answer and, mostly, for the thinking.
       *
       * Reasoning tokens are spent out of this budget before a single visible
       * character appears — the trap that left the emoji batch's reply cut off
       * mid-string — and here they are the *dominant* term rather than an
       * overhead on top of the JSON. That one asks for a glyph per row and can
       * answer a row at a time; this asks what the axes of a whole box are,
       * which means holding two hundred titles at once and trying groupings.
       * Sized as the emoji batch was, sixteen entries overran it before the
       * answer started.
       *
       * So: eight thousand fixed, plus twenty-four a row. An unused allowance
       * costs nothing — billed for what is generated, never for what was
       * permitted — and the failure it prevents costs the whole call.
       */
      max_output_tokens: 8000 + entries.length * 24,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                instructions(boxName, boxInstruction, existing) +
                entries
                  .map((e) => `${e.key}\t${e.label.slice(0, LABEL_LIMIT)}`)
                  .join('\n'),
            },
          ],
        },
      ],
      text: {
        format: { type: 'json_schema', name: 'tag_suggestions', strict: true, schema: SCHEMA },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new TagSuggestError(
      `OpenAI refused the request (${response.status}) for model ` +
        `${modelName()}: ${apiMessage(detail)}`,
    );
  }

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

  // The receipt, never awaited and never allowed to throw: OpenAI will not say
  // what is left, so what this app spends is only knowable if it writes it down.
  void recordSpend('tag_suggest', body.model, body.usage);

  /*
   * Recognised before it is parsed, which is the lesson the emoji batch paid
   * for: a truncated reply is unparseable JSON, and the raw exception reaches
   * whoever pressed the button as a true statement about the wrong subject.
   */
  if (body.status === 'incomplete') {
    throw new TagSuggestError(
      `${modelName()} ran out of room before finishing (` +
        `${body.incomplete_details?.reason ?? 'no reason given'}). ` +
        'A box this size is more than one answer can carry; this is a bug ' +
        'rather than something you did.',
    );
  }

  const text = (body.output ?? [])
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('');

  if (!text) return [];

  let parsed: { suggestions?: RawSuggestion[] };

  try {
    parsed = JSON.parse(text) as { suggestions?: RawSuggestion[] };
  } catch {
    throw new TagSuggestError(
      `${modelName()} answered with something that is not JSON. ` +
        'This is a bug rather than something you did.',
    );
  }

  return Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
}
