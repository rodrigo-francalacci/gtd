/**
 * Whether what you just typed into a box is a request for an email.
 *
 * The composer already looks at a message before filing it — an address on its
 * own becomes a link rather than a note — and this is the same idea applied to
 * the four shapes that identify a message. Pure and free of `server-only`, so
 * the composer and the Chrome sidebar can both ask.
 *
 * The line is drawn at *unambiguous* shapes. A Gmail address, sixteen hex
 * characters, and an RFC822 `Message-ID` in angle brackets are none of them
 * things anybody types as a thought, so they are recognised on sight. A Gmail
 * *search* is not — `from:sam worktop` is unusual prose but "email Sam about
 * the worktop" is not — so a search has to say what it is with a prefix. The
 * cost of guessing wrong there is a note silently turned into a query, which is
 * a note you have lost.
 */
export function readEmailPaste(text: string): string | null {
  const body = text.trim();
  if (!body) return null;

  // An explicit search: `email: from:sam worktop`. Checked first, so a prefix
  // wrapped around any of the shapes below still means "search for this".
  // `[\s\S]` rather than `.` with the `s` flag, which this build target does
  // not allow — a search pasted over two lines should still be one search.
  const prefixed = /^e?mail:\s*([\s\S]+)$/i.exec(body);
  if (prefixed) return prefixed[1].trim();

  // Anything with whitespace in it after that is prose, not an identifier.
  if (/\s/.test(body)) {
    return /^https?:\/\/mail\.google\.com\//i.test(body) ? body : null;
  }

  if (/^https?:\/\/mail\.google\.com\//i.test(body)) return body;

  // A Gmail message or thread id. Sixteen hex characters is what the API uses
  // and what "Show original" puts in its URL.
  if (/^[0-9a-f]{16,}$/i.test(body)) return body;

  // An RFC822 Message-ID, also from "Show original".
  if (/^<[^\s>]+@[^\s>]+>$/.test(body)) return body;

  return null;
}
