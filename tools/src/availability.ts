/**
 * When a volunteer may actually be placed, and how many hours that leaves room for.
 *
 * This is the piece that surprises people, so it is worth stating once. The rules "at most 4h
 * in a row", "at most 2 blocks" and "at least 2h of break" together impose a minimum *span*,
 * not just a minimum availability:
 *
 *     4h total -> one block            -> needs  4h of span
 *     6h total -> 4h + 2h with a break -> needs  8h of span
 *     8h total -> 4h + 4h with a break -> needs 10h of span
 *
 * Since 2026-09-08 the only thing that narrows the event for a volunteer is the slots they
 * refused, so somebody who refuses one of three six-hour slots keeps a twelve-hour span and can
 * reach 8h if it is contiguous. Refusing the middle slot leaves two six-hour pieces with a
 * six-hour gap, which is 4h + 4h and still reaches 8h. The ceiling only bites on narrower slots
 * than this event has, which is exactly why `allowedVolumes` computes it rather than assuming it.
 */

import {
  type EventSlot,
  type PreferenceSlot,
  type SchedulingRules,
  type SlotId,
  type Window,
} from './model.js';

/** Merges touching or overlapping windows, assuming they arrive sorted by start. */
function merge(windows: Window[]): Window[] {
  const merged: Window[] = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
    } else {
      merged.push({ ...w });
    }
  }
  return merged;
}

/** What is left of `window` once `cut` is taken out of it. Zero, one or two pieces. */
function without(window: Window, cut: Window | null): Window[] {
  if (!cut || cut.end <= window.start || cut.start >= window.end) return [window];
  const pieces: Window[] = [];
  if (cut.start > window.start) pieces.push({ start: window.start, end: cut.start });
  if (cut.end < window.end) pieces.push({ start: cut.end, end: window.end });
  return pieces;
}

/**
 * The windows a volunteer can be placed in, as merged intervals of decimal hours.
 *
 * ONE HARD TIME ANSWER, AND THIS IS IT. Until 2026-09-08 this function also cut the event down
 * to the half the volunteer said they preferred, which made a preference into a wall: somebody
 * who answered "plutôt les concerts" could not be offered a shift at 19h even when the bar was
 * two people short and they would have said yes. The preference is now scored by the solver and
 * costs nothing here. What remains is the refused slots, which is a different question, phrased
 * as an impossibility, and stays absolute.
 *
 * Several refusals since 2026-09-10, because the form asks for them in a sentence and a sentence
 * can name two. Cutting them one after another is what makes "pas avant 18h, et je pars à 2h"
 * come out as the single evening window it is.
 */
export function usableWindows(refused: readonly Window[], lengthHours: number): Window[] {
  let pieces: Window[] = [{ start: 0, end: lengthHours }];
  for (const cut of refused) pieces = pieces.flatMap((piece) => without(piece, cut));
  return merge(pieces.filter((w) => w.end > w.start).sort((x, y) => x.start - y.start));
}

/**
 * The windows of the slots a volunteer refused, in clock order. Empty when they refused none.
 *
 * An id naming a slot that no longer exists is dropped rather than treated as a refusal of
 * nothing-in-particular: removing a slot from Réglages is already a decision the régisseur takes
 * with the count of affected answers in front of them.
 */
export function refusedWindows(
  slots: readonly EventSlot[],
  refusedSlotIds: readonly SlotId[],
): Window[] {
  return refusedSlotIds
    .map((id) => slots.find((s) => s.id === id))
    .filter((slot): slot is EventSlot => slot !== undefined)
    .map((slot) => ({ start: slot.start, end: slot.end }))
    .sort((a, b) => a.start - b.start);
}

/** Hours of `window` inside `[from, to)`. */
const spent = (window: Window, from: number, to: number): number =>
  Math.max(0, Math.min(window.end, to) - Math.max(window.start, from));

/** The tranche a volunteer would rather work, or null when they said "peu importe" or named none. */
export function preferredSlot(
  slots: readonly PreferenceSlot[],
  preferredSlotId: SlotId | null,
): PreferenceSlot | null {
  return preferredSlotId === null ? null : (slots.find((s) => s.id === preferredSlotId) ?? null);
}

/**
 * How far a window works against what the volunteer said they would rather do.
 *
 * Three figures. `tolerated` is the part inside the slot's own "débordement accepté", the band
 * of `overflowHours` on either side of it: the régisseur said that much stretching is fine, and
 * the solver charges it a small, distance-growing price. `against` is the part beyond that band,
 * which contradicts the answer outright and costs enough that it only happens to fill a real
 * hole. `toleratedDistance` is the integral of the distance from the slot's edge over the
 * tolerated part, which is what makes an hour at 21h cheaper than an hour at 22h: the solver
 * reads it rather than recomputing where the edge was.
 *
 * Until 2026-09-13 this knew two words, 'afternoon' and 'evening', and the boundary between
 * them was a rule of the event; the asymmetry the régisseur asked for (the loto may overflow,
 * the concerts may not) is now two slots with two different overflows. A preference naming a
 * slot the plan no longer has costs nothing, the same way a refusal of one stops applying.
 */
export function preferenceMisfit(
  preferred: PreferenceSlot | null,
  window: Window,
): { tolerated: number; against: number; toleratedDistance: number } {
  if (preferred === null || preferred.end <= preferred.start) {
    return { tolerated: 0, against: 0, toleratedDistance: 0 };
  }
  const band = Math.max(0, preferred.overflowHours);
  const before = { start: preferred.start - band, end: preferred.start };
  const after = { start: preferred.end, end: preferred.end + band };
  const tolerated = spent(window, before.start, before.end) + spent(window, after.start, after.end);
  const against =
    spent(window, Number.NEGATIVE_INFINITY, before.start) +
    spent(window, after.end, Number.POSITIVE_INFINITY);
  // ∫ distance-from-edge over each tolerated piece: (d2² - d1²) / 2 with d measured from the edge.
  const beforeFrom = Math.max(before.start, window.start);
  const beforeTo = Math.min(before.end, window.end);
  const afterFrom = Math.max(after.start, window.start);
  const afterTo = Math.min(after.end, window.end);
  const arc = (d1: number, d2: number): number => (d2 > d1 ? (d2 * d2 - d1 * d1) / 2 : 0);
  const toleratedDistance =
    arc(preferred.start - beforeTo, preferred.start - beforeFrom) +
    arc(afterFrom - preferred.end, afterTo - preferred.end);
  return { tolerated, against, toleratedDistance };
}

/**
 * The largest total number of hours that can be placed inside these windows without breaking
 * the block rules. Returns 0 when nothing fits at all.
 */
export function maxAchievableHours(
  windows: readonly Window[],
  rules: SchedulingRules,
  /**
   * Which of the three rhythm rules actually block on this event (Réglages avancés). A rule
   * that only costs cannot make a volume impossible, so it is left out of the ceiling. Absent
   * means all three block, which is every event that never changed them.
   */
  blocking: { maxConsecutive: boolean; maxBlocks: boolean; minBreak: boolean } = {
    maxConsecutive: true,
    maxBlocks: true,
    minBreak: true,
  },
): number {
  const cap = blocking.maxConsecutive ? rules.maxConsecutiveHours : Number.POSITIVE_INFINITY;
  const brk = blocking.minBreak ? rules.minBreakHours : 0;
  const maxBlocks = blocking.maxBlocks ? rules.maxBlocks : Number.POSITIVE_INFINITY;

  // Every block each window could hold, longest first, then the longest `maxBlocks` of them.
  // A window holds full blocks of `cap` separated by the break, then what is left; the gap
  // between two windows is a break already. Written for any cap, break and block count, where
  // the version before 2026-09-14 enumerated the two-block cases of the Loto Tekno's rules.
  const pieces: number[] = [];
  for (const w of windows) {
    const len = w.end - w.start;
    if (len <= 0) continue;
    if (!Number.isFinite(cap)) {
      pieces.push(len);
      continue;
    }
    let left = len;
    while (left > 1e-9 && pieces.length < 1000) {
      pieces.push(Math.min(cap, left));
      left -= cap + brk;
    }
  }
  pieces.sort((a, b) => b - a);
  return pieces.slice(0, Number.isFinite(maxBlocks) ? maxBlocks : pieces.length).reduce((t, p) => t + p, 0);
}

/**
 * The volumes of `options` somebody with these refusals could actually do. The smallest option
 * when none fits, so a picker is never empty.
 */
export function allowedVolumes(
  refused: readonly Window[],
  rules: SchedulingRules,
  lengthHours: number,
  options: readonly number[],
): number[] {
  const ceiling = maxAchievableHours(usableWindows(refused, lengthHours), rules);
  const allowed = options.filter((v) => v <= ceiling);
  return allowed.length > 0 ? allowed : options.slice(0, 1);
}

/** True when the whole shift fits inside one of the volunteer's usable windows. */
export function fitsAvailability(windows: readonly Window[], shift: Window): boolean {
  return windows.some((w) => shift.start >= w.start && shift.end <= w.end);
}
