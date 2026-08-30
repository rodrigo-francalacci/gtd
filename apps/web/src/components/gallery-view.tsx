'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { removeGalleryPicture } from '@/lib/actions';
import { uploadToDrive } from '@/lib/drive-upload';
import { mediaFacts } from '@/lib/media-facts';
import { IconClose, IconPlus } from './icons';

/**
 * A gallery, in the preview pane.
 *
 * Two views of one set, because looking at pictures is two different
 * activities. The **album** answers "what is in here" — every picture at once,
 * big enough to recognise, in the order they were taken. The **one at a time**
 * view answers "look at this" — a single picture as large as the pane allows,
 * with the next one a swipe or an arrow key away.
 *
 * **The pictures are the content and everything else gets out of the way.**
 * What a file is called, how large it is and where it was taken are worth
 * having and are not worth looking at: they sit under the picture in the large
 * view, in the quietest grey the theme has, and nowhere at all in the album.
 * A caption competing with a photograph is a caption that has misunderstood
 * what it is for.
 */

type Picture = {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
  addedAt: string;
};

const isVideo = (picture: Picture) => (picture.mimeType ?? '').startsWith('video/');

/** Bytes, in the shortest form that is still honest. */
function size(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The facts about one picture, in the order they answer questions.
 *
 * What it is called first, because that is how you would ask for it; then how
 * big, which is the "quality" question a photograph is usually being judged on;
 * then when and where. Anything the file would not say is simply absent —
 * there is no "unknown", because a row of them would be a row about the app
 * rather than about the picture.
 */
function facts(picture: Picture): string[] {
  const out: string[] = [picture.name];

  if (picture.width && picture.height) {
    const megapixels = (picture.width * picture.height) / 1_000_000;
    out.push(
      megapixels >= 1
        ? `${picture.width} × ${picture.height} · ${megapixels.toFixed(1)} MP`
        : `${picture.width} × ${picture.height}`,
    );
  }

  const bytes = size(picture.sizeBytes);
  if (bytes) out.push(bytes);

  const when = picture.takenAt ?? picture.addedAt;
  out.push(
    new Date(when).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }) + (picture.takenAt ? '' : ' · added'),
  );

  return out;
}

export function GalleryView({
  galleryId,
  name,
}: {
  galleryId: string;
  name: string;
}) {
  const router = useRouter();
  const [pictures, setPictures] = useState<Picture[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /**
   * Ask what is in here.
   *
   * A counter rather than a boolean, so a reload after an upload is a different
   * request from the one on open and the two cannot race: the answer to an
   * older `seq` is thrown away rather than overwriting a newer one.
   */
  const [seq, setSeq] = useState(0);
  const reload = useCallback(() => setSeq((n) => n + 1), []);

  /*
   * Look again when the window comes back.
   *
   * A gallery can be filling up from somewhere else — the composer that made it
   * uploads after the row exists, and a phone can be adding to the same one —
   * so a pane opened mid-upload would otherwise sit on "0 pictures" for ever
   * and look broken while the pictures were arriving perfectly well. Focus is
   * the cheap, honest signal: it costs one small JSON request at the moment
   * somebody has just turned their attention back to this.
   */
  useEffect(() => {
    const again = () => reload();

    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [reload]);

  useEffect(() => {
    let live = true;

    fetch(`/api/galleries/${galleryId}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: { pictures: Picture[] }) => {
        if (live) setPictures(body.pictures);
      })
      .catch(() => {
        if (!live) return;
        setPictures([]);
        setError('That gallery would not load.');
      });

    return () => {
      live = false;
    };
  }, [galleryId, seq]);

  /**
   * Add pictures to a gallery that already exists.
   *
   * The same three-step path every other upload takes — session, PUT, complete
   * — with the gallery as the parent, so the bytes go straight to Drive and the
   * folder they land in is the gallery's own. Sequential rather than parallel:
   * a gallery is usually a phone's worth of photographs at once, and a line
   * saying which one is going is worth more than finishing a second sooner.
   */
  const add = async (files: FileList | File[]) => {
    const list = [...files].filter((file) => /^(image|video)\//.test(file.type));
    if (list.length === 0) return;

    setError(null);

    for (const [index, file] of list.entries()) {
      setBusy(`${file.name} (${index + 1}/${list.length})`);

      try {
        await uploadToDrive({ parentType: 'gallery', parentId: galleryId }, file, undefined, {
          ...(await mediaFacts(file)),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : `${file.name} would not upload.`);
      }
    }

    setBusy(null);
    reload();
    // The row outside this pane counts its pictures, and it is now wrong.
    router.refresh();
  };

  const remove = async (picture: Picture) => {
    setBusy(`Removing ${picture.name}`);

    try {
      await removeGalleryPicture(picture.id);
      setPictures((current) => current?.filter((p) => p.id !== picture.id) ?? null);
      setOpen(null);
    } finally {
      setBusy(null);
    }
  };

  /*
   * Arrow keys move through the large view and Escape leaves it, because those
   * are the keys anybody who has ever opened a photograph reaches for. Bound to
   * the window rather than to a focused element: the picture is not focusable
   * and making it so would put a focus ring around a photograph.
   */
  useEffect(() => {
    if (open === null || !pictures) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
      if (event.key === 'ArrowRight') setOpen((i) => Math.min((i ?? 0) + 1, pictures.length - 1));
      if (event.key === 'ArrowLeft') setOpen((i) => Math.max((i ?? 0) - 1, 0));
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pictures]);

  const showing = open !== null && pictures ? pictures[open] : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-grey-100">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-grey-200 bg-grey-50 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-grey-600">
          {pictures === null
            ? 'Opening…'
            : `${pictures.length} ${pictures.length === 1 ? 'picture' : 'pictures'}`}
        </span>

        {showing ? (
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="rounded-sm border border-grey-300 px-2 py-0.5 text-[11px] text-grey-700 hover:bg-grey-200"
          >
            Show all
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => input.current?.click()}
          title="Add pictures or video"
          className="flex items-center gap-1 rounded-sm border border-grey-300 px-2 py-0.5 text-[11px] text-grey-700 hover:bg-grey-200"
        >
          <IconPlus />
          Add
        </button>

        {busy ? <span className="text-[10px] text-grey-400">{busy}…</span> : null}
        {error ? <span className="text-[10px] text-stale">{error}</span> : null}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void add(e.target.files);
          e.target.value = '';
        }}
      />

      {showing ? (
        <One
          /*
           * Keyed on the picture, so the "really remove it?" state resets when
           * you move to the next one. The app's own rule for a panel seeded
           * from a selected row, and much better here than an effect that
           * clears it: an effect would fire after the new picture had already
           * rendered wearing the previous one's confirmation.
           */
          key={showing.id}
          picture={showing}
          index={open ?? 0}
          total={pictures?.length ?? 0}
          onMove={(delta) =>
            setOpen((i) =>
              Math.max(0, Math.min((i ?? 0) + delta, (pictures?.length ?? 1) - 1)),
            )
          }
          onRemove={() => void remove(showing)}
        />
      ) : (
        <Album
          pictures={pictures}
          name={name}
          onOpen={setOpen}
          onDrop={(files) => void add(files)}
        />
      )}
    </div>
  );
}

/**
 * Everything at once.
 *
 * A CSS grid with a *minimum* tile rather than a fixed column count, so the
 * same album is three across in a narrow pane and six across in a wide one
 * without anybody deciding when. Square tiles with the picture cropped to fill:
 * a wall of different shapes is a wall you have to read rather than scan, and
 * the whole point of the album is recognising something at a glance and opening
 * it.
 */
function Album({
  pictures,
  name,
  onOpen,
  onDrop,
}: {
  pictures: Picture[] | null;
  name: string;
  onOpen: (index: number) => void;
  onDrop: (files: FileList) => void;
}) {
  const [over, setOver] = useState(false);

  if (pictures === null) {
    return <div className="p-4 text-[12px] text-grey-500">Opening {name}…</div>;
  }

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onDrop(e.dataTransfer.files);
      }}
      className={[
        'min-h-0 flex-1 overflow-auto p-2',
        over ? 'bg-selected-bg' : '',
      ].join(' ')}
    >
      {pictures.length === 0 ? (
        <p className="p-3 text-[12px] leading-relaxed text-grey-500">
          Nothing in here yet. Drop pictures or video on this pane, or press Add.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-1.5">
          {pictures.map((picture, index) => (
            <button
              key={picture.id}
              type="button"
              onClick={() => onOpen(index)}
              title={picture.name}
              className="group relative aspect-square overflow-hidden rounded-sm bg-grey-200"
            >
              {isVideo(picture) ? (
                <video
                  src={`/api/attachments/${picture.id}/file`}
                  preload="metadata"
                  muted
                  playsInline
                  className="h-full w-full object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/attachments/${picture.id}/file`}
                  alt={picture.name}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                />
              )}

              {/* A film has to say it is one before you press it, or the album
                  is a set of stills that behave differently for no visible
                  reason. */}
              {isVideo(picture) ? (
                <span className="absolute bottom-1 right-1 rounded-sm bg-ink/60 px-1 text-[9px] text-paper">
                  video
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One picture, as large as the pane allows.
 *
 * `object-contain` rather than `cover`: this is the view where the picture is
 * the whole point, and cropping the thing somebody asked to look at is the one
 * thing it must not do — the album already crops, which is what the album is
 * for.
 *
 * Swiping works because the picture sits in a horizontally scrollable strip of
 * one, and a touch drag past a threshold moves the index. Not a library: the
 * gesture is a start point, an end point and a comparison.
 */
function One({
  picture,
  index,
  total,
  onMove,
  onRemove,
}: {
  picture: Picture;
  index: number;
  total: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const from = useRef<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-ink/5 p-2"
        onTouchStart={(e) => {
          from.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = from.current;
          from.current = null;
          if (start === null) return;

          const end = e.changedTouches[0]?.clientX ?? start;
          // Forty pixels: past a thumb's wobble, short of a deliberate scroll.
          if (Math.abs(end - start) > 40) onMove(end < start ? 1 : -1);
        }}
      >
        {isVideo(picture) ? (
          <video
            key={picture.id}
            src={`/api/attachments/${picture.id}/file`}
            controls
            playsInline
            className="max-h-full max-w-full"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={picture.id}
            src={`/api/attachments/${picture.id}/file`}
            alt={picture.name}
            className="max-h-full max-w-full object-contain"
          />
        )}

        {index > 0 ? (
          <button
            type="button"
            onClick={() => onMove(-1)}
            aria-label="Previous"
            className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-paper/80 px-2 py-1 text-[13px] text-grey-700 hover:bg-paper"
          >
            ‹
          </button>
        ) : null}

        {index < total - 1 ? (
          <button
            type="button"
            onClick={() => onMove(1)}
            aria-label="Next"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-paper/80 px-2 py-1 text-[13px] text-grey-700 hover:bg-paper"
          >
            ›
          </button>
        ) : null}
      </div>

      {/*
        The quiet line. Everything the file was willing to say, in the smallest
        type the app has, under the picture rather than over it — a caption on
        top of a photograph is a caption you have to look past.
      */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-grey-200 bg-grey-50 px-3 py-1.5 text-[10px] text-grey-500">
        <span className="tabular-nums">
          {index + 1}/{total}
        </span>

        {facts(picture).map((fact) => (
          <span key={fact} className="truncate">
            {fact}
          </span>
        ))}

        {picture.latitude !== null && picture.longitude !== null ? (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${picture.latitude},${picture.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-grey-800"
          >
            {picture.latitude.toFixed(4)}, {picture.longitude.toFixed(4)}
          </a>
        ) : null}

        <span className="flex-1" />

        <a
          href={`/api/attachments/${picture.id}/file`}
          download={picture.name}
          className="underline underline-offset-2 hover:text-grey-800"
        >
          Save
        </a>

        {confirming ? (
          <>
            <button
              type="button"
              onClick={onRemove}
              className="rounded-sm bg-stale px-1.5 py-0.5 text-[10px] text-paper"
            >
              Remove it
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="underline underline-offset-2 hover:text-grey-800"
            >
              Cancel
            </button>
            <span>The file goes to Drive&rsquo;s bin.</span>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex items-center gap-0.5 underline underline-offset-2 hover:text-grey-800"
          >
            <IconClose />
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
