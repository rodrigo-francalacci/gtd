/**
 * Making a recording play that the browser refuses outright.
 *
 * Some recorders write the decoder's own configuration into the media data as
 * if it were the first frame of audio, and then list it in the sample table as
 * a two-byte sample. It is not audio and cannot be decoded as audio. `ffmpeg`
 * and VLC shrug, log a line and carry on; Chrome hits it as the very first
 * thing it is asked to decode and abandons the entire file — `decodeAudioData`
 * throws `EncodingError`, an `<audio>` element fires `error`, and a
 * forty-five-second recording that is perfectly good from the second frame
 * onward becomes a file the app can only apologise for.
 *
 * Measured on two of the user's own uploads before this was written: every
 * frame from the first real one decoded, at four positions through each file,
 * and each whole file decoded the moment the leading sample was replaced. So
 * this is not a guess about what might be wrong with them.
 *
 * **The repair happens on the way to the speaker, never on the way to Drive.**
 * A stored file is what the user handed us and stays byte-for-byte that, the
 * same rule the raw capture follows. What is patched here is the copy already
 * sitting in the tab, and only for as long as it is being played.
 *
 * The condition to act is deliberately narrow enough to be a proof rather than
 * a heuristic: the first sample must be exactly as long as the decoder
 * configuration recorded in the `esds`, and byte-for-byte equal to it. Real
 * audio is never a copy of the configuration that describes it, so a good file
 * cannot match — and a file that does match is one the browser has already
 * refused.
 */

/** The tag MPEG-4's descriptor language gives each thing inside an `esds`. */
const ES_DESCRIPTOR = 0x03;
const DECODER_CONFIG = 0x04;
const DECODER_SPECIFIC_INFO = 0x05;

/** Boxes worth descending into on the way to the sample table. */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);

/** The boxes this needs to find, and where each one starts. */
type Found = Partial<Record<'stsd' | 'stsz' | 'stco' | 'co64', number>>;

function typeAt(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

/**
 * Walk the box tree, noting the first of each box we are looking for.
 *
 * Bounds are checked at every step rather than trusted: this parses a file that
 * arrived from outside, and the whole reason it is being parsed is that it is
 * already known to be malformed.
 */
function walk(bytes: Uint8Array, view: DataView, from: number, to: number, found: Found): void {
  let at = from;

  while (at + 8 <= to) {
    let size = view.getUint32(at);
    let head = 8;

    if (size === 1) {
      if (at + 16 > to) return;
      size = Number(view.getBigUint64(at + 8));
      head = 16;
    }

    // A zero size means "to the end of the enclosing box", and is legal.
    if (size === 0) size = to - at;
    if (size < head || at + size > to) return;

    const type = typeAt(bytes, at + 4);

    if (type === 'stsd' || type === 'stsz' || type === 'stco' || type === 'co64') {
      found[type] ??= at;
    }

    if (CONTAINERS.has(type)) walk(bytes, view, at + head, at + size, found);

    at += size;
  }
}

/**
 * The decoder configuration held inside an `esds`, if there is one.
 *
 * Descriptors nest and carry a variable-length size, so the two that contain
 * the one we want are stepped over by their fixed header rather than skipped
 * whole — the interesting bytes are *inside* them. Every optional field in the
 * `ES_Descriptor` is honoured, because a file that omits one and a file that
 * includes one differ by two bytes and would otherwise be read as if they were
 * the same shape.
 */
function decoderConfig(bytes: Uint8Array, esds: number, end: number): Uint8Array | null {
  // `esds` is a full box: eight bytes of header, four of version and flags.
  let at = esds + 12;

  while (at < end) {
    const tag = bytes[at++];

    let length = 0;
    for (let i = 0; i < 4 && at < end; i++) {
      const byte = bytes[at++];
      length = (length << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }

    if (tag === DECODER_SPECIFIC_INFO) {
      return at + length <= end ? bytes.subarray(at, at + length) : null;
    }

    if (tag === ES_DESCRIPTOR) {
      // ES_ID, then a byte of flags whose top three bits each add a field.
      const flags = bytes[at + 2];
      at += 3;
      if (flags & 0x80) at += 2; // depends on another stream
      if (flags & 0x40) at += 1 + bytes[at]; // a URL, length-prefixed
      if (flags & 0x20) at += 2; // an object-clock-reference stream
      continue;
    }

    if (tag === DECODER_CONFIG) {
      // Object type, stream type, buffer size, then two bitrates.
      at += 13;
      continue;
    }

    at += length;
  }

  return null;
}

/**
 * Replace a leading configuration-as-audio sample with a frame of silence.
 *
 * Returns a patched copy, or `null` when there is nothing wrong — in which case
 * the caller keeps the bytes it already has and nothing is copied.
 *
 * The replacement is an empty `raw_data_block`: three bits saying the block has
 * ended, and zeroes to the byte boundary. The decoder reads it as a valid frame
 * that happens to contain nothing, which is the honest answer — the sample never
 * held any audio to recover. It is written in place, so the sample table, every
 * chunk offset and the file's length are all still true.
 */
export function repairLeadingConfigFrame(source: ArrayBuffer): ArrayBuffer | null {
  const bytes = new Uint8Array(source);
  const view = new DataView(source);

  if (bytes.length < 16 || typeAt(bytes, 4) !== 'ftyp') return null;

  const found: Found = {};
  walk(bytes, view, 0, bytes.length, found);

  const { stsd, stsz } = found;
  if (stsd === undefined || stsz === undefined) return null;

  const stsdEnd = stsd + view.getUint32(stsd);
  if (stsdEnd > bytes.length) return null;

  // One sample description, and it has to be AAC — this defect belongs to a
  // particular encoder, and the proof below only means anything for an `esds`.
  if (view.getUint32(stsd + 12) !== 1) return null;
  if (typeAt(bytes, stsd + 20) !== 'mp4a') return null;

  /*
   * The `esds` is found by scanning the sample description rather than by
   * walking into it. An `mp4a` entry's own header has three possible lengths,
   * depending on a version field that predates MP4 itself, and getting that
   * wrong reads the child boxes from the wrong place; the box is a hundred
   * bytes, so looking for it is both cheaper and harder to get wrong.
   */
  let esds = -1;
  for (let at = stsd + 16; at + 4 <= stsdEnd; at++) {
    if (typeAt(bytes, at) === 'esds') {
      esds = at - 4;
      break;
    }
  }
  if (esds < 0) return null;

  const esdsEnd = esds + view.getUint32(esds);
  if (esdsEnd > stsdEnd) return null;

  const config = decoderConfig(bytes, esds, esdsEnd);
  if (!config || config.length === 0) return null;

  // A constant sample size means every frame is the same length, so none of
  // them is a short configuration frame.
  if (view.getUint32(stsz + 12) !== 0) return null;

  const count = view.getUint32(stsz + 16);
  if (count < 2) return null;

  const firstSize = view.getUint32(stsz + 20);
  if (firstSize !== config.length) return null;

  /*
   * Sample zero is the first sample of chunk one by definition, so the first
   * chunk offset is its offset and the sample-to-chunk table need not be read.
   */
  const first =
    found.co64 !== undefined
      ? Number(view.getBigUint64(found.co64 + 16))
      : found.stco !== undefined
        ? view.getUint32(found.stco + 16)
        : -1;

  if (first < 0 || first + firstSize > bytes.length) return null;

  // The proof: this sample *is* the configuration, not a recording of anything.
  for (let i = 0; i < firstSize; i++) {
    if (bytes[first + i] !== config[i]) return null;
  }

  const repaired = source.slice(0);
  const out = new Uint8Array(repaired);
  out.fill(0, first, first + firstSize);
  out[first] = 0xe0;

  return repaired;
}

/**
 * The same file, in a state the browser will play.
 *
 * Audio only: a video whose audio track carries this defect still shows its
 * picture, and reaching into a second track to fix the sound is a larger job
 * than the problem in front of us. Any failure here returns the original — a
 * repair that cannot be made must never cost the file that was already there.
 */
export async function playableAudio(blob: Blob): Promise<Blob> {
  if (!blob.type.startsWith('audio/')) return blob;

  try {
    const repaired = repairLeadingConfigFrame(await blob.arrayBuffer());
    return repaired ? new Blob([repaired], { type: blob.type }) : blob;
  } catch {
    return blob;
  }
}
