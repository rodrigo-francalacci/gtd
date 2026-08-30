'use client';

/**
 * What a picture says about itself, read before it goes up.
 *
 * Read in the browser rather than on the server, and this is the cheap side of
 * a real asymmetry: here the bytes are already in hand and the platform will
 * decode a JPEG or an MP4 for free, where a server would have to fetch the
 * whole file back out of Drive to learn how wide it is. A gallery of forty
 * photographs would be forty downloads to fill in a caption.
 *
 * Everything here is optional and everything is allowed to fail. A screenshot
 * has no camera date and no position; a video from a messaging app has had its
 * metadata stripped; a browser may decline to decode a format it has never
 * heard of. A gallery of files that admit nothing is still a gallery, so a
 * failure returns an empty answer rather than throwing.
 */

export type MediaFacts = {
  width?: number;
  height?: number;
  takenAt?: string;
  latitude?: number;
  longitude?: number;
};

/** How far into a file to look for the EXIF block before giving up. */
const EXIF_SCAN_BYTES = 256 * 1024;

/**
 * Dimensions, from whatever will decode it.
 *
 * `createImageBitmap` handles every still format the browser knows, including
 * the ones a canvas would need help with. Video has no equivalent, so a
 * detached element loads just far enough to report `videoWidth` — metadata
 * only, which is a few kilobytes rather than the film.
 */
async function measure(file: File): Promise<{ width: number; height: number } | null> {
  if (file.type.startsWith('image/')) {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      return null;
    }
  }

  if (!file.type.startsWith('video/')) return null;

  const url = URL.createObjectURL(file);

  try {
    return await new Promise<{ width: number; height: number } | null>((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;

      // A file the browser cannot decode never fires either event on some
      // platforms, so the wait is bounded rather than trusted.
      const done = setTimeout(() => resolve(null), 5000);

      video.onloadedmetadata = () => {
        clearTimeout(done);
        resolve({ width: video.videoWidth, height: video.videoHeight });
      };
      video.onerror = () => {
        clearTimeout(done);
        resolve(null);
      };

      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The two EXIF tags worth having, out of the several hundred there are.
 *
 * A full EXIF library is a hundred kilobytes and parses lens corrections and
 * colour profiles; what a gallery caption wants is when and where. So this
 * walks the IFD structure by hand for exactly two things and ignores the rest,
 * which is about sixty lines and no dependency.
 *
 * JPEG only. PNG and WebP can carry EXIF and rarely do, HEIC needs a different
 * container walk entirely, and the honest answer for all of them is the same
 * empty object a JPEG without a camera block returns.
 */
function readExif(buffer: ArrayBuffer): MediaFacts {
  const view = new DataView(buffer);
  const facts: MediaFacts = {};

  // SOI, then a chain of markers. APP1 is where EXIF lives.
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return facts;

  let offset = 2;
  let exif = -1;

  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;

    const marker = view.getUint8(offset + 1);
    const length = view.getUint16(offset + 2);

    if (marker === 0xe1) {
      // "Exif\0\0" then the TIFF header the offsets below are relative to.
      if (offset + 10 < view.byteLength && view.getUint32(offset + 4) === 0x45786966) {
        exif = offset + 10;
      }
      break;
    }

    // SOS: image data starts and there is no more metadata to find.
    if (marker === 0xda) break;
    offset += 2 + length;
  }

  if (exif < 0 || exif + 8 > view.byteLength) return facts;

  const little = view.getUint16(exif) === 0x4949;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);

  if (u16(exif + 2) !== 0x002a) return facts;

  /** One rational: numerator over denominator, as EXIF stores every angle. */
  const rational = (at: number) => {
    const denominator = u32(at + 4);
    return denominator === 0 ? 0 : u32(at) / denominator;
  };

  /** Walk one image file directory, handing each tag to the caller. */
  const walk = (start: number, onTag: (tag: number, type: number, at: number) => void) => {
    if (start + 2 > view.byteLength) return;

    const count = u16(start);

    for (let i = 0; i < count; i++) {
      const entry = start + 2 + i * 12;
      if (entry + 12 > view.byteLength) return;

      onTag(u16(entry), u16(entry + 2), entry + 8);
    }
  };

  let exifIfd = -1;
  let gpsIfd = -1;

  walk(exif + u32(exif + 4), (tag, _type, at) => {
    if (tag === 0x8769) exifIfd = exif + u32(at);
    if (tag === 0x8825) gpsIfd = exif + u32(at);
  });

  if (exifIfd > 0) {
    walk(exifIfd, (tag, _type, at) => {
      // DateTimeOriginal — "2026:08:30 14:22:07", which is not a date any
      // parser accepts until the first two colons become dashes.
      if (tag !== 0x9003) return;

      const start = exif + u32(at);
      if (start + 19 > view.byteLength) return;

      let text = '';
      for (let i = 0; i < 19; i++) text += String.fromCharCode(view.getUint8(start + i));

      const iso = text.replace(/^(\d{4}):(\d{2}):/, '$1-$2-').replace(' ', 'T');
      const when = new Date(iso);

      if (!Number.isNaN(when.getTime())) facts.takenAt = when.toISOString();
    });
  }

  if (gpsIfd > 0) {
    let latitude: number | null = null;
    let longitude: number | null = null;
    let north = true;
    let east = true;

    walk(gpsIfd, (tag, _type, at) => {
      // A reference is a single character: N, S, E or W.
      if (tag === 0x0001) north = String.fromCharCode(view.getUint8(at)) !== 'S';
      if (tag === 0x0003) east = String.fromCharCode(view.getUint8(at)) !== 'W';

      // Degrees, minutes and seconds, as three rationals elsewhere in the file.
      if (tag === 0x0002 || tag === 0x0004) {
        const start = exif + u32(at);
        if (start + 24 > view.byteLength) return;

        const degrees =
          rational(start) + rational(start + 8) / 60 + rational(start + 16) / 3600;

        if (tag === 0x0002) latitude = degrees;
        else longitude = degrees;
      }
    });

    if (latitude !== null && longitude !== null) {
      facts.latitude = (north ? 1 : -1) * latitude;
      facts.longitude = (east ? 1 : -1) * longitude;
    }
  }

  return facts;
}

/** Everything worth knowing about one file, as far as it will say. */
export async function mediaFacts(file: File): Promise<MediaFacts> {
  const facts: MediaFacts = {};

  const size = await measure(file);
  if (size && size.width > 0 && size.height > 0) {
    facts.width = size.width;
    facts.height = size.height;
  }

  if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
    try {
      // The head of the file only: EXIF lives in the first marker segment, and
      // reading a 12 MB photograph into memory to look at its first kilobyte
      // is what makes a forty-file gallery slow.
      const head = await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer();
      Object.assign(facts, readExif(head));
    } catch {
      // A file that will not read is a file with nothing to say about itself.
    }
  }

  return facts;
}
