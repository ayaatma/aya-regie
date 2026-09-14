/**
 * Walking the grid with the arrow keys.
 *
 * The rule is the one the eye already follows: left and right are time on the same row, up and
 * down are the column of people, and falling out of the bottom of a shift lands in the row below
 * at the same hour. Nothing here knows about React, so the movement can be tested for what it
 * is, which is a small piece of geometry that is easy to get subtly wrong and impossible to see
 * wrong in a screenshot.
 *
 * Empty shifts are stepped over. There is nobody to select in one and nobody to remove from it,
 * so stopping there would be a key press that appears not to work.
 */

export interface NavShift {
  key: string;
  start: number;
  end: number;
  /** How many people actually stand in it. Places left to fill are not navigable. */
  count: number;
}

/** One entry per drawn row of the grid, in the order the rows appear, shifts sorted by start. */
export type NavLanes = readonly (readonly NavShift[])[];

export interface Cursor {
  shiftKey: string;
  index: number;
}

/** The first box there is, for the first arrow press when nothing is selected. */
export function firstCursor(lanes: NavLanes): Cursor | null {
  for (const lane of lanes) {
    const first = lane.find((shift) => shift.count > 0);
    if (first) return { shiftKey: first.key, index: 0 };
  }
  return null;
}

function locate(lanes: NavLanes, shiftKey: string): { lane: number; slot: number } | null {
  for (let lane = 0; lane < lanes.length; lane += 1) {
    const slot = lanes[lane]!.findIndex((shift) => shift.key === shiftKey);
    if (slot !== -1) return { lane, slot };
  }
  return null;
}

/**
 * Where one arrow press lands, or null when it lands nowhere and the cursor should stay put.
 *
 * `dx` and `dy` are -1, 0 or 1, and exactly one of them is non-zero. A cursor pointing at a box
 * that no longer exists resolves to the first box, which is what happens when the row it was on
 * emptied out under it.
 */
export function stepCursor(
  lanes: NavLanes,
  cursor: Cursor | null,
  dx: number,
  dy: number,
): Cursor | null {
  if (!cursor) return firstCursor(lanes);

  const at = locate(lanes, cursor.shiftKey);
  if (!at) return firstCursor(lanes);

  const lane = lanes[at.lane]!;
  const here = lane[at.slot]!;

  if (dx !== 0) {
    for (let slot = at.slot + dx; slot >= 0 && slot < lane.length; slot += dx) {
      const next = lane[slot]!;
      if (next.count === 0) continue;
      // The row keeps its place in the column as far as the next shift is deep enough for it.
      return { shiftKey: next.key, index: Math.min(cursor.index, next.count - 1) };
    }
    return null;
  }

  const within = cursor.index + dy;
  if (within >= 0 && within < here.count) return { shiftKey: here.key, index: within };

  for (let laneIndex = at.lane + dy; laneIndex >= 0 && laneIndex < lanes.length; laneIndex += dy) {
    const candidates = lanes[laneIndex]!.filter((shift) => shift.count > 0);
    if (candidates.length === 0) continue;
    // The same hour if that row has anybody on at that hour, and otherwise the nearest thing to
    // it, so a row of two long shifts and a row of nine short ones still line up.
    const covering = candidates.find((s) => s.start <= here.start && here.start < s.end);
    const target =
      covering ??
      candidates.reduce((best, s) =>
        Math.abs(s.start - here.start) < Math.abs(best.start - here.start) ? s : best,
      );
    return { shiftKey: target.key, index: dy > 0 ? 0 : target.count - 1 };
  }

  return null;
}
