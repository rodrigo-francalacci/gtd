'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { captureInboxItem } from '@/lib/actions';
import { uploadCaptureFiles } from '@/lib/capture-upload';
import { MAX_DIRECT_UPLOAD_MB } from '@/lib/upload';
import { AudioRecorder } from './audio-recorder';
import { IconAudio, IconCamera, IconImage, IconPaperclip, IconStop } from './icons';

/**
 * The phone capture surface, until there is an APK.
 *
 * Deliberately not the desktop box made narrower. A phone has one hand, no
 * hover, no keyboard shortcuts and no drag-and-drop, and it is used standing
 * up in a shop or walking away from a conversation — so the whole screen is
 * the field, the targets are thumb-sized, and the camera is a first-class
 * button rather than something behind a paperclip.
 *
 * Everything it writes goes through the same `captureInboxItem` and
 * `/api/attachments` as the desktop, so a capture made here is not a second
 * kind of capture.
 */

/** Survives the browser killing a backgrounded tab, which phones do freely. */
const DRAFT_KEY = 'gtd:capture-draft';

type Recent = {
  id: string;
  rawType: string;
  rawText: string | null;
  createdAt: Date;
  attachmentCount: number;
};

export function MobileCapture({ recent }: { recent: Recent[] }) {
  const router = useRouter();
  const field = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const cameraPicker = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  /** The longer half, hidden until asked for — most captures are one line. */
  const [detail, setDetail] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [staged, setStaged] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  /**
   * Phones background a tab the instant you switch app, and the staged files
   * exist only in memory — there is nothing to resume from. This is the one
   * moment worth interrupting a navigation for.
   */
  useEffect(() => {
    if (!progress) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [progress]);

  /**
   * A draft is not a preference, so it belongs here rather than in the
   * `preferences` table: it is worthless on another device, it changes on
   * every keystroke, and the thing it protects against — the OS discarding a
   * backgrounded tab mid-sentence — is local by definition.
   */
  useEffect(() => {
    const saved = window.localStorage.getItem(DRAFT_KEY);
    if (saved) setText(saved);
  }, []);

  useEffect(() => {
    if (text) window.localStorage.setItem(DRAFT_KEY, text);
    else window.localStorage.removeItem(DRAFT_KEY);
  }, [text]);

  const stage = (files: File[] | FileList) => {
    const list = [...files];
    if (list.length === 0) return;

    const tooBig = list.filter((f) => f.size > MAX_DIRECT_UPLOAD_MB * 1024 * 1024);
    if (tooBig.length > 0) {
      setErrors((e) => [
        ...e,
        ...tooBig.map(
          (f) => `${f.name} is too big — the limit is ${MAX_DIRECT_UPLOAD_MB} MB.`,
        ),
      ]);
    }

    setStaged((s) => [
      ...s,
      ...list.filter((f) => f.size > 0 && f.size <= MAX_DIRECT_UPLOAD_MB * 1024 * 1024),
    ]);
  };

  const submit = async () => {
    const title = text.trim();
    const extra = detail.trim();
    // Same convention as the desktop: one raw capture, first line is the
    // title, blank line then the note.
    const note = extra ? `${title}\n\n${extra}` : title;
    if (!note && staged.length === 0) return;

    setBusy(true);
    setErrors([]);

    const files = staged;
    // The text clears at once — the next thought should not queue behind
    // Drive. The files stay on screen until they have actually arrived, which
    // is the whole point: clearing them early is what let four photos of five
    // die quietly behind a screen that already said it was done.
    setText('');
    setDetail('');
    setNoteOpen(false);

    try {
      const body = new FormData();
      body.set('rawText', note);
      body.set(
        'rawType',
        files.some((f) => f.type.startsWith('image/'))
          ? 'photo'
          : files.some((f) => f.type.startsWith('audio/'))
            ? 'audio'
            : 'text',
      );

      const item = await captureInboxItem(body);
      if (!item) {
        setStaged([]);
        return;
      }

      if (files.length === 0) {
        setStaged([]);
        setFlash('Captured.');
        router.refresh();
        return;
      }

      setProgress({ done: 0, total: files.length });
      const failures = await uploadCaptureFiles(item.id, files, (done, total) =>
        setProgress({ done, total }),
      );
      setProgress(null);

      // Anything that failed stays staged so "Capture" sends it again, rather
      // than the photo simply ceasing to exist.
      setStaged(failures.map((f) => f.file));
      setErrors(failures.map((f) => f.message));

      const landed = files.length - failures.length;
      setFlash(
        failures.length === 0
          ? `Captured with ${landed} file${landed === 1 ? '' : 's'}.`
          : `Captured — ${landed} of ${files.length} files arrived. Tap Capture to retry the rest.`,
      );
      router.refresh();
    } catch {
      // The thought is the thing worth protecting: put it back rather than
      // clearing a field whose contents went nowhere.
      setText(note);
      setStaged(files);
      setErrors((e) => [...e, 'That did not save. Check your connection.']);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(timer);
  }, [flash]);

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col bg-paper px-4">
      <header className="flex shrink-0 items-baseline justify-between py-3">
        <h1 className="text-[15px] font-semibold text-grey-900">Capture</h1>
        <a
          href="/inbox"
          className="text-[13px] text-grey-500 underline underline-offset-2"
        >
          Inbox
        </a>
      </header>

      {/* 16px minimum, or iOS Safari zooms the whole page in on focus. Left
          scalable otherwise — blocking pinch-zoom to avoid that is a bad
          trade. */}
      <textarea
        ref={field}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's on your mind?"
        autoFocus
        className="min-h-[7rem] flex-1 resize-none bg-transparent py-2 text-[16px] leading-relaxed text-grey-800 placeholder:text-grey-400 focus:outline-none"
      />

      {noteOpen ? (
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={4}
          autoFocus
          placeholder="A bit more…"
          className="mb-2 shrink-0 resize-none border-l-2 border-grey-200 bg-transparent pl-2 text-[16px] leading-relaxed text-grey-700 placeholder:text-grey-400 focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="mb-2 shrink-0 self-start text-[13px] text-grey-500 underline underline-offset-2"
        >
          Add a note
        </button>
      )}

      {staged.length > 0 ? (
        <ul className="shrink-0 space-y-1.5 pb-2">
          {staged.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center gap-2 rounded-sm bg-grey-150 px-2.5 py-2 text-[13px] text-grey-700"
            >
              <span className="shrink-0 text-grey-500">
                {file.type.startsWith('image/') ? (
                  <IconImage />
                ) : file.type.startsWith('audio/') ? (
                  <IconAudio />
                ) : (
                  <IconPaperclip />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              {progress ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setStaged((s) => s.filter((_, j) => j !== i))}
                  className="shrink-0 px-2 text-[18px] leading-none text-grey-500"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {recording ? (
        <div className="shrink-0 pb-2">
          <AudioRecorder
            onDone={(file) => {
              stage([file]);
              setRecording(false);
            }}
            onCancel={() => setRecording(false)}
          />
        </div>
      ) : null}

      {errors.length > 0 ? (
        <ul className="shrink-0 space-y-1 pb-2">
          {errors.map((message, i) => (
            <li key={i} className="text-[13px] text-stale">
              {message}
            </li>
          ))}
        </ul>
      ) : null}

      {flash ? (
        <p
          role="status"
          className="shrink-0 rounded-sm bg-selected-bg px-2.5 py-2 text-[13px] text-grey-700"
        >
          {flash}
        </p>
      ) : null}

      {/* Thumb territory: the three ways in, then the commit, pinned above the
          home indicator on a notched phone. */}
      <div
        className="sticky bottom-0 shrink-0 space-y-2 bg-paper pt-2"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <div className="grid grid-cols-3 gap-2">
          <BigButton
            label="Photo"
            icon={<IconCamera />}
            onClick={() => cameraPicker.current?.click()}
          />
          <BigButton
            label="File"
            icon={<IconPaperclip />}
            onClick={() => filePicker.current?.click()}
          />
          <BigButton
            label={recording ? 'Stop' : 'Record'}
            icon={recording ? <IconStop /> : <IconAudio />}
            active={recording}
            onClick={() => setRecording((r) => !r)}
          />
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || (!text.trim() && staged.length === 0)}
          className="w-full rounded-sm bg-grey-800 py-3 text-[15px] font-medium text-paper disabled:opacity-40"
        >
          {progress
            ? `Uploading ${progress.done} of ${progress.total}…`
            : busy
              ? 'Capturing…'
              : 'Capture'}
        </button>
        {progress ? (
          <p className="text-center text-[12px] text-grey-500">
            Your note is saved. Stay here until the files finish.
          </p>
        ) : null}
      </div>

      {recent.length > 0 ? (
        <section className="shrink-0 border-t border-grey-150 pb-6 pt-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-grey-500">
            Just captured
          </h2>
          <ul className="mt-1.5 space-y-1">
            {recent.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline gap-2 text-[13px] text-grey-600"
              >
                <span className="min-w-0 flex-1 truncate">
                  {item.rawText ||
                    (item.rawType === 'photo'
                      ? 'Photo'
                      : item.rawType === 'audio'
                        ? 'Voice note'
                        : 'Untitled')}
                </span>
                {item.attachmentCount > 0 ? (
                  <span className="shrink-0 text-grey-400">
                    <IconPaperclip />
                  </span>
                ) : null}
                <span className="shrink-0 tabular-nums text-[11px] text-grey-400">
                  {time.format(item.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <input
        ref={filePicker}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          stage(e.target.files ?? []);
          e.target.value = '';
        }}
      />
      {/* `capture` asks the phone for the camera rather than the photo library.
          It sits on its own input so the button beside it can still offer the
          library, which is where a photo you took an hour ago lives. */}
      <input
        ref={cameraPicker}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          stage(e.target.files ?? []);
          e.target.value = '';
        }}
      />
    </div>
  );
}

const time = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
});

function BigButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        // 44px minimum is the smallest target a thumb hits reliably.
        'flex min-h-[3rem] flex-col items-center justify-center gap-1 rounded-sm border text-[12px]',
        active
          ? 'border-waiting text-waiting'
          : 'border-grey-300 text-grey-600 active:bg-grey-100',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  );
}
