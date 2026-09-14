/**
 * What is selected on a planning screen, whichever of the three moments is on screen.
 *
 * WHY ONE TYPE FOR ALL OF THEM. Until 2026-09-11 the exploit's panel knew about exactly one kind
 * of selection, a bénévole's key, and everything else the régisseur could click opened its own
 * unstyled `<aside>` of its own design: an orga fiche here, a box's hours there, a picker
 * somewhere else. Three panels fought over the same column, the third one landed UNDER the grid,
 * and none of them said what it was showing. A selection is one thing at a time and there is one
 * place it is read, so it is one type and one panel. See `InfoPanel`.
 *
 * A KEY AND NEVER AN OBJECT. Every member of this union is a set of keys, so a selection survives
 * the plan being edited under it: the box that was clicked is re-read from the plan on each
 * render, and a selection pointing at something that has since been deleted renders as "plus là"
 * rather than as a stale copy of what it used to say.
 */

import type { PhaseId } from '../engine.ts';

export type Selection =
  /** A bénévole, from a box on any of the three grids, from a pool or from the search box. */
  | { kind: 'benevole'; volunteerKey: string }
  /** An orga, same three ways in. */
  | { kind: 'orga'; organiserKey: string }
  /**
   * A créneau of the exploit.
   *
   * `fill` is set when what was clicked was one of its places to fill rather than the créneau
   * itself: same object, and the panel additionally offers who to put in it.
   */
  | { kind: 'creneau'; shiftKey: string; fill: boolean }
  /** One box of a phase grid: this person, in this pole, for these hours. */
  | { kind: 'case'; phaseId: PhaseId; assignmentKey: string }
  /** An événement of a phase. `fill` as above. */
  | { kind: 'evenement'; phaseId: PhaseId; eventKey: string; fill: boolean };

/** The person a selection is about, when it is about one. Drives the grid's own highlighting. */
export function selectedVolunteerKey(selection: Selection | null): string | null {
  return selection?.kind === 'benevole' ? selection.volunteerKey : null;
}

/**
 * Who a selection is about on a PHASE grid, box included, so their other boxes can be ringed.
 *
 * The exploit has done this since the first version: clicking somebody rings every box they hold,
 * which is how "elle est déjà au bar à 22h" is read off the screen rather than worked out. The
 * phases did not, and the régisseur asked for it on 2026-09-12 in exactly those terms.
 *
 * A box says who is in it, but the panel does not know which phase's box: the caller passes the
 * phase's own assignments, because a `case` selection carries a key and never the row itself.
 */
export function selectedPerson(
  selection: Selection | null,
  assignments: readonly { key: string; personKind: string; personKey: string }[],
): { kind: string; key: string } | null {
  if (selection === null) return null;
  if (selection.kind === 'benevole') return { kind: 'benevole', key: selection.volunteerKey };
  if (selection.kind === 'orga') return { kind: 'orga', key: selection.organiserKey };
  if (selection.kind !== 'case') return null;
  const box = assignments.find((a) => a.key === selection.assignmentKey);
  return box ? { kind: box.personKind, key: box.personKey } : null;
}

/** Whether two selections point at the same thing, which is what a pool row reads to light up. */
export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'benevole':
      return a.volunteerKey === (b as typeof a).volunteerKey;
    case 'orga':
      return a.organiserKey === (b as typeof a).organiserKey;
    case 'creneau':
      return a.shiftKey === (b as typeof a).shiftKey;
    case 'case':
      return a.phaseId === (b as typeof a).phaseId && a.assignmentKey === (b as typeof a).assignmentKey;
    case 'evenement':
      return a.phaseId === (b as typeof a).phaseId && a.eventKey === (b as typeof a).eventKey;
  }
}
