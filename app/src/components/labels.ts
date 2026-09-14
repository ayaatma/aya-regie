/**
 * The French names for the things a volunteer answered on the form.
 *
 * One copy, because three screens were spelling the same three time slots slightly differently
 * and the régisseur reads all three.
 */

import type { EventSlot, Organiser, PreferenceSlot, SlotId } from '../engine.ts';

/**
 * A organiser's name, as one string.
 *
 * `trim` is not decoration. Organisers entered by hand before 2026-09-09 carry their whole name in
 * `lastName` with `firstName` empty, on purpose: see `splitLegacyOrganisers` in `normalise.ts`,
 * which refuses to guess where a first name ends. Joining without trimming would print a leading
 * space in front of every one of them.
 */
export const organiserName = (organiser: Organiser): string =>
  `${organiser.firstName} ${organiser.lastName}`.trim();

/**
 * What a slot is called, from the plan rather than from a constant.
 *
 * Slots are the régisseur's to word, because they are the form's own questions. A volunteer's
 * `refusedSlotIds` names them by id; a slot that has since been removed keeps its id as the
 * label,
 * so a stale answer reads as itself instead of vanishing.
 */
export const slotLabel = (slots: readonly EventSlot[], id: SlotId): string =>
  slots.find((s) => s.id === id)?.label ?? id;

/**
 * What they answered to "Qu'est ce que tu préfères ?". Null is an answer, not a blank.
 *
 * Worded as a preference on purpose. It reads "préfère « Loto »" and not "Loto", because since
 * 2026-09-08 it no longer says when somebody is available: it says what they would rather do,
 * and the régisseur can place them anywhere. A label that still sounded like a constraint would
 * keep suggesting a rule that is not there any more. The tranche's name comes from the plan
 * since 2026-09-13, like a refused slot's, and one that has since been removed reads as its id.
 */
export function preferenceLabel(slots: readonly PreferenceSlot[], id: SlotId | null): string {
  if (id === null) return 'sans préférence';
  return `préfère « ${slots.find((s) => s.id === id)?.label ?? id} »`;
}
