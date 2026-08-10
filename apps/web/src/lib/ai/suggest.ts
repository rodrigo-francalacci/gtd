import 'server-only';

import type { AiSuggestion } from '@gtd/db';

/**
 * The suggestion layer for the clarify screen.
 *
 * Two rules from the brief hold here regardless of implementation:
 * suggestions never overwrite the raw capture, and they never block. A
 * suggestion is a pre-filled guess the user accepts or overrides — nothing
 * files itself.
 */
export interface InboxSuggester {
  suggest(input: {
    rawText: string;
    projects: { id: string; title: string }[];
    contexts: { id: string; name: string }[];
  }): Promise<AiSuggestion | null>;
}

/** Strip punctuation and collapse whitespace, for loose comparison. */
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Words too common to be evidence of anything. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'at', 'my',
  'me', 'i', 'is', 'it', 'this', 'that', 'with', 'from', 'up', 'out', 'get',
  'new', 'all', 'about', 'call', 'buy', 'do', 'make', 'need',
]);

const meaningfulWords = (s: string) =>
  normalise(s)
    .split(' ')
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

/**
 * Local entity matching — no model, no API key, no network.
 *
 * Scores each project by how many of its distinctive title words appear in the
 * captured text. It is deliberately conservative: one incidental word match
 * isn't enough, because a wrong suggestion costs more attention than no
 * suggestion. Swapping in a real model means implementing `suggest` and
 * changing `suggester` below; no caller changes.
 */
export class LocalSuggester implements InboxSuggester {
  async suggest({
    rawText,
    projects,
    contexts,
  }: {
    rawText: string;
    projects: { id: string; title: string }[];
    contexts: { id: string; name: string }[];
  }): Promise<AiSuggestion | null> {
    const haystack = normalise(rawText);
    if (!haystack) return null;

    const words = new Set(haystack.split(' '));

    const scored = projects
      .map((p) => {
        const titleWords = meaningfulWords(p.title);
        if (titleWords.length === 0) return null;

        const hits = titleWords.filter((w) => words.has(w)).length;
        if (hits === 0) return null;

        // A whole-title mention beats any amount of scattered word overlap.
        const full = haystack.includes(normalise(p.title));
        return {
          id: p.id,
          score: full ? 100 : hits,
          // Share of the title that was mentioned. One word of a two-word
          // title ("kitchen" of "Renovate the kitchen") is good evidence;
          // one word of a five-word title is a coincidence.
          ratio: full ? 1 : hits / titleWords.length,
        };
      })
      .filter((x): x is { id: string; score: number; ratio: number } => x !== null)
      .sort((a, b) => b.score - a.score || b.ratio - a.ratio);

    const [best, runnerUp] = scored;

    // A tie is ambiguous, and a wrong suggestion costs more attention than
    // none at all — so say nothing rather than guess between two projects.
    const ambiguous =
      runnerUp !== undefined &&
      runnerUp.score === best?.score &&
      runnerUp.ratio === best.ratio;

    const projectId =
      best && !ambiguous && (best.score >= 100 || best.score >= 2 || best.ratio >= 0.5)
        ? best.id
        : undefined;

    const contextIds = contexts
      .filter((c) => words.has(normalise(c.name)))
      .map((c) => c.id);

    if (!projectId && contextIds.length === 0) return null;

    return {
      projectId,
      contextIds: contextIds.length > 0 ? contextIds : undefined,
      confidence: projectId && best.score >= 100 ? 0.9 : 0.5,
    };
  }
}

export const suggester: InboxSuggester = new LocalSuggester();
