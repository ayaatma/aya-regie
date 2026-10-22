/**
 * Availability day by day: the arrival and departure questions, a day edited on the fiche, and
 * the days a form ticks for the montage.
 *
 *   npm test
 */

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { defaultPhase, defaultPhaseStart, phaseDays } from './phase.js';
import {
  dayAvailability,
  datesIn,
  parseArrival,
  parseDeparture,
  parsePhaseDays,
  phaseDayTicks,
  splitPhaseDays,
  unavailableFrom,
  withDayAvailability,
} from './presence-days.js';

// The fixtures' event: Saturday 13 March 2027, 12h, for 18 hours.
const START = '2027-03-13T12:00:00+01:00';
const LENGTH = 18;

test('dates are read from words and from numbers, never from a weekday alone', () => {
  deepStrictEqual(datesIn('Mardi 15 septembre (montage), Mercredi 16 septembre'), [
    { day: 15, month: 9 },
    { day: 16, month: 9 },
  ]);
  deepStrictEqual(datesIn('le 1er octobre ou le 03/10'), [{ day: 1, month: 10 }, { day: 3, month: 10 }]);
  deepStrictEqual(datesIn('vendredi'), []);
});

test('an arrival keeps the far edge of its bracket, on the day the question names', () => {
  const q = 'A quelle heure peux-tu arriver samedi 13 mars ?';
  strictEqual(parseArrival(q, 'Entre 14h et 16h', START, LENGTH).value, 4);
  strictEqual(parseArrival(q, 'Avant 14h', START, LENGTH).value, 2);
  // Before the doors open is no constraint at all.
  strictEqual(parseArrival(q, 'Avant 12h', START, LENGTH).value, null);
  // No date anywhere: the first day of the event.
  strictEqual(parseArrival('Heure d’arrivée ?', 'Entre 18h et 20h', START, LENGTH).value, 8);
});

test('a departure keeps the near edge, and past midnight is the same night', () => {
  const q = 'A quelle heure dois-tu repartir dimanche 14 mars ?';
  strictEqual(parseDeparture(q, 'Entre 2h et 4h', START, LENGTH).value, 14);
  strictEqual(parseDeparture(q, 'Après 6h', START, LENGTH).value, null);
  strictEqual(parseDeparture('Heure de départ ?', 'Avant 2h', START, LENGTH).value, 14);
});

test('prose without an hour is no constraint, flagged unless it says why', () => {
  const sure = parseArrival('', 'Je serais présent au montage', START, LENGTH);
  strictEqual(sure.value, null);
  ok(sure.confident);
  const doubt = parseArrival('', 'Ça dépendra de mon travail', START, LENGTH);
  strictEqual(doubt.value, null);
  ok(!doubt.confident && doubt.reason);
  const prose = parseArrival('', 'Ça dépendra, vers 21h si je travaille', START, LENGTH);
  strictEqual(prose.value, 9);
  ok(!prose.confident, 'une heure lue dans une phrase est à relire');
});

test('an arrival and a departure are two windows, and a day rewrites only itself', () => {
  const unavailable = unavailableFrom(4, 14, LENGTH);
  deepStrictEqual(unavailable, [{ start: 0, end: 4 }, { start: 14, end: 18 }]);

  const day = { start: 0, end: 12 };
  deepStrictEqual(dayAvailability(unavailable, day), { present: true, from: 4, to: 12 });
  const absent = withDayAvailability(unavailable, day, null);
  deepStrictEqual(absent, [{ start: 0, end: 12 }, { start: 14, end: 18 }]);
  deepStrictEqual(dayAvailability(absent, day), { present: false, from: 0, to: 12 });
  deepStrictEqual(withDayAvailability(absent, day, { from: 2, to: 10 }), [
    { start: 0, end: 2 },
    { start: 10, end: 12 },
    { start: 14, end: 18 },
  ]);
});

test('the days a form ticks for the montage become those days, and a stray date is flagged', () => {
  const montage = { ...defaultPhase('montage', defaultPhaseStart('montage', START, LENGTH)), enabled: true };
  const days = phaseDays(montage);
  ok(days.length >= 2);
  const second = new Date(new Date(montage.startISO).getTime() + (days[1]!.midnight + 12) * 3600_000);
  const answer = `Jour ${second.getDate()}/${second.getMonth() + 1} (montage)`;

  const reading = parsePhaseDays(answer, montage);
  ok(reading.confident);
  deepStrictEqual(reading.value, days[1]!.segments);
  deepStrictEqual(phaseDayTicks(montage, reading.value).map((t) => t.ticked), days.map((_, i) => i === 1));

  const stray = parsePhaseDays(`${answer}, 25/12`, montage);
  ok(!stray.confident);
  deepStrictEqual(parsePhaseDays("Oui sur l'intégralité", montage).value, []);
});

// The 2026-10 form asks the two phases in one question and ticks days with no month.
const FRIDAY = 'Oui je peux aider le vendredi 12';
const SUNDAY = 'Oui je peux aider le dimanche 14';
const MONDAY = 'Oui je peux aider le lundi 15';
const fixturePhases = () => ({
  montage: { ...defaultPhase('montage', defaultPhaseStart('montage', START, LENGTH)), enabled: true },
  demontage: { ...defaultPhase('demontage', defaultPhaseStart('demontage', START, LENGTH)), enabled: true },
});

test('one question ticking « vendredi 12 » and « lundi 15 » puts each day in its own phase', () => {
  const phases = fixturePhases();
  const montageDays = phaseDays(phases.montage);
  const demontageDays = phaseDays(phases.demontage);

  const friday = splitPhaseDays(FRIDAY, phases)!;
  strictEqual(friday.reason, null);
  deepStrictEqual(friday.montage, { present: true, windows: montageDays[1]!.segments });
  deepStrictEqual(friday.demontage, { present: false, windows: [] });

  const both = splitPhaseDays(`${FRIDAY}, ${SUNDAY}, ${MONDAY}`, phases)!;
  strictEqual(both.reason, null);
  strictEqual(both.montage.present, true);
  deepStrictEqual(both.demontage.windows, [...demontageDays[0]!.segments, ...demontageDays[1]!.segments]);

  strictEqual(splitPhaseDays('Non je ne peux pas', phases), null, 'pas de jour: lu comme des mots');
});

test('a ticked day is never put on the 12th of another month, nor read on a wrong weekday', () => {
  const phases = fixturePhases();
  // The default montage runs from Thursday 11 March, so the 12th is its second day. Friday 12
  // March 2027 is a Friday; « jeudi 12 » is no day of either phase.
  const wrong = splitPhaseDays('Oui je peux aider le jeudi 12', phases)!;
  deepStrictEqual(wrong.montage, { present: true, windows: [] }, 'un oui reste un oui');
  deepStrictEqual(wrong.demontage, { present: true, windows: [] });
  ok(wrong.reason);
  const partly = splitPhaseDays(`${FRIDAY}, Oui je peux aider le jeudi 20`, phases)!;
  strictEqual(partly.montage.present, true);
  strictEqual(partly.demontage.present, false);
  ok(partly.reason);
  // A full date after the weekday is the full date's business, read once.
  deepStrictEqual(parsePhaseDays('vendredi 12 mars', phases.montage).value, phaseDays(phases.montage)[1]!.segments);
  ok(parsePhaseDays('vendredi 12 mars', phases.montage).confident);
});
