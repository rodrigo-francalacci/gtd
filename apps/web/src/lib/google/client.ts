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

export type DriveFile = { id: string; name: string; parents?: string[]; trashed?: boolean };

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
      `${DRIVE}/files/${fileId}?fields=id,name,parents,trashed`,
    );
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return null;
    throw error;
  }
}

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
