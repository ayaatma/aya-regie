/**
 * Alt + wheel zooms a grid, around the hour under the pointer.
 *
 * WHY AROUND THE POINTER. The slider zooms around the left edge, so whatever the régisseur was
 * looking at slides off screen and has to be found again. With the wheel the pointer is already
 * on the thing: the hour under it stays under it, and everything else grows or shrinks around it.
 * Asked for on 2026-09-16.
 *
 * WHY ALT. The plain wheel scrolls the grid down and Shift + wheel scrolls it sideways, both
 * gestures the régisseur relies on, and Ctrl + wheel is the browser's own page zoom.
 *
 * HOW. The hour under the pointer is written down as an anchor before the zoom changes, and the
 * scroll is put back after the grid has been laid out at the new zoom, so that the anchor is again
 * at the same distance from the edge of the viewport. The axis itself is the caller's: the exploit
 * is `hour * pxPerHour`, a phase has its nights taken out. See `AxisAnchor`.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { LABEL_W } from './layout.ts';

/** How much one notch of a mouse wheel (about 100 px of delta) changes the zoom: about 16 %. */
const SENSITIVITY = 0.0015;

/** The zoom a wheel movement asks for, within the bounds. Pure, and tested. */
export function wheelZoom(
  pxPerHour: number,
  deltaPx: number,
  bounds: { min: number; max: number },
): number {
  const next = pxPerHour * Math.exp(-deltaPx * SENSITIVITY);
  return Math.min(bounds.max, Math.max(bounds.min, next));
}

export interface WheelAxis<A> {
  /** The point of the axis at `x` pixels from the left of the track, at the current zoom. */
  anchorAt(x: number): A;
  /** Where that point lands at `pxPerHour`. */
  xOf(anchor: A, pxPerHour: number): number;
}

export function useWheelZoom<A>(
  scroll: React.RefObject<HTMLDivElement | null>,
  pxPerHour: number,
  setPxPerHour: (value: number) => void,
  bounds: { min: number; max: number },
  axis: WheelAxis<A>,
): void {
  // The listener is attached once and reads everything through refs, so that it never works from
  // the zoom of the render it was attached in.
  const latest = useRef({ pxPerHour, setPxPerHour, bounds, axis });
  latest.current = { pxPerHour, setPxPerHour, bounds, axis };

  /** Set by a wheel event, consumed once the grid has been laid out at the zoom it asked for. */
  const pending = useRef<{ anchor: A; pointer: number; track: number; target: number } | null>(null);

  /*
   * Checked after every render rather than once: a grid can mount without its scrolling viewport
   * (a phase that is not enabled draws a notice instead) and gain it later.
   */
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scroll.current !== element) setElement(scroll.current);
  });

  useEffect(() => {
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.altKey) return;
      // Not passive, which is why this is a native listener and not React's `onWheel`: without
      // this the browser would also scroll, or step back in its history.
      event.preventDefault();

      const { bounds: zoomBounds, axis: current } = latest.current;
      const lines = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1;
      const delta = (event.deltaY || event.deltaX) * lines;
      if (delta === 0) return;

      // Several notches can arrive before React has drawn the first: they all keep the first
      // anchor, and they compound on the zoom already asked for rather than the one on screen.
      const already = pending.current;
      const from = already ? already.target : latest.current.pxPerHour;
      const target = wheelZoom(from, delta, zoomBounds);
      if (target === from) return;

      if (already) {
        already.target = target;
      } else {
        const box = element.getBoundingClientRect();
        // Where the track starts inside the scrolled content: measured, since the label column
        // sits before it, with the stylesheet's width as the fallback.
        const trackElement = element.querySelector('.lane-track');
        const track = trackElement
          ? trackElement.getBoundingClientRect().left - box.left + element.scrollLeft
          : LABEL_W;
        const pointer = event.clientX - box.left;
        pending.current = {
          anchor: current.anchorAt(element.scrollLeft + pointer - track),
          pointer,
          track,
          target,
        };
      }
      latest.current.setPxPerHour(target);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [element]);

  useLayoutEffect(() => {
    const element = scroll.current;
    const waiting = pending.current;
    if (!element || !waiting) return;
    pending.current = null;
    element.scrollLeft = Math.max(
      0,
      waiting.track + latest.current.axis.xOf(waiting.anchor, pxPerHour) - waiting.pointer,
    );
  }, [pxPerHour, scroll]);
}
