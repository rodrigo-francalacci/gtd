import 'server-only';

import { getAccessToken } from '@/lib/auth/token';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }

  /** Worth trying again later: rate limits and Google's own 5xx. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new GoogleApiError(
      `${init?.method ?? 'GET'} ${url} failed: ${response.status} ${await response.text()}`,
      response.status,
    );
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

// --- Drive ----------------------------------------------------------------

export type DriveFile = {
  id: string;
  name: string;
  parents?: string[];
  trashed?: boolean;
  /** Strings: Drive returns 64-bit sizes as decimal strings, not numbers. */
  size?: string;
  mimeType?: string;
  /**
   * A short-lived signed URL to Drive's own rendering of the file — including
   * the first page of a PDF, which is what makes a scan recognisable in a
   * gallery. Expires within hours, so it is fetched fresh and proxied rather
   * than stored.
   */
  thumbnailLink?: string;
  hasThumbnail?: boolean;
};

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Escape a value for Drive's query language, which uses single quotes. */
function driveQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Find a folder by name under a parent, or create it.
 *
 * Idempotent on purpose: the sync worker may retry, and creating a second
 * "Projects" folder every time would be worse than doing nothing. Drive
 * happily allows duplicate names, so this has to be enforced here.
 */
export async function ensureFolder(
  name: string,
  parentId?: string,
): Promise<string> {
  const clauses = [
    `mimeType = ${driveQuote(FOLDER_MIME)}`,
    `name = ${driveQuote(name)}`,
    'trashed = false',
    parentId ? `${driveQuote(parentId)} in parents` : null,
  ].filter(Boolean);

  const search = await call<{ files: DriveFile[] }>(
    `${DRIVE}/files?q=${encodeURIComponent(clauses.join(' and '))}` +
      '&fields=files(id,name)&pageSize=1',
  );

  const existing = search.files?.[0];
  if (existing) return existing.id;

  const created = await call<DriveFile>(`${DRIVE}/files?fields=id`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });

  return created.id;
}

export async function getFile(fileId: string): Promise<DriveFile | null> {
  try {
    return await call<DriveFile>(
      `${DRIVE}/files/${fileId}?fields=id,name,parents,trashed,size,mimeType,thumbnailLink,hasThumbnail`,
    );
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Rename something the app made, so its Drive name follows the app's.
 *
 * `drive.file` covers this: the scope is per-file access to files the app
 * created, and creating one includes the right to rename it. Verified against
 * the real API before anything was built on the assumption — which is worth
 * saying, because the alternative under consideration was exporting a manifest
 * for an Apps Script to consume, and that would have been a second system
 * maintained forever to work around a permission the app already had.
 */
export async function renameFile(fileId: string, name: string): Promise<void> {
  await call(`${DRIVE}/files/${fileId}?fields=id`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

/** A folder is a file in Drive. Named separately so call sites read as what
    they mean. */
export const renameFolder = renameFile;

/** Move a file by swapping its parents — Drive has no "move" verb. */
export async function moveFile(fileId: string, newParentId: string): Promise<void> {
  const file = await getFile(fileId);
  if (!file) throw new GoogleApiError(`Drive file ${fileId} not found`, 404);

  const previous = (file.parents ?? []).join(',');
  if (file.parents?.length === 1 && file.parents[0] === newParentId) return;

  const params = new URLSearchParams({ addParents: newParentId, fields: 'id' });
  if (previous) params.set('removeParents', previous);

  await call(`${DRIVE}/files/${fileId}?${params}`, { method: 'PATCH', body: '{}' });
}

/**
 * Open a resumable upload and return the URL the *browser* will send bytes to.
 *
 * This is how a file larger than 4.5 MB reaches Drive at all: Vercel caps a
 * function's request body there, and the app has nowhere else to park bytes,
 * so anything bigger could never travel through us. Google hands back a
 * one-file, one-week session URL, and the browser PUTs straight to it — the
 * upload never touches our infrastructure and the ceiling becomes Drive's.
 *
 * The access token stays on this side. The session URL is the capability, and
 * it authorises exactly one upload of one file into one folder, which is a far
 * smaller thing to hand a page than an hour of Drive access.
 *
 * Verified against the real API before this was written: the cross-origin POST
 * is permitted and `Location` is readable from a browser. Drive allows this;
 * Cloud Storage, whose documented CORS failures say otherwise, is a different
 * service.
 */
export async function createResumableSession(
  name: string,
  mimeType: string,
  parentId: string,
  /**
   * Null when whatever will send the bytes is not a browser — the Apps Script
   * that feeds the Big Box, for one. The binding below is enforced by CORS,
   * which is a browser mechanism, so a server-to-server PUT carrying no Origin
   * is accepted whatever the session was opened with. Checked against the real
   * API before this parameter was allowed to be null.
   */
  origin: string | null,
): Promise<string> {
  const token = await getAccessToken();

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        // Declaring the type up front means Drive stores it even though the
        // bytes arrive later, from somewhere else.
        'X-Upload-Content-Type': mimeType || 'application/octet-stream',
        /**
         * The session is bound to whichever origin opened it, and only that
         * origin may PUT to it. This request comes from a server, which sends
         * no Origin of its own, so the browser's is forwarded — without it the
         * session works perfectly from curl and is refused by the page that
         * actually has the bytes. Cost me a confusing "Failed to fetch" after
         * a spike that worked, because the spike opened the session from the
         * browser and inherited the right origin by accident.
         */
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ name, parents: [parentId] }),
    },
  );

  const location = response.headers.get('Location');
  if (!response.ok || !location) {
    throw new GoogleApiError(
      `Drive refused to open an upload session (${response.status})`,
      response.status,
    );
  }

  return location;
}

/**
 * Upload bytes to Drive as a new file under `parentId`.
 *
 * Multipart rather than resumable: resumable pays for itself on large files
 * that might need to restart mid-flight, and the platform caps the request
 * body long before a file gets big enough to care.
 *
 * Not idempotent, unlike the rest of this module — re-running it creates a
 * second copy. That's why the upload happens in the request that has the
 * bytes rather than in the retrying worker.
 */
export async function uploadFile(
  name: string,
  mimeType: string,
  bytes: ArrayBuffer,
  parentId: string,
): Promise<DriveFile> {
  const token = await getAccessToken();
  const boundary = `gtd-${crypto.randomUUID()}`;

  const metadata = JSON.stringify({ name, parents: [parentId] });
  const head =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;

  const body = new Blob([head, bytes, tail]);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!response.ok) {
    throw new GoogleApiError(
      `upload of ${name} failed: ${response.status} ${await response.text()}`,
      response.status,
    );
  }

  return (await response.json()) as DriveFile;
}

/**
 * Create an empty Google Doc, Sheet or Slide deck.
 *
 * No bytes involved — a Docs-editor file is metadata plus whatever Google
 * stores behind it, so this is the one kind of file the app can make without
 * anything to upload. `drive.file` covers it, because the app created it.
 */
export async function createGoogleFile(
  name: string,
  mimeType: string,
  parentId: string,
): Promise<DriveFile> {
  return call<DriveFile>(`${DRIVE}/files?fields=id,name`, {
    method: 'POST',
    body: JSON.stringify({ name, mimeType, parents: [parentId] }),
  });
}

/**
 * Create a real file with real bytes, in one request.
 *
 * The counterpart to `createGoogleFile` for the formats that are not Google's:
 * a `.md`, a `.tex`, a `.html`. They are ordinary files with content, so unlike
 * a Docs-editor file there *is* something to upload — but it is a few hundred
 * bytes of starter text, not a scan, so the three-step resumable dance that
 * exists to keep large uploads out of our function would be pure ceremony here.
 * One multipart request creates the metadata and the content together.
 *
 * `multipart/related` with a hand-written boundary because that is the shape
 * Drive's upload endpoint takes and there is no SDK in this app to hide it.
 */
export async function createTextFile(
  name: string,
  mimeType: string,
  parentId: string,
  content: string,
): Promise<DriveFile> {
  const token = await getAccessToken();
  const boundary = `gtd-${crypto.randomUUID()}`;

  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify({ name, mimeType, parents: [parentId] })}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}; charset=UTF-8\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,mimeType',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!response.ok) {
    throw new GoogleApiError(
      `create ${mimeType} failed: ${response.status} ${await response.text()}`,
      response.status,
    );
  }

  return (await response.json()) as DriveFile;
}

/**
 * Replace a file's contents, leaving its id, name and place alone.
 *
 * What makes the preview pane an editor rather than a viewer. `drive.file` is
 * enough on its own: the scope covers files this app created, and creating
 * includes writing to them afterwards — the same reasoning that lets
 * `renameBoxFiles` retitle a scan.
 *
 * `PATCH` on the upload host with `uploadType=media` is the whole of it. There
 * is deliberately no revision handling: Drive keeps its own version history for
 * the file, which is a better record than anything this app would invent, and
 * is reachable from the Drive link every pane already carries.
 */
export async function updateFileContent(
  fileId: string,
  mimeType: string,
  content: string,
): Promise<DriveFile> {
  const token = await getAccessToken();

  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,size,mimeType`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `${mimeType}; charset=UTF-8`,
      },
      body: content,
    },
  );

  if (!response.ok) {
    throw new GoogleApiError(
      `update ${fileId} failed: ${response.status} ${await response.text()}`,
      response.status,
    );
  }

  return (await response.json()) as DriveFile;
}

/**
 * Export a Docs-editor file to a real format.
 *
 * `alt=media` refuses these outright — there is no binary to fetch — so
 * anything that wants their *contents* (the enrichment queue, mostly) has to
 * ask Google to render them first.
 */
export async function exportFile(
  fileId: string,
  mimeType: string,
): Promise<Response> {
  const token = await getAccessToken();

  return fetch(
    `${DRIVE}/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

/**
 * Fetch a file's content. Returns the raw response so the caller can stream it
 * straight through rather than buffering a whole PDF into memory to hand it
 * back out again.
 */
export async function downloadFile(
  fileId: string,
  range?: string | null,
): Promise<Response> {
  const token = await getAccessToken();

  return fetch(`${DRIVE}/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Drive honours byte ranges, and passing the browser's straight through
      // is what lets an <audio> element ask for the first few kilobytes,
      // decode a duration, and then seek. Without it the player asks for a
      // range, gets the whole file, and sits there stalled.
      ...(range ? { Range: range } : {}),
    },
  });
}

/**
 * Bin a file this app created. Drive's trash, not a permanent delete — the
 * app should never be able to destroy something of yours outright.
 */
export async function trashFile(fileId: string): Promise<void> {
  await call(`${DRIVE}/files/${fileId}?fields=id`, {
    method: 'PATCH',
    body: JSON.stringify({ trashed: true }),
  });
}

// --- Gmail ----------------------------------------------------------------

export type GmailLabel = { id: string; name: string };

export async function listLabels(): Promise<GmailLabel[]> {
  const result = await call<{ labels?: GmailLabel[] }>(`${GMAIL}/labels`);
  return result.labels ?? [];
}

/**
 * Ensure a label exists, creating every ancestor along the way.
 *
 * Gmail has no folders — nesting is purely a naming convention, and the API
 * creates exactly the name you give it. Asking for "Standby/Kitchen" when
 * "Standby" doesn't exist yields one flat label called "Standby/Kitchen"
 * rather than a child of a Standby parent, so each segment has to be created
 * in turn. Creating a label that already exists is a 409, hence the lookup.
 *
 * Returns the id of the leaf.
 */
export async function ensureLabel(name: string): Promise<string> {
  const byName = new Map((await listLabels()).map((label) => [label.name, label.id]));

  let path = '';
  let leafId = '';

  for (const segment of name.split('/')) {
    path = path ? `${path}/${segment}` : segment;

    const existing = byName.get(path);
    if (existing) {
      leafId = existing;
      continue;
    }

    const created = await call<GmailLabel>(`${GMAIL}/labels`, {
      method: 'POST',
      body: JSON.stringify({
        name: path,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }),
    });

    byName.set(path, created.id);
    leafId = created.id;
  }

  return leafId;
}

/** Renaming a label is how a project "moves" between Gmail containers. */
export async function renameLabel(labelId: string, name: string): Promise<void> {
  await call(`${GMAIL}/labels/${labelId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function getLabel(labelId: string): Promise<GmailLabel | null> {
  try {
    return await call<GmailLabel>(`${GMAIL}/labels/${labelId}`);
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return null;
    throw error;
  }
}
