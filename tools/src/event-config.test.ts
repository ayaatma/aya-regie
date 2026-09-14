/**
 * Checks on the synthetic event definition itself.
 *
 * Only one thing here is a real feature rather than test scaffolding: a shift may need a
 * different number of people from the rest of its pole, so a rush hour can be staffed as a rush
 * hour. A regression there would be silent, because everything downstream would still run.
 */

import { ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { demandHours } from './model.js';
import { buildPoles, buildShifts } from './event-config.js';

test('a pole carries a default headcount, and its shifts start from it', () => {
  const { poles } = buildPoles();
  const shifts = buildShifts(poles);

  for (const pole of poles) ok(pole.defaultHeadcount > 0, `${pole.path} has no default headcount`);

  const parking = poles.find((p) => p.name === 'Parking')!;
  for (const shift of shifts.filter((s) => s.poleKey === parking.key)) {
    strictEqual(shift.headcount, parking.defaultHeadcount);
  }
});

test('a rush hour carries more people than the rest of its pole', () => {
  const { poles } = buildPoles();
  const shifts = buildShifts(poles);
  const service = poles.find((p) => p.path === 'Bar / Service')!;
  const mine = shifts.filter((s) => s.poleKey === service.key);

  strictEqual(service.defaultHeadcount, 5);
  // 20h to 02h is the rush, 14h to 18h is the quiet start.
  strictEqual(mine.find((s) => s.start === 8)!.headcount, 7);
  strictEqual(mine.find((s) => s.start === 2)!.headcount, 3);
  strictEqual(mine.find((s) => s.start === 14)!.headcount, 5);

  ok(new Set(mine.map((s) => s.headcount)).size >= 3, 'the pole should not be uniform');
});

test('the synthetic event still lands near the 600 person-hours the real one needs', () => {
  const { poles } = buildPoles();
  const total = demandHours(buildShifts(poles));
  ok(total > 550 && total < 650, `${total} person-hours is outside the intended range`);
});
