'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { captureInboxItem } from '@/lib/actions';
import { MAX_UPLOAD_MB } from '@/lib/upload';
import {
  IconAudio,
  IconCamera,
  IconImage,
  IconPaperclip,
  IconRecord,
  IconStop,
} from './icons';
import { AudioRecorder } from './audio-recorder';

/**
 * Capture. One field, no classification, nothing required — the whole point is
 * that getting a thought out of your head costs nothing. Deciding what it is
 * happens later, on the clarify screen.
 *
 * A thought is not always a sentence. It is often a photo of a book spine, a
 * whiteboard you are about to rub out, or something you would rather say than
 * type. So this takes text, files, or both in one go: the note and the picture
 * of the thing it is about are one capture, not two.
 *
 * Enter commits; Shift+Enter starts a new line, because a captured thought is
 * often more than one.
 */
export function InboxCapture() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const cameraPicker = useRef<HTMLInputElement>(null);

  const [staged, setStaged] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  /**
   * Focus on demand, from anywhere in the app.
   *
   * The barrier to capture is rarely the typing — it is remembering that the
   * inbox exists and navigating to it. `CaptureHotkey` sends us here and this
   * puts the cursor in the field, so the thought lands in the same motion.
   */
  useEffect(() => {
    const focus = () => {
      fieldRef.current?.focus();
      fieldRef.current?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('gtd:focus-capture', focus);
    return () => window.removeEventListener('gtd:focus-capture', focus);
  }, []);

  /**
   * Paste anywhere on the page, not just in the field.
   *
   * A screenshot in the clipboard is the commonest visual capture there is on
   * a desktop, and making it cost a button, a dialog and a file name is how it
   * ends up not being captured at all. Text pasted into the field is left
   * alone — the browser already does that correctly.
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0) return;

      event.preventDefault();
      stage(files);
      fieldRef.current?.focus();
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  /** Reject the oversized ones here, where there is room to say why. */
  const stage = (files: File[] | FileList) => {
    const list = [...files];
    if (list.length === 0) return;

    const tooBig = list.filter((f) => f.size > MAX_UPLOAD_MB * 1024 * 1024);
    const ok = list.filter((f) => f.size <= MAX_UPLOAD_MB * 1024 * 1024 && f.size > 0);

    if (tooBig.length > 0) {
      setErrors((e) => [
        ...e,
        ...tooBig.map(
          (f) =>
            `${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_UPLOAD_MB} MB.`,
        ),
      ]);
    }

    setStaged((s) => [...s, ...ok]);
  };

  const unstage = (index: number) =>
    setStaged((s) => s.filter((_, i) => i !== index));

  /**
   * The row is written before the bytes go up. If Drive is down or the upload
   * fails, the capture still exists with its text and the file can be attached
   * again from the clarify pane — losing the thought because Google was
   * unavailable is the one outcome capture must never have.
   */
  const submit = async () => {
    const text = fieldRef.current?.value.trim() ?? '';
    if (!text && staged.length === 0) return;

    setBusy(true);
    setErrors([]);

    const files = staged;
    // Cleared up front so the field is ready for the next thought immediately,
    // rather than after a round trip to Drive.
    setStaged([]);
    if (fieldRef.current) fieldRef.current.value = '';

    try {
      const body = new FormData();
      body.set('rawText', text);
      body.set('rawType', rawTypeFor(files));

      const item = await captureInboxItem(body);
      if (!item) return;

      for (const file of files) {
        const upload = new FormData();
        upload.set('parentType', 'inbox_item');
        upload.set('parentId', item.id);
        upload.set('file', file);

        try {
          const response = await fetch('/api/attachments', {
            method: 'POST',
            body: upload,
          });
          if (!response.ok) {
            const { error } = await response.json().catch(() => ({}));
            setErrors((e) => [...e, error ?? `${file.name} failed to upload.`]);
          }
        } catch {
          setErrors((e) => [...e, `${file.name} failed to upload.`]);
        }
      }

      router.refresh();
    } finally {
      setBusy(false);
      fieldRef.current?.focus();
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onDragOver={(e) => {
        // Only light up for actual files. A dragged action or project is
        // somebody else's drag passing through.
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(false);
        stage(e.dataTransfer.files);
      }}
      className={[
        'border-b px-4 py-3 transition-colors',
        over ? 'border-selected bg-selected-bg' : 'border-grey-200 bg-paper',
      ].join(' ')}
    >
      <textarea
        ref={fieldRef}
        name="rawText"
        rows={2}
        autoFocus
        placeholder="What's on your mind?"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            formRef.current?.requestSubmit();
          }
        }}
        className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-grey-800 placeholder:text-grey-400 focus:outline-none"
      />

      {staged.length > 0 ? (
        <ul className="mb-2 mt-1 flex flex-wrap gap-1.5">
          {staged.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center gap-1.5 rounded-sm bg-grey-150 px-1.5 py-0.5 text-[11px] text-grey-700"
            >
              <span className="text-grey-500">
                {file.type.startsWith('image/') ? (
                  <IconImage />
                ) : file.type.startsWith('audio/') ? (
                  <IconAudio />
                ) : (
                  <IconPaperclip />
                )}
              </span>
              <span className="max-w-[16rem] truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => unstage(i)}
                aria-label={`Remove ${file.name}`}
                className="text-grey-500 hover:text-grey-800"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {errors.length > 0 ? (
        <ul className="mb-2 space-y-0.5">
          {errors.map((message, i) => (
            <li key={i} className="text-[11px] text-stale">
              {message}
            </li>
          ))}
        </ul>
      ) : null}

      {recording ? (
        <AudioRecorder
          onDone={(file) => {
            stage([file]);
            setRecording(false);
          }}
          onCancel={() => setRecording(false)}
        />
      ) : null}

      <div className="mt-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-grey-500">
          <button
            type="button"
            title="Attach a file"
            aria-label="Attach a file"
            onClick={() => filePicker.current?.click()}
            className="hover:text-grey-800"
          >
            <IconPaperclip />
          </button>
          <button
            type="button"
            title="Take a photo"
            aria-label="Take a photo"
            onClick={() => cameraPicker.current?.click()}
            className="hover:text-grey-800"
          >
            <IconCamera />
          </button>
          <button
            type="button"
            title={recording ? 'Stop recording' : 'Record audio'}
            aria-label={recording ? 'Stop recording' : 'Record audio'}
            onClick={() => setRecording((r) => !r)}
            className={recording ? 'text-waiting' : 'hover:text-grey-800'}
          >
            {recording ? <IconStop /> : <IconRecord />}
          </button>

          <span className="ml-1 text-[11px] text-grey-400">
            Enter to capture · paste or drop a file
          </span>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="shrink-0 rounded-sm bg-grey-800 px-2 py-0.5 text-[11px] text-paper disabled:opacity-40"
        >
          {busy ? 'Capturing…' : 'Capture'}
        </button>
      </div>

      {/* Two pickers rather than one: `capture` asks a phone for the camera
          directly, and putting that attribute on the general picker would stop
          it offering the photo library. On a desktop it is simply ignored. */}
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
    </form>
  );
}

/**
 * What the capture *is*, for the row that will render it.
 *
 * The artefact wins over the note: a photo with "check the second edition"
 * typed beside it is a photo capture, because the picture is the thing you
 * will recognise it by in the list.
 */
function rawTypeFor(files: File[]): 'text' | 'photo' | 'audio' {
  if (files.some((f) => f.type.startsWith('image/'))) return 'photo';
  if (files.some((f) => f.type.startsWith('audio/'))) return 'audio';
  return 'text';
}
