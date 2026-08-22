'use client';

/**
 * Putting a file in a box, from a browser.
 *
 * Three steps, and the shape is the same one attachments use: our server opens
 * a resumable Drive session, the browser PUTs the bytes straight to Google, our
 * server records the row. The bytes never pass through the app's own function,
 * which is why a scan the size of a book can be filed at all — through it, the
 * 4.5 MB request-body cap would apply.
 *
 * Extracted here because there are now three callers — the box composer, the
 * phone, and the Chrome sidebar's own copy — and a three-step protocol
 * reimplemented per surface is three chances to get the order wrong and one
 * place to fix it when someone does. The sidebar keeps its own version only
 * because it cannot import from the app at all; these two share this.
 */

export class BoxUploadError extends Error {}

export type BoxUploadOptions = {
  /**
   * Date the entry is filed under. Omitted means now, which is right for
   * anything you are uploading as it happens; a backlog passes the file's own
   * date so it lands under the day it actually arrived.
   */
  capturedAt?: Date;
  /**
   * Ask for it to be read straight away rather than waiting for the cron,
   * which may only run daily. Fire-and-forget: failing here leaves the
   * document queued, which is fine.
   */
  readNow?: boolean;
  /**
   * When it stops being worth keeping, as `YYYY-MM-DD`. Omitted means forever,
   * which is the default and the point of a box.
   *
   * Decided here rather than only on the pane afterwards, because this is the
   * moment it is easy: you are looking at the receipt and you know it is worth
   * three months. Coming back to a thousand filed documents to decide the same
   * thing one at a time is the version nobody does.
   */
  expiresAt?: string | null;
};

export async function uploadToBox(
  boxId: string,
  file: File,
  options: BoxUploadOptions = {},
): Promise<string> {
  const opened = await fetch('/api/box/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      step: 'open',
      box: boxId,
      name: file.name,
      mimeType: file.type,
    }),
  });

  const session = (await opened.json()) as { uploadUrl?: string; error?: string };
  if (!session.uploadUrl) {
    throw new BoxUploadError(session.error ?? 'The app refused the upload.');
  }

  const put = await fetch(session.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });

  if (!put.ok) throw new BoxUploadError(`Drive refused the file (${put.status}).`);
  const uploaded = (await put.json()) as { id: string };

  const done = await fetch('/api/box/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      step: 'complete',
      box: boxId,
      driveFileId: uploaded.id,
      capturedAt: options.capturedAt?.toISOString(),
      expires: options.expiresAt ?? undefined,
    }),
  });

  const record = (await done.json()) as { id?: string; error?: string };
  if (!record.id) throw new BoxUploadError(record.error ?? 'Could not record it.');

  if (options.readNow) {
    void fetch('/api/box/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: record.id }),
    }).catch(() => {});
  }

  return record.id;
}
