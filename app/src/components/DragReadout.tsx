/**
 * The hours a pull would give, said while the pointer is still down.
 *
 * ASKED BY THE RÉGISSEUR ON 2026-10-24: stretching a créneau, a responsable's band, an événement
 * or a box drew it at its new size and said nothing else, so « ça fait 2h ou 2h15 ? » was read
 * off the ruler or found out after letting go. One readout for every pull, so they all speak
 * alike: start, end and length.
 *
 * A SIBLING OF THE THING PULLED, never a child. Every block it describes clips its own overflow
 * (a long name must not spill onto the next créneau), and the readout is often wider than a
 * short block. It is laid over the block's top corner rather than above it: above the first lane
 * sits the grid's sticky head, which would hide it.
 */

import { fmtHours, toClock } from '../engine.ts';

/** « 14h → 16h30 · 2h30 ». Exported for the tests and for anything that wants the same words. */
export function dragReadoutText(startISO: string, start: number, end: number): string {
  return `${toClock(startISO, start)} → ${toClock(startISO, end)} · ${fmtHours(end - start)}`;
}

export function DragReadout({
  startISO,
  start,
  end,
  left,
  top,
}: {
  startISO: string;
  start: number;
  end: number;
  /** Where the block pulled begins, in the parent's pixels. */
  left: number;
  top: number;
}) {
  return (
    <span className="drag-readout" style={{ left, top }} role="status">
      {dragReadoutText(startISO, start, end)}
    </span>
  );
}
