'use client';

/**
 * Several images, as one document.
 *
 * The case this exists for is a conversation screenshotted in pieces: six images
 * that are one thing, which as six attachments are six rows to open in order and
 * as one PDF are a document you scroll. The same is true of a letter photographed
 * page by page, or a receipt that needed two shots.
 *
 * **Built in the browser, not on the server.** The images are already here, and
 * the upload path already goes from here straight to Drive — so combining them
 * first means the one PDF rides that same path, rather than several megabytes of
 * image being posted through a function with a 4.5 MB body cap in order to come
 * back as something smaller.
 *
 * `pdf-lib` is imported on demand for the reason the markdown parser and the
 * maths converter are: it is a few hundred kilobytes wanted by one button, and
 * loading it with the page that merely *has* that button would put it in front
 * of every capture.
 */

/** What a browser will hand to `pdf-lib` without help. */
const NATIVE = new Set(['image/jpeg', 'image/jpg', 'image/png']);

/** Anything a browser can decode is fair game, not only what PDF understands. */
export function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * Re-encode through a canvas, for the formats PDF cannot hold.
 *
 * HEIC from a phone, WebP from a website, AVIF — a PDF can embed none of them,
 * and a browser can decode all of them. So the ones that need it are drawn once
 * and come out as JPEG; everything already in a usable format is embedded as it
 * is, because re-encoding a PNG screenshot through JPEG would soften every
 * letter in it for no reason.
 *
 * Quality 0.92: visually indistinguishable from the source at the sizes a phone
 * photographs at, and a fraction of the bytes of a lossless copy.
 */
async function asEmbeddable(file: File): Promise<{ bytes: ArrayBuffer; jpeg: boolean }> {
  if (NATIVE.has(file.type)) {
    return { bytes: await file.arrayBuffer(), jpeg: file.type !== 'image/png' };
  }

  const bitmap = await createImageBitmap(file);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser would not draw the image.');

    /*
     * White behind it, because a PNG's transparency becomes black when it is
     * flattened into JPEG — which turns a screenshot with rounded corners into
     * one with black ones.
     */
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );

    if (!blob) throw new Error('This browser would not encode the image.');
    return { bytes: await blob.arrayBuffer(), jpeg: true };
  } finally {
    bitmap.close();
  }
}

/**
 * The tallest a page may be.
 *
 * 14,400 units is 200 inches, which is the ceiling readers have agreed on since
 * Acrobat set it — past that a page is not merely large, it is refused. Only an
 * extreme aspect ratio can reach it once the width is fixed: at a common 1,600
 * points across, an image would have to be nine times taller than it is wide.
 */
const MAX_PAGE = 14_400;

/**
 * One PDF, one image per page, every page the same width.
 *
 * **Uniform width, and no letterboxing** — which are not in tension, though the
 * first version of this assumed they were. It gave each page the size of its own
 * image, on the reasoning that a common page would letterbox screenshots of
 * different shapes in different ways. That reasoning was about a common page
 * *size*; fixing only the width leaves the height free to follow the aspect
 * ratio, so nothing is boxed and nothing is cropped, and the column of pages
 * stops changing width as you scroll it.
 *
 * That change is the whole difference between a set of images and a document. A
 * reader shows every page at the same scale, so pages of different widths appear
 * at different sizes — a portrait screenshot beside a landscape one comes out
 * half the size, and scrolling through a conversation means the text keeps
 * changing size for no reason the reader can see.
 *
 * The width is the widest image's, so nothing is ever scaled up beyond what it
 * has pixels for and the sharpest picture in the set stays sharp.
 *
 * Order is the order they were staged, which is the order you chose them in —
 * and for a conversation in pieces that order is the whole meaning.
 */
export async function imagesToPdf(files: File[], name: string): Promise<File> {
  const { PDFDocument } = await import('pdf-lib');

  const pdf = await PDFDocument.create();
  pdf.setTitle(name.replace(/\.pdf$/i, ''));
  pdf.setCreator('GTD');

  /*
   * Embedded first, in one pass, because the width every page shares cannot be
   * known until every image has been measured. `embedJpg` and `embedPng` are
   * what report the true pixel size, so this is also the measuring.
   */
  const embedded = [];

  for (const file of files) {
    const { bytes, jpeg } = await asEmbeddable(file);
    embedded.push(jpeg ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes));
  }

  const width = Math.max(1, ...embedded.map((image) => image.width));

  for (const image of embedded) {
    const ratio = image.height / image.width;

    /*
     * A page taller than the ceiling is narrowed until it fits rather than
     * being cropped or squashed. It is the one case that breaks the uniform
     * width, and it only arises for something like a full-length screenshot of
     * a very long page — where a page of the same width would have to be
     * hundreds of inches tall, and no reader would open it at all.
     */
    const pageWidth = ratio * width > MAX_PAGE ? MAX_PAGE / ratio : width;
    const pageHeight = pageWidth * ratio;

    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  }

  const bytes = await pdf.save();

  return new File([new Uint8Array(bytes)], name, {
    type: 'application/pdf',
    // The moment it was made, which is what every other capture is dated by.
    lastModified: Date.now(),
  });
}

/**
 * What to call it.
 *
 * The date first, which is the convention every filename in this app already
 * follows — a folder of these sorts chronologically rather than by whatever the
 * first screenshot happened to be called.
 */
export function pdfNameFor(count: number, hint?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const what = hint?.trim() ? hint.trim().slice(0, 60) : `${count} images`;
  return `${today} ${what}.pdf`;
}
