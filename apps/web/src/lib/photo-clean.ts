import { PHOTO_EDGE } from './list-photo';

/**
 * Get a photograph of a page ready to be read, in the browser.
 *
 * Three things, and each was measured against the real sample rather than
 * assumed:
 *
 * **Smaller.** A phone photograph of a notepad was 4.9 MB, which a function's
 * 4.5 MB body cap refuses outright — and the reader looks at roughly 2048px
 * anyway, so the rest was upload time spent on detail nothing reads. Cleaned,
 * the same page is about 700 KB.
 *
 * **Grey.** Ink on paper is a brightness, not a colour, and the blue rules of
 * a notepad are noise competing with it.
 *
 * **Stretched.** The sample had a hard shadow across the lower half, and the
 * words in it were where the reader started inventing. Pulling the range out
 * between the 2nd and 98th percentile lifts writing out of a shadow without
 * blowing out the lit half of the page — a plain contrast multiplier does the
 * opposite, because it works from the middle rather than from the ends.
 *
 * Done here rather than on the server because the bytes are already here, and
 * because a page that never needed sending at full size never costs the phone
 * the upload. The same reason `imagesToPdf` builds its pages client-side.
 */
export async function cleanPageForReading(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    // A canvas we cannot draw on is not a reason to refuse the photo: the
    // original still reads, it is only bigger and dimmer.
    return file;
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;

  /* Rec. 601 luminance, which is what a grey of ink on paper should be: the
     eye weights green far above blue, and an unweighted average turns a blue
     ruled line into something as dark as pencil. */
  const grey = new Uint8ClampedArray(width * height);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    const value = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000;
    grey[p] = value;
    histogram[grey[p]] += 1;
  }

  const total = width * height;
  const at = (fraction: number) => {
    let seen = 0;
    for (let value = 0; value < 256; value += 1) {
      seen += histogram[value];
      if (seen >= total * fraction) return value;
    }
    return 255;
  };

  const low = at(0.02);
  const high = at(0.98);
  // A page that is already flat — or blank — is left alone rather than being
  // stretched into noise.
  const span = high - low > 16 ? high - low : 255;
  const floor = high - low > 16 ? low : 0;

  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    const value = Math.max(0, Math.min(255, ((grey[p] - floor) * 255) / span));
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
  }

  context.putImageData(image, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92),
  );

  return blob ?? file;
}
