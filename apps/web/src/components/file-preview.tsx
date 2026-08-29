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
import { reasonFor, useMediaBlob } from '@/lib/preview-media';
import { formatOf } from '@/lib/text-formats';
import { AudioTranscript } from './audio-transcript';
import { TextDocument } from './text-document';

export type PreviewFile = {
  id: string;
  name: string;
  mimeType: string | null;
  /**
   * Where our own copy of the bytes is served from. Passed in rather than
   * built from the id, because an attachment and a Big Box document are
   * different rows in different tables behind different routes, and the pane
   * has no business knowing which of them it is showing.
   */
  src: string;
  /** Needed for the Google editor embed, which addresses Drive directly. */
  driveFileId: string | null;
  driveUrl: string | null;
  /**
   * Where the typed transcript is read and written, for a recording.
   *
   * Passed in for the same reason `src` is, and it sits beside it on both
   * sides of the app: `…/file` is the bytes, `…/transcript` is the words about
   * them. Deriving one from the other would work today and would make the pane
   * responsible for a URL shape it does not own.
   *
   * Null means this source has nowhere to keep one. Nothing passes null yet —
   * both an attachment and a Big Box entry have a column for it — but a source
   * that doesn't should be able to say so without the pane offering an editor
   * that silently discards what you type into it.
   */
  transcriptUrl?: string | null;
  /**
   * A page to show, instead of bytes to fetch.
   *
   * The pane is the fourth column, and a file is only the commonest thing to
   * put in it. The Apps Script panel is the first that is not one: a page of
   * buttons for the two bridges, which belongs beside the app rather than in a
   * tab you have to come back from.
   *
   * Rendered in a frame with no sandbox, which is the opposite of what a `.html`
   * *file* gets — and deliberately. A file might be anything; this is one page,
   * from one origin the app checked before storing the address, and it needs
   * scripts to work at all: the buttons on it call back into Apps Script.
   */
  embedUrl?: string | null;
  /**
   * Something the app renders itself, rather than bytes or a page.
   *
   * The third kind. The pane exists to give one thing a tall column, and not
   * every such thing is a file — a project's Drive folder and Gmail label
   * arrive as a tree the app already has and can draw, with nothing to fetch
   * and nothing to embed. Handed over rendered, so the pane stays ignorant of
   * what it is showing, which is the same reason `src` is passed in rather than
   * built from the id.
   */
  node?: ReactNode;
};

type PreviewApi = {
  /** Open it and go to it — someone clicked a file. */
  open: (file: PreviewFile) => void;
  /**
   * Load it, but stay where you are.
   *
   * For the case where the file is not what you asked for but is what you are
   * probably about to want: selecting a document in a box has exactly one file
   * behind it, so there is nothing to choose and no reason to make you choose
   * it. Loading it means the swipe to reach it shows the document rather than
   * an empty pane that then starts fetching.
   *
   * The distinction is only about *where you are looking* — on a desktop both
   * behave the same, because the pane is already on screen either way.
   */
  preload: (file: PreviewFile | null) => void;
  close: () => void;
  /** So a pane can close itself when the file it's showing is detached. */
  closeIf: (id: string) => void;
  openId: string | null;
  /** The shell reads this to place the pane; callers use `openId`. */
  file: PreviewFile | null;
  /** Whether the pane was asked for, as against loaded ahead of time. */
  focused: boolean;
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
  const [state, setState] = useState<{ file: PreviewFile | null; focused: boolean }>({
    file: null,
    focused: false,
  });
  const { file, focused } = state;

  const api = useMemo<PreviewApi>(
    () => ({
      open: (next) => setState({ file: next, focused: true }),
      /*
       * Always unfocused, never inheriting. If it kept a focus already set,
       * then once you had opened one document every later selection would drag
       * the carousel to the preview again — turning a convenience into the
       * thing it was meant to avoid.
       */
      preload: (next) =>
        setState((s) => {
          if (next === null) {
            /*
             * Nothing to show, so show nothing — a selection with no file
             * must not leave the previous one's document sitting in the pane.
             * A note between two scans would otherwise read as belonging to
             * the scan beside it, which is worse than an empty pane.
             *
             * A file you opened deliberately is left alone: the pane belongs
             * to the window, and only the section change closes that.
             */
            return s.focused || s.file === null ? s : { file: null, focused: false };
          }
          return s.file?.id === next.id ? s : { file: next, focused: false };
        }),
      close: () => setState({ file: null, focused: false }),
      closeIf: (id) =>
        setState((s) => (s.file?.id === id ? { file: null, focused: false } : s)),
      openId: file?.id ?? null,
      file,
      focused,
    }),
    [file, focused],
  );

  /**
   * State only. The pane itself is rendered by the shell.
   *
   * This provider used to *be* the shell row and render the pane as its last
   * child, which was right while there was one layout. There are two now: on a
   * wide screen the panes sit side by side, and on a phone they are panels of a
   * swipe track — and in the second case the preview has to be a sibling of the
   * other panes in that track, not a child of a wrapper around them. Something
   * that knows about both layouts has to place it, and that is the shell.
   */
  return <Context.Provider value={api}>{children}</Context.Provider>;
}

/** The file currently open, for the shell to render as a pane. */
export function useOpenPreview(): PreviewFile | null {
  return useContext(Context)?.file ?? null;
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
/**
 * Whether this browser will render a PDF in a frame.
 *
 * Feature detection rather than asking what device this is. `pdfViewerEnabled`
 * is the browser's own statement about whether it has a built-in viewer, which
 * is the actual question — sniffing for Android would be guessing at the
 * answer from something correlated with it, and would be wrong for a desktop
 * browser with its viewer disabled and for whatever ships a viewer next year.
 *
 * Undefined in older browsers, which are treated as capable: that is what they
 * were doing before this existed, and the worst case is the placeholder they
 * would have shown anyway.
 */
function canRenderPdf(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.pdfViewerEnabled !== false;
}

export function PreviewPane({ file, onClose }: { file: PreviewFile; onClose: () => void }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = file.src;
  const type = file.mimeType ?? '';

  /*
   * Decided from the name as well as the type, because Drive types a `.md`
   * as whatever the browser said when it went up, which is often nothing
   * useful. Null for everything that is not editable text, which is most
   * files.
   */
  const textFormat = formatOf(file.mimeType, file.name);

  return (
    /*
     * `data-pane` marks this as the window onto a file rather than as app
     * chrome. Paper mode reads it to stop its grain at this edge — tinting a
     * PDF or a photograph would be the app colouring somebody's document,
     * which is a different thing from decorating its own furniture.
     */
    <div
      data-pane="preview"
      className="flex min-w-0 flex-1 flex-col border-l border-grey-200 bg-grey-50"
    >
      <header className="flex items-center gap-2 border-b border-grey-200 px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-[12px] font-medium text-grey-800">
          {file.name}
        </h2>

        {/*
          A frame is not always enough for a page that signs you in: a Google
          login redirect inside one is a blank rectangle with nothing to press.
          So the way out is always on the header, not offered only once it has
          already failed — by then there is nothing to click.
        */}
        {file.embedUrl ? (
          <a
            href={file.embedUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[11px] text-grey-500 underline underline-offset-2 hover:text-grey-800"
          >
            Open in a tab ↗
          </a>
        ) : null}

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
          <Unsupported file={file} src={src} reason={failed} />
        ) : file.node ? (
          // Ours to draw: no fetch, no frame, no failure mode of its own.
          file.node
        ) : file.embedUrl ? (
          /*
           * A page, not a file — so nothing is fetched and nothing is typed.
           *
           * No `sandbox`, unlike the frame a `.html` file gets. That one is
           * showing arbitrary bytes and must not be allowed to run them; this
           * is a page the app checked the origin of before storing it, and its
           * whole purpose is to run something when you press a button.
           */
          <iframe
            src={file.embedUrl}
            title={file.name}
            className="h-full w-full border-0 bg-paper"
          />
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
        ) : textFormat ? (
          /* key: the editor seeds its state from a fetch, so without it the
             pane would show the previous file's text under the new file's
             name — and then save it over the top. Every panel in this app
             that seeds state from a row needs this; one that seeds it from a
             *file* needs it more, because the mistake writes to Drive. */
          <TextDocument
            key={file.id}
            src={src}
            format={textFormat}
            name={file.name}
          />
        ) : type.startsWith('image/') ? (
          <ImageViewer src={src} alt={file.name} onFail={() => void reasonFor(src).then(setFailed)} />
        ) : type.startsWith('audio/') ? (
          /* key: the transcript seeds state from a fetch, so without it the
             pane would show the previous recording's words beside the new
             recording's audio — and then autosave them onto it. */
          <AudioTranscript
            key={file.id}
            src={src}
            transcriptUrl={file.transcriptUrl ?? null}
          />
        ) : type.startsWith('video/') ? (
          <MediaPlayer src={src} />
        ) : isJson(type) ? (
          <JsonView src={src} onFail={() => void reasonFor(src).then(setFailed)} />
        ) : type === 'application/pdf' && !canRenderPdf() && file.driveFileId ? (
          /**
           * A PDF where the browser has no PDF viewer — Android Chrome, most
           * of the time.
           *
           * It does not fail loudly. The iframe loads and paints Chrome's own
           * placeholder: a grey panel, the word "file", and an Open button
           * that leaves for another app. Which looks exactly like a preview
           * pane that is broken, and was.
           *
           * Drive renders the pages itself and serves them as images, so its
           * embed works where a native viewer does not exist. Asked for only
           * in that case, because our own proxy is otherwise better: it runs
           * off this app's session rather than whichever Google account the
           * browser happens to be signed into.
           */
          <iframe
            src={`https://drive.google.com/file/d/${file.driveFileId}/preview`}
            title={file.name}
            allow="autoplay"
            className="h-full w-full border-0 bg-paper"
          />
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
 * Video, played where it is.
 *
 * The browser's own transport controls do the job here, and the proxy passes a
 * Content-Length so the timeline is draggable. Audio used to share this and no
 * longer does: a recording is played to be *written down*, which needs a
 * transport the native control does not have, so it has a pane of its own.
 */
function MediaPlayer({ src }: { src: string }) {
  const { objectUrl, error } = useMediaBlob(src);

  if (error) {
    return <p className="p-6 text-center text-[12px] text-grey-500">{error}</p>;
  }

  if (!objectUrl) {
    return <p className="p-6 text-center text-[12px] text-grey-400">Loading…</p>;
  }

  return (
    <div className="flex h-full items-center justify-center bg-ink p-3">
      <video src={objectUrl} controls className="max-h-full max-w-full" />
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
