import 'server-only';

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

export function canRead(mimeType: string | null): boolean {
  if (!mimeType) return false;
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
export function reader(): Reader | null {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new ClaudeReader(key) : null;
}
