/**
 * The type a browser will actually accept for a media file.
 *
 * A file arrives typed by whatever produced it, and for audio that is a mess of
 * historical aliases: an iPhone voice memo comes through as `audio/x-m4a`, some
 * recorders say `audio/m4a`, older tools still emit `audio/x-wav`. They all
 * name formats every browser can play; they are simply not the names the
 * browser knows them by. `audio/m4a` in particular is one Chrome refuses
 * outright — `canPlayType` returns the empty string for it.
 *
 * Normalising on the way *out* rather than on the way in, deliberately. The
 * stored type is what the file said about itself and is worth keeping as a
 * record; what the browser is told is a separate question, asked once per
 * request by the one function that answers it. It also means the fix reaches
 * every file already in the app, rather than only the ones uploaded after it.
 *
 * Only aliases are rewritten. A type this does not recognise passes through
 * untouched, because guessing at an unknown type is how a PDF ends up being
 * offered as something it isn't.
 */
const ALIASES: Record<string, string> = {
  // AAC in an MP4 container, under all the names it has ever had.
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/aac': 'audio/mp4',
  'audio/x-aac': 'audio/mp4',
  'audio/mp4a-latm': 'audio/mp4',

  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',

  'audio/mpeg3': 'audio/mpeg',
  'audio/x-mpeg-3': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',

  'audio/x-ogg': 'audio/ogg',
  'audio/vorbis': 'audio/ogg',

  'video/x-m4v': 'video/mp4',
  'video/x-matroska': 'video/webm',
};

export function canonicalMediaType(mimeType: string | null): string | null {
  if (!mimeType) return mimeType;

  // Parameters are kept: `audio/webm;codecs=opus` tells the browser more than
  // `audio/webm` does, and only the type itself is ever wrong.
  const [type, ...rest] = mimeType.split(';');
  const canonical = ALIASES[type.trim().toLowerCase()];

  return canonical ? [canonical, ...rest].join(';') : mimeType;
}
