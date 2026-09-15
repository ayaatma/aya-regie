/**
 * Availability day by day, 2026-09-15 (roadmap item 7).
 *
 * WHY. A festival over several days asks « À quelle heure peux-tu arriver vendredi ? », « À quelle
 * heure dois-tu repartir dimanche ? » and, for the montage, ticks the days somebody comes. The tool
 * knew refused tranches for the exploit and one « à partir de » for a phase. The régisseur asked
 * for availability held day by day in the tool, whatever coarser shape the form gives it.
 *
 * TWO SHAPES, one per world, and neither replaces what exists:
 *
 *   exploit   `Volunteer.unavailable`: windows of the event somebody is not there, on top of the
 *             refused tranches. An arrival is the window before it, a departure the window after,
 *             a day off the whole day. The fiche edits it one day at a time (`dayAvailability`,
 *             `withDayAvailability`); `PlanIndex.windowsOf` subtracts it like a refusal, so every
 *             rule and the solver read it through `hors-disponibilite` with nothing new to learn.
 *   phases    `PhasePresence.windows`, which already existed: the days ticked become the union of
 *             those days' worked hours (`parsePhaseDays`, `phaseDayWindows`).
 *
 * THE DATE COMES FROM THE WORDS, never from an assumed weekday: « vendredi 18 septembre » in a
 * question is a date, « vendredi » alone is not (an event moves by a week three months out). A
 * question naming no date falls back to the event's first day for an arrival and its last day for
 * a departure, which is what those two questions mean on every form seen so far.
 */

import type { Window } from './model.js';
import { mergeWindows, phaseDays, subtractWindows, clipWindows, type Phase } from './phase.js';
import { normalise } from './text.js';
import type { AnswerReading } from './answers.js';

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

/** A calendar day, month 1 to 12, year possibly unknown. */
interface CalendarDay {
  day: number;
  month: number;
}

/** Every calendar day a text names, in order: « 18 septembre », « 1er octobre », « 18/09 ». */
export function datesIn(text: string): CalendarDay[] {
  const v = normalise(text);
  const found: Array<CalendarDay & { at: number }> = [];
  const words = new RegExp(`\\b(\\d{1,2})(?:er)? (${MONTHS.join('|')})\\b`, 'g');
  for (const m of v.matchAll(words)) {
    found.push({ day: Number(m[1]), month: MONTHS.indexOf(m[2]!) + 1, at: m.index ?? 0 });
  }
  // The raw text for the numeric form: `normalise` turns « 18/09 » into « 18 09 ».
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g)) {
    found.push({ day: Number(m[1]), month: Number(m[2]), at: m.index ?? 0 });
  }
  return found
    .filter((d) => d.day >= 1 && d.day <= 31 && d.month >= 1 && d.month <= 12)
    .sort((a, b) => a.at - b.at)
    .map(({ day, month }) => ({ day, month }));
}

/**
 * Hours from `startISO` to a wall clock on a calendar day, the year being the one that puts the
 * day nearest the start (an event on 2 January read from a December form). Local time, like every
 * other date the tool reads: see `parsePhaseMoment`.
 */
export function hoursAtDay(startISO: string, date: CalendarDay, hour: number, minute = 0): number | null {
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return null;
  let best: number | null = null;
  for (const year of [start.getFullYear() - 1, start.getFullYear(), start.getFullYear() + 1]) {
    const at = new Date(year, date.month - 1, date.day, hour, minute, 0, 0);
    const h = (at.getTime() - start.getTime()) / 3600_000;
    if (best === null || Math.abs(h) < Math.abs(best)) best = h;
  }
  return best;
}

/** The calendar day an offset of the event falls on. */
function calendarOf(startISO: string, hours: number): CalendarDay {
  const at = new Date(new Date(startISO).getTime() + hours * 3600_000);
  return { day: at.getDate(), month: at.getMonth() + 1 };
}

const sure = <T>(value: T): AnswerReading<T> => ({ value, confident: true, reason: null });
const unsure = <T>(value: T, reason: string): AnswerReading<T> => ({ value, confident: false, reason });

/** Hours written in an answer, « 14h », « 14 h 30 », « 20h / 22h », in order. */
function clockHours(v: string): number[] {
  const out: number[] = [];
  for (const m of v.matchAll(/(\d{1,2})\s*h\s*(\d{2})?/g)) {
    const hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    if (hour <= 24 && minute < 60) out.push(hour + minute / 60);
  }
  return out;
}

/** Answers that say « no constraint »: already on site, no fixed hour, staying for the next phase. */
const NO_CONSTRAINT = /montage|demontage|deja (la|present|sur place)|pas d ?imperatif|pas forcement|je serai(s)? la|aucune? contrainte|pas de contrainte/;

/**
 * An arrival or a departure question, read into the one hour it sets.
 *
 * CONSERVATIVE BOTH WAYS, since a bracket is a promise about its far edge only: « entre 14h et
 * 16h » for an arrival means sure to be there from 16h, for a departure sure to be there until
 * 14h. « Avant 14h » arriving is 14h; « après 18h » leaving is 18h. Null is no constraint.
 *
 * `edge`: the event's first day for an arrival, its last for a departure, when neither the
 * question nor the answer names a date.
 */
function parseMoment(
  kind: 'arrival' | 'departure',
  header: string,
  answer: string,
  startISO: string,
  lengthHours: number,
): AnswerReading<number | null> {
  const v = normalise(answer);
  if (v === '') return sure(null);
  const hours = clockHours(v);
  const what = kind === 'arrival' ? 'Arrivée' : 'Départ';

  if (hours.length === 0) {
    if (NO_CONSTRAINT.test(v)) return sure(null);
    return unsure(null, `${what}: « ${answer.trim()} » ne donne pas d'heure. Aucune contrainte retenue, à vérifier sur la fiche.`);
  }

  const date =
    datesIn(answer)[0] ??
    datesIn(header)[0] ??
    calendarOf(startISO, kind === 'arrival' ? 0 : Math.max(0, lengthHours - 1e-6));
  // The far edge of what was said: the latest hour for an arrival, the earliest for a departure.
  const clock = kind === 'arrival' ? Math.max(...hours) : Math.min(...hours);
  const whole = Math.floor(clock);
  let at = hoursAtDay(startISO, date, whole, Math.round((clock - whole) * 60));
  if (at === null) return unsure(null, `${what}: « ${answer.trim()} » illisible.`);
  // A departure « avant 2h » on the last day of an event running past midnight is that night.
  if (kind === 'departure' && at < 0) at += 24;

  if (at < -24 || at > lengthHours + 24) {
    return unsure(null, `${what}: « ${answer.trim()} » tombe hors de l'événement. Aucune contrainte retenue.`);
  }
  const clamped = Math.min(Math.max(0, at), lengthHours);
  // Prose with an hour in it (« vers 21h si j'ai un emploi ») is read, and flagged.
  const plain = /^(avant|apres|entre|vers|a partir de|des|jusqu a)?\s*\d/.test(v) || /^\d{1,2}\s*h/.test(v);
  return plain
    ? sure(clamped <= 1e-9 && kind === 'arrival' ? null : clamped >= lengthHours - 1e-9 && kind === 'departure' ? null : clamped)
    : unsure(clamped, `${what} lue à ${Math.round(clamped * 100) / 100} h de l'événement d'après « ${answer.trim()} ». À vérifier.`);
}

export const parseArrival = (header: string, answer: string, startISO: string, lengthHours: number) =>
  parseMoment('arrival', header, answer, startISO, lengthHours);

export const parseDeparture = (header: string, answer: string, startISO: string, lengthHours: number) =>
  parseMoment('departure', header, answer, startISO, lengthHours);

/** The unavailable windows an arrival and a departure mean. */
export function unavailableFrom(arrival: number | null, departure: number | null, lengthHours: number): Window[] {
  const out: Window[] = [];
  if (arrival !== null && arrival > 1e-9) out.push({ start: 0, end: Math.min(arrival, lengthHours) });
  if (departure !== null && departure < lengthHours - 1e-9) out.push({ start: Math.max(0, departure), end: lengthHours });
  return mergeWindows(out);
}

// ---------------------------------------------------------------------------
// The fiche, one day at a time
// ---------------------------------------------------------------------------

/**
 * What a day looks like through `unavailable`: absent, or present from `from` to `to` (the first
 * and last available hour of the day). Only the outer edges are shown: a hole in the middle of a
 * day is a refused tranche's business, which the fiche shows beside it.
 */
export function dayAvailability(unavailable: readonly Window[], day: Window): { present: boolean; from: number; to: number } {
  const free = subtractWindows([day], unavailable);
  if (free.length === 0) return { present: false, from: day.start, to: day.end };
  return { present: true, from: free[0]!.start, to: free[free.length - 1]!.end };
}

/**
 * `unavailable` with one day rewritten: absent (null), or present from `from` to `to`. Every other
 * day is kept exactly as it was.
 */
export function withDayAvailability(
  unavailable: readonly Window[],
  day: Window,
  value: { from: number; to: number } | null,
): Window[] {
  const others = subtractWindows(unavailable, [day]);
  const off =
    value === null
      ? [day]
      : subtractWindows([day], [{ start: Math.max(day.start, value.from), end: Math.min(day.end, value.to) }]);
  return mergeWindows([...others, ...off]);
}

// ---------------------------------------------------------------------------
// The phases: days ticked
// ---------------------------------------------------------------------------

/** The worked hours of the phase days whose calendar date is in `dates`. */
export function phaseDayWindows(phase: Phase, dates: readonly CalendarDay[]): Window[] {
  const wanted = new Set(dates.map((d) => `${d.day}/${d.month}`));
  return mergeWindows(
    phaseDays(phase)
      .filter((day) => {
        // Noon of that calendar day: a first day whose midnight is before the phase start is still that day.
        const c = calendarOf(phase.startISO, day.midnight + 12);
        return wanted.has(`${c.day}/${c.month}`);
      })
      .flatMap((day) => day.segments),
  );
}

/**
 * « Mardi 15 septembre (montage), Mercredi 16 septembre (montage) »: the days ticked, as windows.
 *
 * Empty for an answer naming no date, which `PhasePresence` reads as the whole opening, and for an
 * answer taking everything (« l'intégralité »). A date the phase does not have is reported: the
 * form and the phase disagree, and only the régisseur knows which one moved.
 */
export function parsePhaseDays(raw: string, phase: Phase): AnswerReading<Window[]> {
  const dates = datesIn(raw);
  if (dates.length === 0 || /integralite|tous les jours/.test(normalise(raw))) return sure([]);
  const windows = phaseDayWindows(phase, dates);
  const matched = dates.filter((d) => phaseDayWindows(phase, [d]).length > 0).length;
  if (matched === dates.length) return sure(windows);
  const label = phase.label || (phase.id === 'montage' ? 'Montage' : 'Démontage');
  return {
    value: windows,
    confident: false,
    reason: `${label}: ${dates.length - matched} jour(s) de « ${raw.trim()} » hors des dates de la phase. À vérifier.`,
  };
}

/** The phase days, with whether this presence covers each, for the fiche's ticks. */
export function phaseDayTicks(
  phase: Phase,
  windows: readonly Window[],
): Array<{ index: number; label: string; segments: Window[]; ticked: boolean }> {
  return phaseDays(phase).map((day) => ({
    index: day.index,
    label: day.label,
    segments: day.segments,
    ticked: windows.length === 0 || clipWindows(windows, { start: day.midnight, end: day.midnight + 24 }).length > 0,
  }));
}
