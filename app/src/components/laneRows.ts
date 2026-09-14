/**
 * Which row of a pole's lane each person stands on, across all of that pole's créneaux.
 *
 * WHAT IT FIXES. A créneau draws one box per place, in the order the assignments happen to be
 * in, so somebody working 20h-22h and 22h-minuit in the same pole lands on row 0 of the first
 * and row 2 of the second. The eye reads that as two different people taking over from one
 * another, when it is one person working four hours straight. Keeping their row makes the two
 * boxes line up and the four hours read as what they are.
 *
 * HOW. The créneaux of one lane are walked left to right. Somebody who already has a row in
 * this lane keeps it whenever it is free in the créneau being placed; everybody else takes the
 * lowest row still free. A row nobody claims stays empty and is drawn as a place to fill, which
 * is exactly what it is: the alternative, sliding everybody up, is what breaks the alignment.
 *
 * IT NEVER HIDES ANYBODY AND IT NEVER INVENTS A PLACE. A créneau draws exactly as many rows as
 * the larger of what it asks for and how many people stand in it, which is what it drew before
 * this file existed. So a kept row is offered only while it fits inside that count: somebody
 * whose row would fall past the end of a shorter créneau moves up instead. Drawing one more row
 * to preserve an alignment would put an "à pourvoir" on a créneau that is full, and "à pourvoir"
 * has to mean a place to fill.
 */

export interface LaneShift {
  key: string;
  start: number;
  headcount: number;
  /** The people standing in it, in the order the report lists them. */
  assignees: readonly string[];
}

/** One row of a créneau: whoever stands there, or nobody. */
export type LaneSlots = ReadonlyArray<string | null>;

export function laneRows(shifts: readonly LaneShift[]): Map<string, LaneSlots> {
  const layout = new Map<string, LaneSlots>();
  /** The row each person last held in this lane, so the next créneau can offer it back. */
  const rowOf = new Map<string, number>();

  for (const shift of [...shifts].sort((a, b) => a.start - b.start || a.key.localeCompare(b.key))) {
    // Decided before anybody is placed, so a kept row can never make a créneau grow.
    const size = Math.max(shift.headcount, shift.assignees.length);
    const taken = new Map<number, string>();
    const waiting: string[] = [];

    for (const person of shift.assignees) {
      const kept = rowOf.get(person);
      if (kept !== undefined && kept < size && !taken.has(kept)) taken.set(kept, person);
      else waiting.push(person);
    }

    for (const person of waiting) {
      let row = 0;
      while (taken.has(row)) row += 1;
      taken.set(row, person);
    }

    const slots: Array<string | null> = Array.from({ length: size }, (_, row) => taken.get(row) ?? null);

    for (const [row, person] of taken) rowOf.set(person, row);
    layout.set(shift.key, slots);
  }

  return layout;
}
