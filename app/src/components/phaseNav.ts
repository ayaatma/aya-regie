/**
 * Walking a phase grid with the arrow keys.
 *
 * THE SAME PROMISE AS `gridNav.ts` AND A DIFFERENT GEOMETRY, which is why it is a second file
 * rather than a parameter on the first. The exploit is a lattice: créneaux of fixed length, each
 * holding N places, so a cursor is a créneau plus an index and up is simply the place above. A
 * phase has no lattice at all. A box is one person over one window of their own, boxes are packed
 * into rows by `packRows`, and two boxes on the same row rarely start at the same hour. So down
 * cannot mean "the same index one row lower"; it has to mean **the box nearest in time on the row
 * below**, which is what the eye does when it drops a line.
 *
 * Nothing here knows about React or about the plan. It is a small piece of geometry that is easy
 * to get subtly wrong and impossible to see wrong in a screenshot, so it is tested for what it is.
 */

export interface NavBox {
  /** The `PhaseAssignment` key. What the cursor holds, and what Suppr removes. */
  key: string;
  start: number;
  end: number;
}

/**
 * The drawn rows, top to bottom, each already in clock order.
 *
 * "Drawn" is the whole contract: a row here is a row on screen. An empty row is kept in the list
 * rather than dropped, because a lane with nobody in it still takes a line of the grid and
 * skipping it silently would make Down jump two lanes where the eye expects one.
 */
export type NavRows = readonly (readonly NavBox[])[];

/** The first box there is, for the first arrow press when nothing is selected. */
export function firstBox(rows: NavRows): string | null {
  for (const row of rows) if (row.length > 0) return row[0]!.key;
  return null;
}

function locate(rows: NavRows, key: string): { row: number; slot: number } | null {
  for (let row = 0; row < rows.length; row += 1) {
    const slot = rows[row]!.findIndex((box) => box.key === key);
    if (slot !== -1) return { row, slot };
  }
  return null;
}

/** The box of `row` that starts nearest `hour`, or null when the row is empty. */
function nearest(row: readonly NavBox[], hour: number): NavBox | null {
  let best: NavBox | null = null;
  let bestGap = Infinity;
  for (const box of row) {
    // Zero while the hour falls inside the box, so a box the cursor is already over always wins.
    const gap = hour < box.start ? box.start - hour : hour > box.end ? hour - box.end : 0;
    if (gap < bestGap) {
      best = box;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Where one arrow press lands, or null when it lands nowhere and the cursor should stay put.
 *
 * `dx` and `dy` are -1, 0 or 1, and exactly one of them is non-zero. A cursor pointing at a box
 * that no longer exists resolves to the first box, which is what happens when the box under it
 * was deleted or the day filter moved out from under it.
 *
 * Up and down SKIP EMPTY ROWS rather than stopping on them. There is nothing to select in one and
 * nothing to remove from it, so stopping there is a key press that appears not to work; a lane
 * with nobody in it is still drawn, and the eye passes over it the same way.
 */
export function stepBox(rows: NavRows, current: string | null, dx: number, dy: number): string | null {
  if (current === null) return firstBox(rows);
  const at = locate(rows, current);
  if (!at) return firstBox(rows);

  if (dx !== 0) {
    const next = rows[at.row]![at.slot + dx];
    return next ? next.key : null;
  }

  const from = rows[at.row]![at.slot]!;
  for (let row = at.row + dy; row >= 0 && row < rows.length; row += dy) {
    const landing = nearest(rows[row]!, from.start);
    if (landing) return landing.key;
  }
  return null;
}
