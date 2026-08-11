'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type PreviewFile = {
  id: string;
  name: string;
  mimeType: string | null;
  driveUrl: string | null;
};

type PreviewApi = {
  open: (file: PreviewFile) => void;
  close: () => void;
  /** So a pane can close itself when the file it's showing is detached. */
  closeIf: (id: string) => void;
  openId: string | null;
};

const Context = createContext<PreviewApi | null>(null);

/**
 * The fourth column.
 *
 * State lives in the shell rather than in a URL parameter: the pane belongs to
 * the window, not to the row you happened to open it from, and it should
 * survive clicking through to another project. A search param would also have
 * to be threaded through five separate pages that each own their own panes.
 */
export function FilePreviewProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<PreviewFile | null>(null);

  const api = useMemo<PreviewApi>(
    () => ({
      open: setFile,
      close: () => setFile(null),
      closeIf: (id) => setFile((f) => (f?.id === id ? null : f)),
      openId: file?.id ?? null,
    }),
    [file],
  );

  // The provider *is* the shell row, so the pane can be a flex sibling of the
  // other three rather than a floating overlay on top of them.
  return (
    <Context.Provider value={api}>
      <div className="flex h-screen w-screen">
        {children}
        {file ? <PreviewPane file={file} onClose={() => setFile(null)} /> : null}
      </div>
    </Context.Provider>
  );
}

export function useFilePreview(): PreviewApi {
  const api = useContext(Context);
  if (!api) throw new Error('useFilePreview outside FilePreviewProvider');
  return api;
}

function PreviewPane({
  file,
  onClose,
}: {
  file: PreviewFile;
  onClose: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = `/api/attachments/${file.id}/file`;
  const type = file.mimeType ?? '';

  return (
    <aside className="flex w-[32rem] shrink-0 flex-col border-l border-grey-200 bg-grey-50">
      <header className="flex items-center gap-2 border-b border-grey-200 px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-[12px] font-medium text-grey-800">
          {file.name}
        </h2>

        {file.driveUrl ? (
          <a
            href={file.driveUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            Drive ↗
          </a>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="shrink-0 px-1 text-[13px] leading-none text-grey-400 hover:text-grey-800"
        >
          ×
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-grey-100">
        {failed ? (
          <Unsupported file={file} src={src} reason="That file would not load." />
        ) : type.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element -- proxied bytes
          <img
            src={src}
            alt={file.name}
            onError={() => setFailed(true)}
            className="mx-auto block max-w-full p-3"
          />
        ) : type === 'application/pdf' || type.startsWith('text/') ? (
          // A PDF or plain text on our own origin: the browser's own viewer
          // handles both, and does it better than anything worth writing here.
          <iframe
            src={src}
            title={file.name}
            className="h-full w-full border-0 bg-paper"
          />
        ) : (
          <Unsupported
            file={file}
            src={src}
            reason={`No preview for ${type || 'this kind of file'}.`}
          />
        )}
      </div>
    </aside>
  );
}

function Unsupported({
  file,
  src,
  reason,
}: {
  file: PreviewFile;
  src: string;
  reason: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-[12px] text-grey-500">{reason}</p>
      <a
        href={src}
        download={file.name}
        className="text-[12px] text-grey-600 underline underline-offset-2"
      >
        Download it
      </a>
      {file.driveUrl ? (
        <a
          href={file.driveUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-grey-600 underline underline-offset-2"
        >
          Open in Drive ↗
        </a>
      ) : null}
    </div>
  );
}
