/**
 * What is being dragged, and where it may land.
 *
 * The set of legal targets is computed once, when the drag starts, by asking the engine. It is
 * never recomputed per hover and never approximated by a rule written here. `isLegal` is the
 * same predicate the solver obeys, so the greying on screen and the solver's own opinion cannot
 * disagree.
 *
 * Greying is guidance, not a barrier. An illegal drop is still accepted and then shown in red,
 * because the tool has to show the régisseur what they just did rather than refuse the edit.
 */

import { createContext, useContext } from 'react';

import type { PersonKind } from '../engine.ts';

/**
 * One person, in flight over the exploit's grid.
 *
 * TWO KINDS OF PERSON SINCE 2026-09-12, which is why the fields are `personKey` and `personName`
 * rather than the `volunteerKey` and `volunteerName` they were. An orga can be dragged out of
 * "Disponibles" onto a créneau, exactly as a bénévole is, and onto a pole's own frise to become
 * its responsable. Keeping the old names and passing an orga key through `volunteerKey` would have
 * left every reader of this payload one lookup away from an exception; renaming them is what made
 * the type checker walk all four call sites instead.
 *
 * WHAT THE KIND CHANGES, at the far end: a bénévole is subject to every rule the engine has, so
 * their legal targets are computed by `isLegal` and an illegal drop is drawn in red. An orga is
 * subject to none of them, holds a place through `OrganiserShift`, and every créneau is a legal
 * target for them. See decision 1 in `feature_montage_demontage.md`.
 */
export interface DragPayload {
  kind: PersonKind;
  personKey: string;
  personName: string;
  /** Null when the person is coming from the unassigned list or from the reserve. */
  fromShiftKey: string | null;
  /**
   * True when the box being dragged is pinned.
   *
   * A pinned box is not draggable in the first place, so this should never be true in practice.
   * It is carried anyway because the bin reads it: a screen that offers to delete something the
   * edit layer will refuse is a screen that lies, and one boolean is cheaper than that risk.
   *
   * Never set on an orga: their place in a créneau carries no lock.
   */
  locked?: boolean;
}

export interface DragContextValue {
  payload: DragPayload | null;
  /** Shift keys this person may legally take, once their current box is out of the way. */
  legalShifts: ReadonlySet<string>;
  begin(payload: DragPayload): void;
  end(): void;
}

export const DragContext = createContext<DragContextValue>({
  payload: null,
  legalShifts: new Set<string>(),
  begin: () => {},
  end: () => {},
});

export const useDrag = (): DragContextValue => useContext(DragContext);

/** The MIME type carrying the payload, so a drop from outside the app is ignored. */
export const DRAG_MIME = 'application/x-lototekno-benevole';

/**
 * Set IN ADDITION to `DRAG_MIME` while the person in flight is an orga.
 *
 * A second type rather than a field, because the payload itself is unreadable during a dragover:
 * `dataTransfer.getData` answers an empty string until the drop, and only `types` can be consulted
 * while the pointer is moving. A pole's frise accepts an orga and nothing else, and it has to
 * decide that on hover, before anything is dropped on it.
 */
export const DRAG_MIME_ORGA = 'application/x-lototekno-orga';
