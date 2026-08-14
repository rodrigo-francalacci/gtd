/**
 * Sending a capture's files to Drive, visibly and in parallel.
 *
 * The first version did this in a plain sequential loop and cleared the field
 * as soon as the row was written. Five photos then took eleven seconds to
 * finish uploading behind a screen that already said "Captured" — so leaving
 * the page, which is the obvious thing to do once it looks done, silently
 * killed whatever was still queued. One photo of five arriving is not a rare
 * failure; it is what that design does whenever you believe it.
 *
 * Hence: bounded concurrency so the wait is short enough to sit through, and a
 * progress callback so the caller can keep the screen honest until it is
 * genuinely over.
 */

import { UploadError, uploadToDrive } from './drive-upload';

export type UploadFailure = { file: File; message: string };

/**
 * Three at once. Enough to cut the wait to roughly a third, without opening
 * six connections to Drive on a phone's connection and making every one of
 * them slower.
 */
const CONCURRENCY = 3;

export async function uploadCaptureFiles(
  parentId: string,
  files: File[],
  onProgress: (finished: number, total: number) => void,
): Promise<UploadFailure[]> {
  const failures: UploadFailure[] = [];
  let finished = 0;
  let next = 0;

  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= files.length) return;

      const file = files[index];

      try {
        // Straight to Drive. Going through our own function would put the file
        // back under Vercel's 4.5 MB body cap, which is the ceiling a phone
        // photo regularly exceeds.
        await uploadToDrive({ parentType: 'inbox_item', parentId }, file);
      } catch (error) {
        // `UploadError` already says something specific and true. Anything
        // else is a dropped connection or the tab being torn down mid-flight.
        // Either way the file stays with the caller so it can be sent again,
        // rather than vanishing with no record that it was ever chosen.
        failures.push({
          file,
          message:
            error instanceof UploadError
              ? error.message
              : `${file.name} did not upload.`,
        });
      } finally {
        finished += 1;
        onProgress(finished, files.length);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker),
  );

  return failures;
}
