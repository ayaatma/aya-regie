/**
 * The time axis of a phase, in pixels: several days end to end, with the nights taken out.
 *
 * WHY IT IS NOT THE EXPLOIT'S AXIS. The exploit runs eighteen hours without a break, so one hour
 * is one offset and `hour * pxPerHour` is the whole of its geometry. A montage runs three days
 * with a night in the middle of each, and nobody works those nights: drawing them would spend
 * two thirds of the screen on emptiness, and hiding them by squeezing the day would make an hour
 * mean two different widths depending on where it fell.
 *
 * So the axis is a LIST OF WORKED SEGMENTS laid end to end, each with its own left edge, and a
 * gap between two days that reads as the night. One hour is one width everywhere; what changes
 * is that some hours are not on the axis at all. `pieces` is what turns a window into the one or
 * more bars that draw it, and `hoursAt` is the way back, for a click.
 *
 * Everything here is in decimal hours from the PHASE's own start. See `tools/src/phase.ts`.
 */

import { phaseDays, type Phase, type Window } from '../engine.ts';

/** One worked stretch of one day, and where it lands on screen. */
export interface PhaseSegment {
  dayIndex: number;
  dayLabel: string;
  /** Hours from the phase start. */
  start: number;
  end: number;
  /** Pixels from the left edge of the track. */
  x: number;
  width: number;
  /** True on the first segment of a day, which is where the day's name is drawn. */
  firstOfDay: boolean;
}

/** A window, cut into the bars that actually draw it. A night in the middle makes two. */
export interface PhasePiece {
  start: number;
  end: number;
  x: number;
  width: number;
  segment: PhaseSegment;
}

export interface PhaseAxis {
  segments: PhaseSegment[];
  /** The whole track, gaps included. */
  width: number;
  pxPerHour: number;
  /** The x of a day's first segment and the width of all of it, for the day headings. */
  days: Array<{ index: number; label: string; x: number; width: number }>;
}

/** How wide the space between two days is. It is the night, and it reads as a separation. */
export const DAY_GAP = 14;

/**
 * `onlyDay` narrows the axis to one day of the phase, and nothing else changes.
 *
 * WHY IT IS THE AXIS THAT FILTERS and not the grid. A montage of four days is four screens wide
 * at any useful zoom, and the régisseur asked to be able to look at one day at a time. Everything
 * the grid draws is placed through `piecesOf`, and everything it reads back is read through
 * `segmentAt` and `hourOn`, so a day missing from `segments` is a day that draws nothing, takes no
 * drop and can hold no trimmed edge: exactly one place to change, and no second rule to keep in
 * step with the first. A day index nobody has (the dates moved under the filter) leaves an empty
 * axis rather than silently falling back to the whole phase.
 */
export function buildPhaseAxis(
  phase: Phase,
  pxPerHour: number,
  onlyDay: number | null = null,
): PhaseAxis {
  const segments: PhaseSegment[] = [];
  const days: PhaseAxis['days'] = [];
  let x = 0;

  for (const day of phaseDays(phase)) {
    if (onlyDay !== null && day.index !== onlyDay) continue;
    const dayStartX = x;
    day.segments.forEach((piece, i) => {
      const width = (piece.end - piece.start) * pxPerHour;
      segments.push({
        dayIndex: day.index,
        dayLabel: day.label,
        start: piece.start,
        end: piece.end,
        x,
        width,
        firstOfDay: i === 0,
      });
      // Segments of the SAME day are separated by the same gap: a lunch break taken out of the
      // worked hours is a hole in the day, and drawing it as one would be a lie about the axis.
      x += width + DAY_GAP;
    });
    if (day.segments.length > 0) {
      days.push({
        index: day.index,
        label: day.label,
        x: dayStartX,
        width: x - DAY_GAP - dayStartX,
      });
    }
  }

  return {
    segments,
    width: Math.max(0, x - DAY_GAP),
    pxPerHour,
    days,
  };
}

/**
 * How much axis a filter would ask for: the worked hours on it, and the room the nights take.
 *
 * Pure arithmetic over the same `phaseDays` the axis is built from, so that fitting the grid to
 * the screen and drawing it can never disagree about what is on screen. The gaps are counted
 * separately because they belong to no hour: they are a fixed cost whatever the zoom, so the
 * hours have to be given what is left after them.
 */
export function axisSpan(phase: Phase, onlyDay: number | null): { hours: number; gaps: number } {
  let hours = 0;
  let segments = 0;
  for (const day of phaseDays(phase)) {
    if (onlyDay !== null && day.index !== onlyDay) continue;
    for (const piece of day.segments) {
      hours += piece.end - piece.start;
      segments += 1;
    }
  }
  return { hours, gaps: Math.max(0, segments - 1) * DAY_GAP };
}

/**
 * The bars that draw one window.
 *
 * A window running from Thursday morning to Friday evening comes back as two bars, one per day,
 * because the night between them is not on the axis. Zero bars is a legitimate answer: a window
 * entirely inside the unworked hours draws nothing, which is the truth about it.
 */
export function piecesOf(axis: PhaseAxis, window: Window): PhasePiece[] {
  const pieces: PhasePiece[] = [];
  for (const segment of axis.segments) {
    const start = Math.max(window.start, segment.start);
    const end = Math.min(window.end, segment.end);
    if (end <= start) continue;
    pieces.push({
      start,
      end,
      x: segment.x + (start - segment.start) * axis.pxPerHour,
      width: (end - start) * axis.pxPerHour,
      segment,
    });
  }
  return pieces;
}

/**
 * The hour a click at `x` fell on, or null when it landed in a gap between two days.
 *
 * Null rather than the nearest hour, on purpose: a click on the night is not a click on the
 * evening before it, and guessing which one somebody meant is how a box ends up on the wrong day.
 */
export function hoursAt(axis: PhaseAxis, x: number): number | null {
  for (const segment of axis.segments) {
    if (x < segment.x || x > segment.x + segment.width) continue;
    return segment.start + (x - segment.x) / axis.pxPerHour;
  }
  return null;
}

/** The worked stretch a click fell in, which is what a click on an empty lane places somebody for. */
export function segmentAt(axis: PhaseAxis, x: number): PhaseSegment | null {
  return axis.segments.find((s) => x >= s.x && x <= s.x + s.width) ?? null;
}

/**
 * The hour a position means ON ONE GIVEN DAY, snapped, clamped to that day's own bounds.
 *
 * THE DIFFERENCE FROM `hoursAt` IS THE WHOLE POINT, and it cost the régisseur an afternoon.
 * `hoursAt` answers null in the gap between two days because a CLICK there means nothing, and
 * guessing which day somebody meant is how a box lands on the wrong one. A DRAG is the opposite
 * situation: the day is already known, it is the day the box being trimmed is on, and pulling the
 * pointer past the edge of it plainly means the edge. Reusing `hoursAt` here, with the start of
 * the day as its fallback, turned "pull the end a bit further" into "set the end to this morning",
 * which the minimum length then turned into a fifteen-minute box.
 */
export function hourOn(axis: PhaseAxis, segment: PhaseSegment, x: number, snap: number): number {
  const raw =
    x <= segment.x
      ? segment.start
      : x >= segment.x + segment.width
        ? segment.end
        : segment.start + (x - segment.x) / axis.pxPerHour;
  const snapped = snap > 0 ? Math.round(raw / snap) * snap : raw;
  return Math.min(Math.max(snapped, segment.start), segment.end);
}

/**
 * What a box becomes when one of its edges is pulled to `hour`, on the day it is being pulled on.
 *
 * `min` is kept inside THAT DAY rather than inside the whole box, and that is deliberate: a box
 * running over two days has its end dragged on the second one, and "at least `min` after the
 * start" would let that end land before the second day even begins. The box would then draw
 * nothing on that day, taking the edge being dragged off the screen with it.
 */
export function trimTo(
  box: Window,
  segment: PhaseSegment,
  edge: 'start' | 'end',
  hour: number,
  min: number,
): Window {
  if (edge === 'start') {
    const ceiling = Math.min(box.end, segment.end) - min;
    return { start: Math.min(hour, ceiling), end: box.end };
  }
  const floor = Math.max(box.start, segment.start) + min;
  return { start: box.start, end: Math.max(hour, floor) };
}

/**
 * Which row of its lane each window goes on, so that two that overlap are never drawn on top of
 * one another.
 *
 * Greedy packing over the windows in clock order: each one takes the first row whose last window
 * has already ended. That is what makes "un orga de 8h à 20h, un autre de 12h à 16h" two rows
 * and "un le matin, un l'après-midi" one, which is the compact reading of the same facts.
 *
 * ONE PERSON KEEPS ONE ROW when `keyOf` is given, and it is given everywhere a person is drawn.
 * Somebody with two windows in the same pole, especially two that follow one another, is one
 * line on the grid and not two: reading it as two people is exactly what the eye does otherwise.
 * Rows are still shared between DIFFERENT people whose windows never overlap, so a pole where
 * everybody takes turns stays one line tall.
 */
export function packRows<T extends Window>(
  windows: readonly T[],
  keyOf?: (window: T) => string,
): Map<T, number> {
  const placed = new Map<T, number>();
  const inOrder = [...windows].sort((a, b) => a.start - b.start || a.end - b.end);

  if (!keyOf) {
    const rows: number[] = [];
    for (const window of inOrder) {
      let row = rows.findIndex((end) => end <= window.start);
      if (row === -1) {
        row = rows.length;
        rows.push(window.end);
      } else {
        rows[row] = window.end;
      }
      placed.set(window, row);
    }
    return placed;
  }

  // Grouped by person, in the order their first window starts, so the rows read top to bottom
  // the way the day does.
  const byPerson = new Map<string, T[]>();
  for (const window of inOrder) {
    const key = keyOf(window);
    byPerson.set(key, [...(byPerson.get(key) ?? []), window]);
  }

  /** What each row already holds. A person joins a row only if they clash with none of it. */
  const rows: T[][] = [];
  for (const windows of byPerson.values()) {
    let row = rows.findIndex((held) =>
      windows.every((mine) => held.every((other) => mine.start >= other.end || other.start >= mine.end)),
    );
    if (row === -1) {
      row = rows.length;
      rows.push([]);
    }
    rows[row]!.push(...windows);
    for (const window of windows) placed.set(window, row);
  }

  return placed;
}
