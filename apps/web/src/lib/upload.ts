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
