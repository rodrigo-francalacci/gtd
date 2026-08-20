import 'server-only';

/**
 * Looking at what a pasted address actually is.
 *
 * Two answers matter. A Google Maps link is a place, and should become one —
 * the coordinates are in the address once the shortener has been followed, so
 * no maps API and no key is needed. Anything else is a page, and what makes it
 * worth keeping is the same thing that makes it worth sending: its title, a
 * sentence about it, and a picture.
 *
 * All of this happens in the worker, never in the request that posts the link.
 * The entry appears the moment you press Post; a server on the other side of
 * the world taking eight seconds is its problem, not yours.
 */

/** Hosts whose links are places rather than pages. */
const MAP_HOSTS = new Set([
  'maps.app.goo.gl',
  'maps.google.com',
  'www.google.com',
  'google.com',
  'goo.gl',
]);

export type ResolvedLink = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  /** Set when the address turned out to name a place. */
  lat?: number;
  lng?: number;
  /** The page's readable text, for the classifier and for search. */
  text: string | null;
};

export class UnreachableLink extends Error {}

/**
 * Refuse to fetch anything that isn't a public web address.
 *
 * A link that someone sent you is a link someone chose, and this app fetches
 * it from a server that sits inside a network with its own private addresses
 * — a cloud metadata endpoint among them. Blocking the literal cases is not a
 * complete defence against a hostile name, but it is the difference between
 * "needs DNS trickery" and "paste this and see".
 */
const PRIVATE_HOST =
  /^(localhost$|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?fd)/i;

export function isFetchableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return !PRIVATE_HOST.test(url.hostname);
}

export function isMapsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (!MAP_HOSTS.has(url.hostname)) return false;
    // google.com serves everything; only its /maps paths are places.
    if (url.hostname.endsWith('google.com')) return url.pathname.startsWith('/maps');
    return true;
  } catch {
    return false;
  }
}

/**
 * Coordinates out of a Maps URL.
 *
 * `!3d…!4d…` first: that pair is the *place's* position, where `@lat,lng` is
 * wherever the camera happened to be — usually the same spot, sometimes a
 * street away, and the difference is the whole point of saving a place.
 */
export function coordsFrom(url: string): { lat: number; lng: number } | null {
  const patterns = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|center|destination)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(url);
    if (!match) continue;

    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }

  return null;
}

/** The place name Maps puts in the path, which is nicer than a coordinate. */
export function placeNameFrom(url: string): string | null {
  const match = /\/maps\/place\/([^/@]+)/.exec(url);
  if (!match) return null;

  try {
    const name = decodeURIComponent(match[1]).replace(/\+/g, ' ').trim();
    return name || null;
  } catch {
    return null;
  }
}

/** Ten seconds, and eight megabytes. A page that wants more is not a page. */
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 8 * 1024 * 1024;

async function get(url: string): Promise<Response> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      // Some sites serve a stub to anything that doesn't look like a browser,
      // and a stub has no preview to read.
      'User-Agent':
        'Mozilla/5.0 (compatible; GTD-Box/1.0; +https://github.com/rodrigo-francalacci/gtd)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new UnreachableLink(`That link answered ${response.status}.`);
  }

  // The redirect chain may have ended somewhere we would never have gone.
  if (!isFetchableUrl(response.url || url)) {
    throw new UnreachableLink('That link redirected somewhere it should not.');
  }

  return response;
}

export async function resolveLink(raw: string): Promise<ResolvedLink> {
  if (!isFetchableUrl(raw)) {
    throw new UnreachableLink('That is not a web address this app will fetch.');
  }

  const response = await get(raw);
  const finalUrl = response.url || raw;

  // A place: the shortener has been followed and the coordinates are in the
  // address it landed on. Nothing needs reading.
  if (isMapsUrl(raw) || isMapsUrl(finalUrl)) {
    const coords = coordsFrom(finalUrl);
    if (coords) {
      return {
        url: finalUrl,
        title: placeNameFrom(finalUrl),
        description: null,
        imageUrl: null,
        text: null,
        ...coords,
      };
    }
  }

  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('html') && !type.includes('xml')) {
    // An image, a PDF, a feed. There is nothing to read for a preview, but the
    // link is still a perfectly good thing to keep.
    return { url: finalUrl, title: null, description: null, imageUrl: null, text: null };
  }

  const html = (await response.text()).slice(0, MAX_BYTES);

  return {
    url: finalUrl,
    title: meta(html, 'og:title') ?? titleTag(html),
    description: meta(html, 'og:description') ?? meta(html, 'description'),
    imageUrl: absolute(meta(html, 'og:image') ?? meta(html, 'twitter:image'), finalUrl),
    text: readable(html),
  };
}

/**
 * One meta tag, however it was written.
 *
 * `property` and `name` are both used in the wild, and the two attributes turn
 * up in either order, so the pattern allows for whatever comes between.
 */
function meta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    'i',
  );

  const tag = pattern.exec(html)?.[0];
  if (!tag) return null;

  const content = /content=["']([^"']*)["']/i.exec(tag)?.[1];
  return decodeEntities(content ?? '').trim() || null;
}

function titleTag(html: string): string | null {
  const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]).trim() || null : null;
}

/** A preview image is often given as a path, and a path is not an address. */
function absolute(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return isFetchableUrl(url.href) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The page as prose. Script and style go entirely — their contents are not
 * words — then tags, exactly as the enrichment reader does it, and for the
 * same reason: a search vector full of `div` and `href` matches everything.
 */
function readable(html: string): string | null {
  const text = html
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return decodeEntities(text).slice(0, 20_000) || null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'");
}
