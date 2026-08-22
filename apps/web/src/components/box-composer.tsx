'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { postBoxLink, postBoxLocation, postBoxNote } from '@/lib/actions';
import { uploadToBox } from '@/lib/box-upload';
import { soleUrl } from '@/lib/sole-url';
import { AudioRecorder } from './audio-recorder';
import { IconAudio, IconCamera, IconPaperclip, IconPlace } from './icons';

/**
 * Writing into a box.
 *
 * Modelled on a chat composer because a box is read like one: newest at the
 * top, grouped by day, a mixture of things you were sent and things you said.
 * A journal that needs a form filled in is a journal you stop keeping, so this
 * is a text field and three buttons, and Enter posts.
 *
 * The file path goes straight to Drive — session, PUT, complete — the same
 * three steps the bridge script uses, which is why a scan the size of a book
 * doesn't meet Vercel's 4.5 MB body cap on the way through.
 */
export function BoxComposer({ boxId }: { boxId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Whether an upload is dated by the file or by the moment it arrives.
   *
   * Arriving is the default, because that is what actually happened: you put
   * it in the box now, and the feed is the order things reached you. The
   * file's own date is the right answer for a backlog — a scan made in April
   * belongs under April — but it is the exception, and a browser only knows
   * the file's *modified* time anyway, which for anything edited or re-saved
   * is not when it was made.
   */
  const [useFileDate, setUseFileDate] = useState(false);
  const [recording, setRecording] = useState(false);
  const [over, setOver] = useState(false);

  const post = () => {
    const body = text.trim();
    if (!body) return;

    // Cleared immediately: the next thought must never queue behind the last
    // one being written. Same rule as the capture box.
    setText('');
    setError(null);

    /**
     * A message that is only an address is a link, and gets read as one.
     *
     * No separate button, because a link arrives the same way a thought does —
     * pasted. Anything with words around it stays a note: adding a sentence is
     * how you say "this is what I thought", and swallowing that into a page's
     * own summary would be the app deciding your remark was the less
     * interesting half.
     */
    const url = soleUrl(body);

    startTransition(async () => {
      if (url) await postBoxLink(boxId, url, '');
      else await postBoxNote(boxId, body);
      router.refresh();
    });
  };

  /**
   * Upload a file into the box, one at a time so the progress line means
   * something and a failure names the file it belongs to.
   */
  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0) return;

    setError(null);

    for (const [index, file] of list.entries()) {
      setBusy(list.length > 1 ? `${file.name} (${index + 1}/${list.length})` : file.name);

      try {
        await uploadToBox(boxId, file, {
          // Omitted unless asked for, and the row then defaults to now. A
          // recording is exempt: it was made a moment ago, and its
          // `lastModified` is that same moment, so the checkbox would be
          // deciding nothing while looking like it decided something.
          capturedAt:
            useFileDate && file.lastModified && !file.type.startsWith('audio/')
              ? new Date(file.lastModified)
              : undefined,
          readNow: true,
        });

        router.refresh();
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      }
    }

    setBusy(null);
  };

  /**
   * Where you are, from the browser.
   *
   * Asks each time rather than watching: a journal entry is a moment, and an
   * app holding a live position because you once pressed a pin is not a trade
   * anyone agreed to.
   */
  const addPlace = () => {
    if (!navigator.geolocation) {
      setError('This browser will not give a location.');
      return;
    }

    setBusy('finding you');
    setError(null);

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const body = text.trim();
        setText('');
        setBusy(null);

        startTransition(async () => {
          await postBoxLocation(boxId, coords.latitude, coords.longitude, body);
          router.refresh();
        });
      },
      (e) => {
        setBusy(null);
        setError(
          e.code === e.PERMISSION_DENIED
            ? 'Location is blocked for this site.'
            : 'Could not get a location.',
        );
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  return (
    <div
      onPaste={(e) => {
        // A screenshot or a photo off the clipboard is the fastest way in.
        // Only claim the event when it carries files, so pasted text still
        // lands in the field.
        const files = [...e.clipboardData.files];
        if (files.length === 0) return;
        e.preventDefault();
        void upload(files);
      }}
      /**
       * Dropping a file here uploads it.
       *
       * The placeholder said so before any of this existed, which made the
       * composer quietly lie: a dropped file was handed to the browser, which
       * navigated away from the app to display it. `preventDefault` on
       * *dragover* is what stops that — without it the drop event never
       * belongs to us at all, and the handler below is never reached.
       *
       * Only file drags are claimed. The app drags rows between lists with its
       * own MIME types, and those must go on bubbling to whatever they were
       * aimed at.
       */
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(e) => {
        // Moving between children fires dragleave too; only a real exit counts,
        // or the highlight flickers the whole way across.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(false);
        void upload(e.dataTransfer.files);
      }}
      className={[
        'border-b px-3 py-2',
        over
          ? 'border-selected bg-selected-bg ring-1 ring-inset ring-selected'
          : 'border-grey-200 bg-grey-50',
      ].join(' ')}
    >
      {/* Recorded, not uploaded — but it leaves here as a file and goes up the
          same path, so nothing downstream knows the difference. */}
      {recording ? (
        <AudioRecorder
          onDone={(file) => {
            setRecording(false);
            void upload([file]);
          }}
          onCancel={() => setRecording(false)}
        />
      ) : null}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter posts, Shift+Enter makes a paragraph — the chat convention,
          // and the one everybody's fingers already know.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            post();
          }
        }}
        rows={2}
        placeholder="Write something, or drop a file…"
        className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-grey-800 placeholder:text-grey-400 focus:outline-none"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          title="Add a file"
          aria-label="Add a file"
          className="rounded-sm p-1 text-grey-400 hover:text-grey-700"
        >
          <IconPaperclip />
        </button>

        <button
          type="button"
          onClick={() => camera.current?.click()}
          title="Take a photo"
          aria-label="Take a photo"
          className="rounded-sm p-1 text-grey-400 hover:text-grey-700"
        >
          <IconCamera />
        </button>

        <button
          type="button"
          onClick={() => setRecording(true)}
          disabled={recording}
          title="Record audio"
          aria-label="Record audio"
          className="rounded-sm p-1 text-grey-400 hover:text-grey-700 disabled:opacity-40"
        >
          <IconAudio />
        </button>

        <button
          type="button"
          onClick={addPlace}
          title="Add where you are"
          aria-label="Add where you are"
          className="rounded-sm p-1 text-grey-400 hover:text-grey-700"
        >
          <IconPlace />
        </button>

        <label
          className="flex shrink-0 items-center gap-1 text-[11px] text-grey-500"
          title="Otherwise it is dated now, when you added it"
        >
          <input
            type="checkbox"
            checked={useFileDate}
            onChange={(e) => setUseFileDate(e.target.checked)}
          />
          date from the file
        </label>

        {/*
          No lifetime picker here, and that is a decision rather than an
          omission. Five more chips in a row that already carries a date
          checkbox, four buttons and a status line make the composer look like
          a form — which is the one thing a composer must not be, since a
          journal that needs a form filled in is a journal you stop keeping.

          It stays on the phone's capture screen, where there is a screen's
          worth of room and where filing something with a known shelf life —
          a receipt, photographed on the way out of a shop — is what you are
          actually doing. Everywhere else it is one click on the document
          afterwards, on a pane with space to explain itself.
        */}
        <span className="min-w-0 flex-1 truncate text-[11px] text-grey-500">
          {error ? <span className="text-stale">{error}</span> : busy ? `${busy}…` : ''}
        </span>

        <button
          type="button"
          onClick={post}
          disabled={!text.trim()}
          className="rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper disabled:opacity-40"
        >
          Post
        </button>
      </div>

      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

