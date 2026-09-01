import 'server-only';

import { recordSpend } from '@/lib/ai/spend';

import { isGoogleNative } from '@/lib/google/sync';

/**
 * Turning a file into text that search can reach.
 *
 * Two rules carried over from the capture side of the brief: the raw artefact
 * is never touched, and nothing here blocks a request. What comes back is a
 * layer beside the file, not a replacement for it.
 */
export interface Reader {
  /** Anything read by eye: a photographed page, a whiteboard, a PDF. */
  read(file: {
    name: string;
    mimeType: string;
    bytes: ArrayBuffer;
  }): Promise<string>;
}

/** What Claude accepts as an image block. HEIC is not on the list. */
const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/**
 * A gallery is a Drive *folder*, and a folder has no bytes to read.
 *
 * It matches `isGoogleNative` because every Google type does, which is how one
 * came to be queued: the worker then asked Drive to export a folder and got a
 * 403, over and over, for a row that could never succeed. The same shape of
 * mistake the rename sweeps made — "Google-native" is a family, and a folder is
 * the member of it that is not a document.
 */
const FOLDER = 'application/vnd.google-apps.folder';

export function canRead(mimeType: string | null): boolean {
  if (!mimeType) return false;
  if (mimeType === FOLDER) return false;

  return (
    IMAGE_TYPES.has(mimeType) ||
    mimeType === 'application/pdf' ||
    isGoogleNative(mimeType) ||
    isPlainText(mimeType)
  );
}

export class UnreadableFile extends Error {}

/**
 * Plain text needs no model: it is already the thing we want to store.
 *
 * JSON, XML and YAML are text in every sense but their top-level type, and
 * excluding them meant a captured export sat there unreadable for no reason.
 */
export function isPlainText(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType.endsWith('+json') ||
    mimeType === 'application/xml' ||
    mimeType === 'application/x-yaml'
  );
}

/**
 * The no-key reader. Handles text and nothing else, so a captured note is
 * searchable whether or not an API key is ever configured.
 */
export class TextReader implements Reader {
  async read({
    mimeType,
    bytes,
  }: {
    name: string;
    mimeType: string;
    bytes: ArrayBuffer;
  }): Promise<string> {
    if (!isPlainText(mimeType)) {
      throw new UnreadableFile(`Nothing configured here can read ${mimeType}.`);
    }

    const raw = new TextDecoder().decode(bytes);
    const text = mimeType.startsWith('text/html') ? stripMarkup(raw) : raw;

    return text.slice(0, 20_000).trim();
  }
}

/**
 * A saved web page is `text/*`, but indexing its markup would fill the search
 * vector with `div` and `href` and make every page match every other. Script
 * and style go entirely — their contents are not prose — then tags, then the
 * handful of entities that survive often enough to matter.
 */
function stripMarkup(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

const PROMPT = `Transcribe this file for a search index.

Rules:
- Write out every word of text you can see, verbatim, in reading order.
- If there is no text, or almost none, describe what is shown in one short
  sentence instead — enough that someone searching for the object would find it.
- Plain text only. No markdown, no headings, no commentary, no preamble, and
  no apologies for anything you cannot read. Just the content.`;

/**
 * Claude reads the file.
 *
 * Chosen over classical OCR because the things worth photographing here are
 * messy — a book spine at an angle, a whiteboard, a handwritten note — and a
 * literal text detector reads those badly or not at all. It also means a
 * photo of an object with no text on it still yields something searchable.
 */
export class ClaudeReader implements Reader {
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.ENRICH_MODEL ?? 'claude-sonnet-5',
  ) {}

  async read({
    name,
    mimeType,
    bytes,
  }: {
    name: string;
    mimeType: string;
    bytes: ArrayBuffer;
  }): Promise<string> {
    // Plain text needs no model at all. Sending it to one would be slower,
    // cost money, and paraphrase something we already have exactly.
    if (isPlainText(mimeType)) {
      return new TextReader().read({ name, mimeType, bytes });
    }

    if (!IMAGE_TYPES.has(mimeType) && mimeType !== 'application/pdf') {
      throw new UnreadableFile(`Nothing here can read ${mimeType}.`);
    }

    const source = {
      type: 'base64' as const,
      media_type: mimeType,
      data: Buffer.from(bytes).toString('base64'),
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: mimeType === 'application/pdf' ? 'document' : 'image',
                source,
              },
              { type: 'text', text: `${PROMPT}\n\nFilename: ${name}` },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`Claude ${response.status}: ${detail.slice(0, 400)}`);
      // A 4xx that isn't a rate limit means the request was wrong, and the
      // worker must not spend five attempts proving it again.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new UnreadableFile(error.message);
      }
      throw error;
    }

    const body = (await response.json()) as {
      content?: { type: string; text?: string }[];
    };

    return (body.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n')
      .trim();
  }
}

/**
 * Null when there's no key.
 *
 * The queue treats that as "don't claim work you can't do" rather than
 * "fail it": text jobs still run through `TextReader`, and everything needing
 * a model stays pending untouched, so adding a key later picks up every file
 * captured in the meantime instead of stranding them as failures.
 */
/**
 * The same reading, asked of OpenAI.
 *
 * The box classifier has always run on OpenAI and this queue on Anthropic, for
 * no better reason than the order they were written — and the cost of that was
 * not theoretical: with only a ChatGPT key set, every photograph and PDF ever
 * attached sat in the queue waiting for a key that was never coming, while the
 * page cheerfully said they were "waiting, not lost". They were both.
 *
 * `/v1/responses` with the file inline, which is the shape the rest of this app
 * already uses — one place to look when a model call misbehaves, and one
 * spend record to read.
 */
export class OpenAiReader implements Reader {
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.ENRICH_MODEL ??
      process.env.BOX_MODEL ??
      'gpt-5.4-mini',
  ) {}

  async read({
    name,
    mimeType,
    bytes,
  }: {
    name: string;
    mimeType: string;
    bytes: ArrayBuffer;
  }): Promise<string> {
    // Plain text needs no model at all, exactly as above.
    if (isPlainText(mimeType)) {
      return new TextReader().read({ name, mimeType, bytes });
    }

    if (!IMAGE_TYPES.has(mimeType) && mimeType !== 'application/pdf') {
      throw new UnreadableFile(`Nothing here can read ${mimeType}.`);
    }

    const data = Buffer.from(bytes).toString('base64');

    /*
     * A PDF goes as a file and an image as an image — the two are different
     * content parts, and sending a PDF as an image is the mistake that makes a
     * scan come back as a description of a grey rectangle.
     */
    const part =
      mimeType === 'application/pdf'
        ? {
            type: 'input_file',
            filename: name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`,
            file_data: `data:application/pdf;base64,${data}`,
          }
        : { type: 'input_image', image_url: `data:${mimeType};base64,${data}` };

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_output_tokens: 2048,
        input: [
          {
            role: 'user',
            content: [
              part,
              { type: 'input_text', text: PROMPT + '\n' + '\n' + 'Filename: ' + name },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`OpenAI ${response.status}: ${detail.slice(0, 400)}`);
      // A 4xx that is not a rate limit means the request was wrong, and the
      // worker must not spend five attempts proving it again.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new UnreadableFile(error.message);
      }
      throw error;
    }

    const body = (await response.json()) as {
      model?: string;
      usage?: Record<string, unknown>;
      output?: { content?: { type: string; text?: string }[] }[];
    };

    // Counted like every other call here, so one page answers "what is this
    // costing" for the whole app.
    void recordSpend('reading', body.model, body.usage);

    return (body.output ?? [])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim();
  }
}

/**
 * Null when there is no key at all.
 *
 * The queue treats that as "do not claim work you cannot do" rather than
 * "fail it": text still runs through `TextReader`, and anything needing a model
 * stays pending and untouched.
 *
 * OpenAI first, because that is the key this app is actually run with and the
 * one the box classifier already uses. Anthropic is still honoured if its key
 * is present — the reader was written for it and there is no reason to refuse
 * a key somebody has deliberately set.
 */
export function reader(): Reader | null {
  const openAi = process.env.CHATGPT_API_KEY ?? process.env.OPENAI_API_KEY;
  if (openAi) return new OpenAiReader(openAi);

  const anthropic = process.env.ANTHROPIC_API_KEY;
  return anthropic ? new ClaudeReader(anthropic) : null;
}
