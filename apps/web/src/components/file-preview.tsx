'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { embedUrl, isGoogleNative } from '@/lib/google/sync';

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
  //
  // `data-preview` is on the row so the third pane can cap its own width while
  // the preview is open — see `CAPPED_BY_PREVIEW` in panes.tsx. Read as a group
  // rather than passed down: the pane in question is rendered by whichever page
  // is open, five segments away from here, and threading a boolean through all
  // of them to express "there is something to the right of you" is more wiring
  // than the fact deserves.
  return (
    <Context.Provider value={api}>
      <div
        data-preview={file ? 'open' : 'closed'}
        className="group/shell flex h-screen w-screen"
      >
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

/**
 * Takes the space that's left, rather than a width of its own.
 *
 * A file is the thing you opened the pane to look at, so it gets the room: the
 * detail pane caps itself at its readable measure and everything beyond that
 * goes here. That leaves the list pane as the only pane with a drag handle,
 * which is the only width there is a reason to choose — the other two are
 * determined by it and by the window.
 */
function PreviewPane({ file, onClose }: { file: PreviewFile; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/attachments/${file.id}/file`;
  const type = file.mimeType ?? '';

  return (
    <div className="flex min-w-0 flex-1 flex-col border-l border-grey-200 bg-grey-50">
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
          <ImageViewer src={src} alt={file.name} onFail={() => setFailed(true)} />
        ) : type.startsWith('audio/') ? (
          <MediaPlayer src={src} kind="audio" />
        ) : type.startsWith('video/') ? (
          <MediaPlayer src={src} kind="video" />
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
    </div>
  );
}

/**
 * Audio and video, played where they are.
 *
 * A voice note you cannot hear without leaving for Drive is barely attached to
 * anything. Nothing clever: the browser's own transport controls do the job,
 * and the proxy passes a Content-Length so the timeline is draggable.
 */
function MediaPlayer({ src, kind }: { src: string; kind: 'audio' | 'video' }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  /**
   * Fetched into a blob rather than pointed at the endpoint.
   *
   * A media element loads over its own path, separate from `fetch`, and it
   * negotiates ranges before it will admit to a duration — an easy thing to
   * get subtly wrong through a proxy, and hard to tell apart from a broken
   * file when it does. Handing it bytes it already has removes the
   * negotiation entirely: the clip either decodes or it doesn't. Nothing is
   * lost at a 4 MB ceiling, where progressive playback would save a moment at
   * most.
   */
  useEffect(() => {
    let url: string | null = null;
    let live = true;

    void (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(String(response.status));

        const blob = await response.blob();
        if (!live) return;

        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      } catch {
        if (live) setError(true);
      }
    })();

    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);

  if (error) {
    return (
      <p className="p-6 text-center text-[12px] text-grey-500">
        That file would not load.
      </p>
    );
  }

  if (!objectUrl) {
    return <p className="p-6 text-center text-[12px] text-grey-400">Loading…</p>;
  }

  if (kind === 'video') {
    return (
      <div className="flex h-full items-center justify-center bg-ink p-3">
        <video src={objectUrl} controls className="max-h-full max-w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <audio src={objectUrl} controls className="w-full max-w-md" />
      <p className="max-w-xs text-center text-[11px] leading-relaxed text-grey-500">
        Not transcribed — search can’t reach inside this yet.
      </p>
    </div>
  );
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 12;

type View = { zoom: number; x: number; y: number };

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * An image you can get close to.
 *
 * A photographed page or whiteboard is unreadable scaled to fit a side pane,
 * which is exactly the sort of thing this app expects you to attach. Wheel
 * zooms about the cursor rather than the centre, so you magnify the bit you
 * are pointing at; drag pans; double-click returns to fit.
 *
 * Zoom and offset are one piece of state updated in one pure function. They
 * were two, with the offset set from inside the zoom updater — which React is
 * free to call more than once, and does in development, so every notch
 * compounded the pan and the image shot off screen.
 *
 * The wheel listener is attached by hand because React's `onWheel` is passive,
 * and a passive handler cannot call `preventDefault` — without it every zoom
 * would scroll the pane as well.
 */
function ImageViewer({
  src,
  alt,
  onFail,
}: {
  src: string;
  alt: string;
  onFail: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  /** Centred, at the scale that shows the whole image, never enlarging it. */
  const fit = useCallback(() => {
    const frame = box.current?.getBoundingClientRect();
    if (!frame || !natural) return;

    const zoom = Math.min(
      1,
      (frame.width - 24) / natural.w,
      (frame.height - 24) / natural.h,
    );

    setView({
      zoom,
      x: (frame.width - natural.w * zoom) / 2,
      y: (frame.height - natural.h * zoom) / 2,
    });
  }, [natural]);

  // Fit on load, and again whenever the pane is resized under it.
  useEffect(() => {
    if (!natural) return;
    fit();

    const frame = box.current;
    if (!frame || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => fit());
    observer.observe(frame);
    return () => observer.disconnect();
  }, [natural, fit]);

  useEffect(() => {
    const frame = box.current;
    if (!frame) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = frame.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      setView((v) => {
        const zoom = clampZoom(v.zoom * Math.exp(-e.deltaY / 400));
        // Hold the point under the cursor still: whatever pixel of the image
        // sits there must sit there afterwards too.
        return {
          zoom,
          x: px - ((px - v.x) / v.zoom) * zoom,
          y: py - ((py - v.y) / v.zoom) * zoom,
        };
      });
    };

    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={box}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
      }}
      onPointerMove={(e) => {
        const from = drag.current;
        if (!from) return;
        setView((v) => ({
          ...v,
          x: from.ox + (e.clientX - from.x),
          y: from.oy + (e.clientY - from.y),
        }));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={fit}
      className="relative h-full w-full cursor-grab overflow-hidden bg-grey-200 active:cursor-grabbing"
      style={{ touchAction: 'none' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- proxied bytes */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) =>
          setNatural({
            w: e.currentTarget.naturalWidth,
            h: e.currentTarget.naturalHeight,
          })
        }
        onError={onFail}
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: '0 0',
        }}
        className="max-w-none select-none"
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-grey-900/70 px-2 py-1 text-[10px] text-paper">
        <span className="tabular-nums">{Math.round(view.zoom * 100)}%</span>
        <span>scroll to zoom · drag to pan · double-click to fit</span>
      </div>
    </div>
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
