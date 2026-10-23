/**
 * Recadrer une photo, since 2026-10-23: the régie frames the face themselves, zoom and position,
 * and the square kept is drawn from that framing.
 *
 * The picture framed is the largest one at hand (`cropSource`): the form's upload asked again from
 * Drive, or the square already kept for a photo dropped by hand. Nothing is stored but the result,
 * a PHOTO_SIZE square, so a framing is redone from the original rather than undone.
 */

import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';

import { MAX_PHOTO_ZOOM, clampFraming, framedSquare, squareCrop, type PhotoFraming } from '../engine.ts';
import { PHOTO_SIZE } from '../photos/photoStore.ts';

/** The side of the frame on screen, in CSS pixels. */
const VIEW = 300;

type Framing = PhotoFraming;
const MAX_ZOOM = MAX_PHOTO_ZOOM;
const clamp = clampFraming;
const squareOf = framedSquare;

async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const as = (type: string): Promise<Blob | null> => new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await as('image/webp');
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await as('image/jpeg');
  if (!jpeg) throw new Error("Le navigateur n'a pas pu enregistrer l'image.");
  return jpeg;
}

export function PhotoCropper({
  name,
  load,
  onCancel,
  onDone,
}: {
  name: string;
  /** The picture to frame; a rejection is shown as the reason. */
  load(): Promise<Blob>;
  onCancel(): void;
  onDone(square: Blob): Promise<void>;
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [framing, setFraming] = useState<Framing | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; from: Framing } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const picture = await createImageBitmap(await load());
        if (!live) return picture.close();
        const crop = squareCrop(picture.width, picture.height);
        setBitmap(picture);
        setFraming({ zoom: 1, cx: crop.x + crop.size / 2, cy: crop.y + crop.size / 2 });
      } catch (cause) {
        if (live) setProblem(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      live = false;
    };
    // `load` is a new function on every render of the parent; the picture is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context || !bitmap || !framing) return;
    const square = squareOf(framing, bitmap.width, bitmap.height);
    context.clearRect(0, 0, VIEW, VIEW);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, square.x, square.y, square.size, square.size, 0, 0, VIEW, VIEW);
  }, [bitmap, framing]);

  const set = (next: Framing): void => {
    if (bitmap) setFraming(clamp(next, bitmap.width, bitmap.height));
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (!framing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: framing };
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (!drag.current || !bitmap) return;
    const { from } = drag.current;
    // A screen pixel is this many pixels of the picture at the current zoom.
    const ratio = Math.min(bitmap.width, bitmap.height) / from.zoom / VIEW;
    set({ ...from, cx: from.cx - (event.clientX - drag.current.x) * ratio, cy: from.cy - (event.clientY - drag.current.y) * ratio });
  };
  const onWheel = (event: WheelEvent<HTMLCanvasElement>): void => {
    if (!framing) return;
    set({ ...framing, zoom: framing.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1) });
  };

  const save = async (): Promise<void> => {
    if (!bitmap || !framing) return;
    setBusy(true);
    setProblem(null);
    try {
      const out = document.createElement('canvas');
      out.width = PHOTO_SIZE;
      out.height = PHOTO_SIZE;
      const context = out.getContext('2d');
      if (!context) throw new Error("Le navigateur n'a pas pu redimensionner l'image.");
      context.imageSmoothingQuality = 'high';
      const square = squareOf(framing, bitmap.width, bitmap.height);
      context.drawImage(bitmap, square.x, square.y, square.size, square.size, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
      await onDone(await encode(out));
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog is-small photo-crop" role="dialog" aria-modal="true" aria-label={`Recadrer la photo de ${name}`} onClick={(event) => event.stopPropagation()}>
        <h2 className="dialog-title">Recadrer la photo de {name}</h2>
        <p className="panel-sub">Faites glisser la photo pour la placer, zoomez avec le curseur ou la molette.</p>
        <div className="photo-crop-frame">
          {bitmap ? (
            <canvas
              ref={canvas}
              width={VIEW}
              height={VIEW}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onWheel={onWheel}
            />
          ) : (
            <span className="people-meta">{problem ? '' : 'Chargement de la photo…'}</span>
          )}
        </div>
        <label className="photo-crop-zoom">
          <span className="people-meta">Zoom</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={framing?.zoom ?? 1}
            disabled={!framing}
            aria-label="Zoom"
            onChange={(event) => framing && set({ ...framing, zoom: Number(event.target.value) })}
          />
        </label>
        {problem && <p className="person-photo-problem">{problem}</p>}
        <span className="setup-confirm">
          <button type="button" className="btn is-primary" disabled={!framing || busy} onClick={() => void save()}>
            {busy ? 'Enregistrement…' : 'Enregistrer ce cadrage'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Annuler
          </button>
        </span>
      </div>
    </div>
  );
}
