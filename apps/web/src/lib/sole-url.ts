/**
 * The message, if the whole of it is one web address.
 *
 * Deliberately strict — the entire message, one token, http or https. "look at
 * https://…" is a thought that *happens to contain* a link, and treating that
 * as a bare link would throw the thought away and keep the citation.
 *
 * One definition, three callers: the desktop box composer, the phone, and
 * `/api/box/post` for the Chrome sidebar. It decides whether something becomes
 * a `link` entry that gets fetched and read or a `note` that is already
 * finished, so two copies disagreeing would mean the same pasted string
 * becoming different things depending on which surface you were holding.
 *
 * Pure and free of `server-only` for exactly that reason: the route needs it
 * on the server, the composers need it in the browser.
 */
export function soleUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}
