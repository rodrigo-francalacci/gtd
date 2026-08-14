/**
 * Uploading a file from the browser straight to Drive.
 *
 * Three steps: ask our server to open a session, PUT the bytes to the URL it
 * returns, then tell our server what landed. The bytes never pass through
 * Vercel, so the 4.5 MB request-body cap simply does not apply and the real
 * ceiling becomes Drive's.
 *
 * The access token stays on the server. What reaches the page is a session URL
 * that authorises exactly one upload of one file into one folder.
 */

import { MAX_DIRECT_UPLOAD_BYTES, MAX_DIRECT_UPLOAD_MB } from './upload';

export class UploadError extends Error {}

export type UploadTarget = {
  parentType: 'project' | 'action' | 'list_item' | 'inbox_item';
  parentId: string;
};

/**
 * `XMLHttpRequest`, not `fetch`, for one reason: it reports *upload* progress.
 * `fetch` still cannot, and a 20 MB file over a phone connection without a
 * progress bar is indistinguishable from one that has silently stalled — which
 * is the failure this whole path exists to stop repeating.
 */
function put(
  url: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader(
      'Content-Type',
      file.type || 'application/octet-stream',
    );

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    };

    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new UploadError(`Drive rejected the upload (${request.status}).`));
        return;
      }

      // The completed PUT answers with the file's JSON. This is the only place
      // the new id appears — the session URL does not contain it.
      try {
        const { id } = JSON.parse(request.responseText) as { id?: string };
        if (!id) throw new Error('no id');
        resolve(id);
      } catch {
        reject(new UploadError('Drive accepted the file but returned no id.'));
      }
    };

    request.onerror = () =>
      reject(new UploadError('The connection dropped during the upload.'));
    request.onabort = () => reject(new UploadError('The upload was cancelled.'));

    request.send(file);
  });
}

export async function uploadToDrive(
  target: UploadTarget,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ id: string; name: string }> {
  if (file.size === 0) throw new UploadError(`${file.name} is empty.`);
  if (file.size > MAX_DIRECT_UPLOAD_BYTES) {
    throw new UploadError(
      `${file.name} is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is ` +
        `${MAX_DIRECT_UPLOAD_MB} MB.`,
    );
  }

  const session = await fetch('/api/attachments/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...target,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
    }),
  });

  if (!session.ok) {
    const { error } = await session.json().catch(() => ({}));
    throw new UploadError(error ?? `Could not start uploading ${file.name}.`);
  }

  const { uploadUrl } = (await session.json()) as { uploadUrl: string };

  const driveFileId = await put(uploadUrl, file, onProgress);

  // The file is in Drive at this point. If recording it fails the bytes are
  // not lost — they are in the folder, just unknown to the app — so the
  // message says something true rather than implying nothing happened.
  const done = await fetch('/api/attachments/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...target, driveFileId }),
  });

  if (!done.ok) {
    const { error } = await done.json().catch(() => ({}));
    throw new UploadError(
      error ?? `${file.name} reached Drive but could not be recorded.`,
    );
  }

  return (await done.json()) as { id: string; name: string };
}
