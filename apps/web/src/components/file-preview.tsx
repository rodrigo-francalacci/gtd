'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { setPreviewPaneWidth } from '@/lib/actions';
import { embedUrl, isGoogleNative } from '@/lib/google/sync';
import {
  DEFAULT_PREVIEW_WIDTH,
  MAX_PREVIEW_WIDTH,
  MIN_PREVIEW_WIDTH,
} from '@/lib/pane';
import { ResizablePane } from './resizable-pane';

export type PreviewFile = {
  id: string;
  name: string;
  mimeType: string | null;
  /** Needed for the Google editor embed, which addresses Drive directly. */
  driveFileId: string | null;
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
export function FilePreviewProvider({
  children,
  initialWidth,
}: {
  children: ReactNode;
  /** Persisted pane width, resolved on the server so there's no flash. */
  initialWidth: number;
}) {
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
        {file ? (
          <PreviewPane
            file={file}
            width={initialWidth}
            onClose={() => setFile(null)}
          />
        ) : null}
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
  width,
  onClose,
}: {
  file: PreviewFile;
  width: number;
  onClose: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = `/api/attachments/${file.id}/file`;
  const type = file.mimeType ?? '';

  return (
    <ResizablePane
      initialWidth={width}
      defaultWidth={DEFAULT_PREVIEW_WIDTH}
      edge="left"
      min={MIN_PREVIEW_WIDTH}
      max={MAX_PREVIEW_WIDTH}
      label="Resize preview pane"
      onCommit={setPreviewPaneWidth}
      className="border-l border-grey-200 bg-grey-50"
    >
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
        ) : isGoogleNative(type) ? (
          // Straight to Google's own editor, not through our proxy — a Docs
          // file has no bytes to fetch, and embedding the editor is what makes
          // it editable here rather than merely readable. This runs off the
          // browser's Google session, so it shows whichever account is signed
          // in first.
          <iframe
            src={embedUrl(type, file.driveFileId ?? '')}
            title={file.name}
            className="h-full w-full border-0 bg-paper"
          />
        ) : type.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element -- proxied bytes
          <img
            src={src}
            alt={file.name}
            onError={() => setFailed(true)}
            className="mx-auto block max-w-full p-3"
          />
        ) : isJson(type) ? (
          <JsonView src={src} onFail={() => setFailed(true)} />
        ) : type === 'application/pdf' || isBrowserText(type) ? (
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
    </ResizablePane>
  );
}

function isJson(type: string): boolean {
  return type === 'application/json' || type.endsWith('+json');
}

/**
 * Types a browser will render as text from a URL. `application/xml` and
 * `application/javascript` are text in every sense except their top-level
 * type, and leaving them out sent perfectly readable files to the "no
 * preview" branch.
 */
function isBrowserText(type: string): boolean {
  return (
    type.startsWith('text/') ||
    type === 'application/xml' ||
    type === 'application/javascript' ||
    type === 'application/x-yaml'
  );
}

/**
 * JSON, indented.
 *
 * Worth the fetch rather than an iframe: a minified export is one enormous
 * line, and a browser shows it as exactly that. Falls back to the raw text if
 * it doesn't parse, because a file that claims to be JSON and isn't is
 * precisely when you want to look at it.
 */
function JsonView({ src, onFail }: { src: string; onFail: () => void }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const raw = await (await fetch(src)).text();
        if (!live) return;
        try {
          setText(JSON.stringify(JSON.parse(raw), null, 2));
        } catch {
          setText(raw);
        }
      } catch {
        if (live) onFail();
      }
    })();

    return () => {
      live = false;
    };
    // `src` identifies the file; onFail is stable enough for this lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  if (text === null) {
    return <p className="p-3 text-[12px] text-grey-400">Loading…</p>;
  }

  return (
    <pre className="whitespace-pre overflow-auto bg-paper p-3 font-mono text-[11px] leading-relaxed text-grey-800">
      {text}
    </pre>
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
