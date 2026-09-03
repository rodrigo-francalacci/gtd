'use client';

import { useRouter } from 'next/navigation';
import { emojifyLater } from '@/lib/emojify-later';
import { useRef, useState, useTransition } from 'react';
import {
  createBoxFile,
  createBoxGallery,
  postBoxLink,
  postBoxLocation,
  postBoxNote,
  requestEmail,
} from '@/lib/actions';
import { uploadToBox } from '@/lib/box-upload';
import { uploadToDrive } from '@/lib/drive-upload';
import { readEmailPaste } from '@/lib/email-paste';
import { imagesToPdf, isImage, pdfNameFor } from '@/lib/images-to-pdf';
import { mediaFacts } from '@/lib/media-facts';

import { driveFileUrl } from '@/lib/google/sync';
import { soleUrl } from '@/lib/sole-url';
import { AudioRecorder } from './audio-recorder';
import { useFilePreview } from './file-preview';
import { GalleryView } from './gallery-view';
import { IconAudio, IconCamera, IconPaperclip, IconPlace } from './icons';
import { NewDocumentMenu } from './new-document-menu';

/**
 * What can go in a gallery: pictures, and film.
 *
 * Wider than what can be combined into a PDF, which is images only — a video
 * has no page — so a set with a film in it is offered the gallery and not the
 * PDF.
 */
const isGalleryable = (file: File) =>
  file.type.startsWith('image/') || file.type.startsWith('video/');

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
  const preview = useFilePreview();

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
  /**
   * Images held back while the composer asks whether they are one thing.
   *
   * The composer's whole argument is that anything it makes you fill in is a
   * reason to stop keeping the journal, so this is not a staging tray you have
   * to clear — it appears only when several images arrive *together*, which is
   * the only moment the question means anything, and it has no third answer
   * that loses the files. One image, or a mixture of kinds, never sees it.
   */
  const [offer, setOffer] = useState<File[] | null>(null);
  const [recording, setRecording] = useState(false);
  const [creating, setCreating] = useState(false);
  const [over, setOver] = useState(false);

  /**
   * A new document, filed here and opened straight away.
   *
   * Opened rather than merely created, for the reason the attachments pane
   * gives: making a document and then leaving you to go and find it in the feed
   * you are already looking at would be a strange way round. Which editor
   * appears is the file's business — Google's formats embed Google's, and
   * markdown, LaTeX and HTML get the preview pane's own.
   */
  const create = async (mimeType: string, label: string) => {
    setError(null);
    setCreating(true);

    try {
      const row = await createBoxFile(
        boxId,
        mimeType,
        `${label} — ${new Date().toLocaleDateString('en-GB')}`,
      );

      preview.open({
        id: row.id,
        name: row.name,
        src: `/api/box/${row.id}/file`,
        transcriptUrl: `/api/box/${row.id}/transcript`,
        mimeType: row.mimeType,
        driveFileId: row.driveFileId,
        driveUrl: driveFileUrl(row.driveFileId),
      });

      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make that document.');
    } finally {
      setCreating(false);
    }
  };

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
      /**
       * A pasted Gmail address is a request for the message, not a link to a
       * page.
       *
       * Filing it as a link would produce an entry whose picture and summary
       * come from Gmail’s sign-in page, because that is what anything without
       * your cookies sees when it follows one — a box full of identical
       * entries called "Gmail". What you meant was the message, and the bridge
       * is what can fetch it.
       *
       * Four shapes count: a Gmail address, a message id, an RFC822
       * `Message-ID`, and anything after an `email:` prefix. The first three
       * are unambiguous enough to recognise on sight; a *search* is not, so
       * it has to announce itself — the cost of guessing wrong there is a
       * note silently turned into a query, which is a note you have lost.
       *
       * Decided in `readEmailPaste` rather than in `soleUrl`, which answers a
       * narrower question — is this text nothing but an address — and is
       * shared with the Chrome extension.
       */
      const wanted = readEmailPaste(body);

      if (wanted) {
        const asked = await requestEmail(boxId, wanted);
        if (!asked.ok) {
          setError(asked.error);
          // Put it back: the message was not filed and the address is the one
          // thing you would have to go and find again.
          setText(body);
          return;
        }
      } else if (url) {
        await postBoxLink(boxId, url, '');
      } else {
        /* Same again: the note is in the box, and the emoji catches up. */
        emojifyLater('box', await postBoxNote(boxId, body));
      }

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
   * What to do with files as they arrive.
   *
   * Every route into the composer — the paperclip, the camera, a paste, a drop
   * — comes through here, so the question is asked once rather than four times.
   * Several images at once is the one case worth pausing on: a conversation
   * screenshotted in pieces, or a letter photographed page by page, is one
   * document that would otherwise arrive as six rows to open in order.
   *
   * Anything else goes straight up, exactly as it did before. Asking about a
   * single file, or about a PDF and a photograph, would be a form.
   */
  const receive = (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0) return;

    if (list.length > 1 && list.every(isGalleryable)) {
      setError(null);
      setOffer(list);
      return;
    }

    void upload(list);
  };

  /**
   * The answer: a gallery.
   *
   * One entry in the feed for the whole set, backed by a folder in the box's
   * own Drive folder. The row is made first and the pictures go into it one at
   * a time — the container that can be found again exists before the bytes
   * that would otherwise be lost.
   *
   * Whatever is in the composer names it, exactly as it names a combined PDF:
   * the sentence you were about to post is almost always what the pictures are
   * of.
   */
  const makeGallery = async () => {
    const list = offer;
    if (!list) return;

    setOffer(null);
    setError(null);
    setBusy(`Making a gallery of ${list.length}`);

    const title =
      text.trim() || `${new Date().toISOString().slice(0, 10)} ${list.length} pictures`;

    const made = await createBoxGallery(boxId, title);

    if ('error' in made) {
      setError(made.error);
      setBusy(null);
      setOffer(list);
      return;
    }

    for (const [index, file] of list.entries()) {
      setBusy(`${file.name} (${index + 1}/${list.length})`);

      try {
        await uploadToDrive(
          { parentType: 'gallery', parentId: made.id },
          file,
          undefined,
          await mediaFacts(file),
        );
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      }
    }

    setText('');
    setBusy(null);

    /*
     * And an emoji, like every other entry that arrives.
     *
     * It was missed the first time round because a gallery is written `ready`
     * rather than queued — nothing reads it, so it never passed the point where
     * a document picks one up. The title is what it is chosen from, which is
     * the right question here anyway: the model cannot see the pictures, and
     * "survey photographs" is what the row is about.
     */
    emojifyLater('box', made.id);

    /*
     * Opened once the pictures are in it, for the reason a new document is
     * opened: making a thing and then leaving you to find it in the feed you
     * are already looking at is a strange way round. It also settles the
     * timing — a pane opened while the uploads were still going would have
     * counted the pictures that had arrived by then and stopped there.
     */
    preview.open({
      id: made.id,
      name: title,
      src: `/api/box/${made.id}/file`,
      transcriptUrl: null,
      mimeType: 'application/vnd.google-apps.folder',
      driveFileId: null,
      driveUrl: null,
      node: <GalleryView galleryId={made.id} name={title} />,
    });

    router.refresh();
  };

  /**
   * The answer: one document.
   *
   * Built here in the browser and then handed to the ordinary upload path, so
   * the one PDF rides the same session/PUT/complete route every other file does
   * and nothing downstream knows it was made rather than chosen.
   *
   * Whatever is in the text field names it. A box of scans called "3 images" is
   * a box you search by opening things, and the sentence you were about to post
   * is almost always what the pictures are of.
   */
  const combine = async () => {
    const list = offer;
    if (!list) return;

    setOffer(null);
    setError(null);
    setBusy(`Combining ${list.length} images`);

    try {
      const pdf = await imagesToPdf(list, pdfNameFor(list.length, text.trim()));
      await upload([pdf]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those images would not combine.');
      setBusy(null);
      // Put them back rather than dropping them: a failure here must not be the
      // difference between having the pictures and not.
      setOffer(list);
    }
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
        receive(files);
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
        receive(e.dataTransfer.files);
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

      {/*
        The question, asked only when it has an answer worth giving. Both
        buttons act; there is no dismiss, because dismissing would leave the
        images nowhere and the composer looking as though it had taken them.
      */}
      {offer ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-sm border border-grey-200 bg-paper px-2 py-1.5 text-[11px] text-grey-600">
          {/*
            The count and nothing else. A composer pane is barely wider than
            the two buttons, and a sentence asking the question was truncated
            to "3 images — one document…" — which is the half that says least.
            The buttons are the question; both of them read as answers on their
            own.
          */}
          <span className="min-w-0 flex-1 truncate">{offer.length} files</span>

          <button
            type="button"
            onClick={() => void makeGallery()}
            className="shrink-0 rounded-sm bg-grey-800 px-2 py-1 text-[11px] text-paper"
          >
            Make a gallery
          </button>

          {/* Only where a PDF is possible: a page can hold a picture and
              cannot hold a film. */}
          {offer.every(isImage) ? (
            <button
              type="button"
              onClick={() => void combine()}
              className="shrink-0 rounded-sm border border-grey-300 px-2 py-1 text-[11px] text-grey-700 hover:bg-grey-200"
            >
              One PDF
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              const list = offer;
              setOffer(null);
              void upload(list);
            }}
            className="shrink-0 rounded-sm px-2 py-1 text-[11px] text-grey-600 underline hover:text-grey-800"
          >
            Keep separate
          </button>
        </div>
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
        placeholder="Write something, paste a link, drop a file…"
        className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-grey-800 placeholder:text-grey-500 focus:outline-none"
      />

      {/*
        Wraps rather than spills.

        These controls were laid out in one row with the date checkbox marked
        `shrink-0`, so below about 360px the row ran past the pane — and a pane
        clips rather than scrolls, by design, so the Post button was simply
        *gone*. Measured at a 330px pane: 27 pixels of it past the edge, with
        no way to reach it. That is not a cosmetic overflow; it is the button
        that files what you have just written.

        `flex-wrap` costs a second line on a narrow screen and can never hide a
        control.
      */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
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

        {/*
          One control, six choices — which is the only shape this row can take
          another button in. The composer's whole argument is that a journal
          needing a form filled in is a journal you stop keeping, and it already
          carries four buttons, a date checkbox and a status line. Six visible
          "new …" buttons would settle the argument the wrong way.

          A document made here is filed the moment it exists and written
          afterwards, which is the order a box wants: the alternative is
          composing it somewhere else and remembering to come back.
        */}
        <NewDocumentMenu
          disabled={creating}
          label="New doc"
          onChoose={(kind) => void create(kind.mimeType, kind.label)}
        />

        <label
          className="flex items-center gap-1 whitespace-nowrap text-[11px] text-grey-500"
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
          if (e.target.files) receive(e.target.files);
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
          if (e.target.files) receive(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

