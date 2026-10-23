/** Les repères de la timeline, 2026-10-23. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Plan } from '../engine.ts';
import { normalisePlan } from '../persistence/normalise.ts';
import { addMarker, deleteMarker, markersIn, setMarker } from './markerEdits.ts';

const here = dirname(fileURLToPath(import.meta.url));
const basePlan: Plan = normalisePlan(
  JSON.parse(readFileSync(join(here, '..', '..', 'public', 'fixtures', 'balanced.json'), 'utf8')),
);

test('a repère is an instant until it has an end after its start, and is listed by moment in clock order', () => {
  let plan = addMarker({ ...basePlan, markers: [] }, 'Pause', 'exploit');
  plan = addMarker(plan, 'Portes', 'exploit');
  plan = addMarker(plan, 'Livraison', 'montage');
  const [pause, portes] = markersIn(plan, 'exploit').map((m) => m.key);
  assert.equal(markersIn(plan, 'exploit').every((m) => m.end === null), true);

  plan = setMarker(plan, pause!, { start: 5, end: 6 });
  plan = setMarker(plan, portes!, { start: 1, end: 0.5 });
  assert.deepEqual(markersIn(plan, 'exploit').map((m) => [m.label, m.start, m.end]), [['Portes', 1, null], ['Pause', 5, 6]]);
  assert.deepEqual(markersIn(plan, 'montage').map((m) => m.label), ['Livraison']);

  plan = deleteMarker(plan, pause!);
  assert.deepEqual(markersIn(plan, 'exploit').map((m) => m.label), ['Portes']);
});

test('a plan without repères loads with none, and a broken one is dropped rather than drawn', () => {
  const loose = JSON.parse(JSON.stringify(basePlan)) as Record<string, unknown>;
  delete loose.markers;
  assert.deepEqual(normalisePlan(loose).markers, []);
  loose.markers = [
    { key: 'ok', label: 'Pause', moment: 'exploit', start: 5, end: 6 },
    { key: 'sans-debut', label: 'X', moment: 'exploit', end: 6 },
    { key: 'envers', label: 'Y', moment: 'nulle-part', start: 4, end: 3 },
  ];
  assert.deepEqual(
    normalisePlan(loose).markers!.map((m) => [m.key, m.moment, m.end]),
    [['ok', 'exploit', 6], ['envers', 'exploit', null]],
  );
});
