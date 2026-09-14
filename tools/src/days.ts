/**
 * LE VOLUME HORAIRE, ET CE QU'EST UN JOUR, 2026-09-14.
 *
 * Until this date a volunteer's requested hours were for the whole event, and the options were
 * the Loto Tekno form's 4, 6 and 8, written as a type. An event of three days running non-stop
 * asks another question: « combien d'heures par jour ? ». The régisseur's words: a person may
 * work from 2h to 6h in the morning and again from 18h to 22h, and that is not the same day. So
 * each event says two things (`VolumeSettings`):
 *
 *   scope          'event', the requested hours are for the whole event; 'day', for each day.
 *   dayStartHour   the clock hour one day hands over to the next, 12h by default. With 12h, a
 *                  shift from 2h to 6h belongs to the day that started the previous noon, and a
 *                  shift from 18h to 22h the same calendar day belongs to the next one.
 *
 * WHAT COUNTS PER DAY, in day mode: the volume asked (above and below), the floor, the number of
 * blocks, and how many blocks the hours of a day actually require. What stays continuous: the
 * consecutive cap and the minimum break, because a block that runs across the boundary is one
 * stretch of standing up, and a break across the boundary is still the break somebody gets.
 *
 * A SHIFT BELONGS TO THE DAY IT STARTS IN, whole. Splitting a 10h to 14h shift across a 12h
 * boundary would count two hours on each side of it for a person who worked four hours in a row,
 * which is exactly the split the boundary hour was chosen to avoid. A boundary that cuts many
 * shifts is a boundary set at the wrong hour, and the card says so.
 *
 * A DAY COUNTS FOR A VOLUNTEER when their availability leaves room for a real stint in it: at
 * least the floor, or the volume they asked for if that is smaller. A volunteer who refused the
 * whole of Friday is not "under their volume" on Friday. See `PlanIndex.availableDaysOf`.
 */

import type { Window } from './model.js';

export type VolumeScope = 'event' | 'day';

export interface VolumeSettings {
  scope: VolumeScope;
  /** Clock hour, 0 to 24, decimal, at which a day hands over to the next. Local time. */
  dayStartHour: number;
  /**
   * The volumes the form offers, in hours, ascending. What the fiche's volume picker lists and
   * what an import answer is matched against. Per day in day mode. A volunteer's own figure may
   * still be anything: an option removed later never rewrites an answer.
   */
  options: number[];
}

/** The Loto Tekno's: one volume for the event, 4, 6 or 8 hours, days changing at noon. */
export const DEFAULT_VOLUME: VolumeSettings = { scope: 'event', dayStartHour: 12, options: [4, 6, 8] };

/** Hours from the event's start to the first day boundary, in [0, 24). */
export function firstBoundary(startISO: string, dayStartHour: number): number {
  const start = new Date(startISO);
  const clock = start.getHours() + start.getMinutes() / 60 + start.getSeconds() / 3600;
  const offset = (((dayStartHour - clock) % 24) + 24) % 24;
  return offset < 1e-9 ? 0 : offset;
}

/**
 * Which day an hour of the event falls in, 0 being the day the event starts in.
 *
 * An event starting at the boundary hour starts day 0 there; one starting two hours before it
 * has a short day 0 of two hours, then day 1.
 */
export function dayIndexAt(boundary: number, hour: number): number {
  return Math.floor((hour - boundary) / 24 + 1e-9) + (boundary > 0 ? 1 : 0);
}

/** The event's days as windows of event hours, the first and last clipped to the event. */
export function eventDays(startISO: string, lengthHours: number, dayStartHour: number): Window[] {
  const boundary = firstBoundary(startISO, dayStartHour);
  const count = dayIndexAt(boundary, Math.max(0, lengthHours - 1e-6)) + 1;
  const days: Window[] = [];
  for (let d = 0; d < count; d++) {
    const from = boundary > 0 ? (d === 0 ? 0 : boundary + 24 * (d - 1)) : 24 * d;
    const to = boundary > 0 ? boundary + 24 * d : 24 * (d + 1);
    days.push({ start: Math.max(0, from), end: Math.min(lengthHours, to) });
  }
  return days;
}

const WEEKDAY = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

/**
 * "ven. 12/03": the calendar day a day of the event is named after, which is the calendar day it
 * starts on. A day running from Friday noon to Saturday noon is Friday, the way the night of
 * Friday to Saturday is "la soirée du vendredi" on every poster.
 */
export function dayLabel(startISO: string, day: Window): string {
  const middle = new Date(new Date(startISO).getTime() + day.start * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${WEEKDAY[middle.getDay()]} ${pad(middle.getDate())}/${pad(middle.getMonth() + 1)}`;
}
