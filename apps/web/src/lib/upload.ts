/**
 * The upload ceiling, in a module a Client Component may import.
 *
 * `google/attachments.ts` is `server-only` and enforces this on the way in,
 * but the capture box needs the same number to reject an oversized file before
 * it spends a minute sending it — so the constant lives here and both sides
 * read it, rather than the limit being written down twice.
 *
 * 4 MB because Vercel caps a serverless request body at 4.5, and the bytes
 * have to travel through the request: Drive is the only storage this app has,
 * so there is nowhere to park them for a worker to collect.
 */
export const MAX_UPLOAD_MB = 4;

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/**
 * The ceiling for a *direct* upload, where the browser sends bytes straight to
 * Drive and Vercel never sees them.
 *
 * Drive's own limit is 5 TB, so this is not a platform constraint — it is a
 * sanity rail. Something has gone wrong if a GTD attachment is half a
 * gigabyte, and finding that out after a twenty-minute upload on a phone
 * connection is worse than being told up front.
 */
export const MAX_DIRECT_UPLOAD_MB = 512;

export const MAX_DIRECT_UPLOAD_BYTES = MAX_DIRECT_UPLOAD_MB * 1024 * 1024;

/**
 * Shared by both upload routes. A list in one place beats the same array
 * written out twice and drifting when a fifth parent type appears.
 */
export const PARENT_TYPES = [
  'project',
  'action',
  'list_item',
  'inbox_item',
] as const satisfies readonly string[];
