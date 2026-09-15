/**
 * Le suivi des candidatures: a status never removes anything by itself, and freeing a cancelled
 * person's places is one explicit edit that takes exactly their places.
 *
 *   npm test    (in app/)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validate, type Plan } from '../engine.ts';
import { normalisePlan } from '../persistence/normalise.ts';
import {
  addApplicationStep,
  placesHeld,
  releasePlaces,
  removeApplicationStep,
  renameApplicationStep,
  setApplicationStatus,
  setApplicationStep,
  setRegieNote,
} from './applicationEdits.ts';

const here = dirname(fileURLToPath(import.meta.url));
const basePlan: Plan = normalisePlan(
  JSON.parse(readFileSync(join(here, '..', '..', 'public', 'fixtures', 'balanced.json'), 'utf8')),
);

const placed = basePlan.assignments[0]!.volunteerKey;

test('a plan written before the tracking opens as candidatures with the default steps', () => {
  assert.ok(basePlan.volunteers.every((v) => v.status === 'candidature' && v.statusSteps!.length === 0));
  assert.deepEqual(basePlan.applicationSteps.map((s) => s.key), ['confirmation', 'reconfirmee', 'infos']);
});

test('cancelling keeps every place and turns them red; releasing takes exactly them', () => {
  const held = placesHeld(basePlan, placed);
  assert.ok(held.shifts > 0);

  const cancelled = setApplicationStatus(basePlan, placed, 'annule');
  assert.equal(cancelled.assignments.length, basePlan.assignments.length, 'rien ne disparaît en silence');
  const red = validate(cancelled).issues.filter((i) => i.code === 'candidature-annulee');
  assert.equal(red.length, 1);

  const released = releasePlaces(cancelled, placed);
  assert.equal(released.assignments.length, basePlan.assignments.length - held.shifts);
  assert.ok(released.assignments.every((a) => a.volunteerKey !== placed));
  assert.equal(validate(released).issues.filter((i) => i.code === 'candidature-annulee').length, 0);
});

test('steps keep the event order, and a renamed step keeps its ticks', () => {
  let plan = setApplicationStep(basePlan, placed, 'infos', true);
  plan = setApplicationStep(plan, placed, 'confirmation', true);
  assert.deepEqual(plan.volunteers.find((v) => v.key === placed)!.statusSteps, ['confirmation', 'infos']);

  plan = renameApplicationStep(plan, 'infos', 'Mail infos importantes');
  plan = removeApplicationStep(plan, 'confirmation');
  plan = addApplicationStep(plan, 'Relance photo trombi');
  assert.deepEqual(plan.applicationSteps.map((s) => s.key), ['reconfirmee', 'infos', 'relance-photo-trombi']);
  assert.deepEqual(plan.volunteers.find((v) => v.key === placed)!.statusSteps, ['confirmation', 'infos']);

  plan = setApplicationStep(plan, placed, 'infos', false);
  assert.deepEqual(plan.volunteers.find((v) => v.key === placed)!.statusSteps, ['confirmation']);
});

test('the note is the régisseur’s and marks no answer as corrected', () => {
  const plan = setRegieNote(basePlan, placed, 'rappeler jeudi');
  const v = plan.volunteers.find((x) => x.key === placed)!;
  assert.equal(v.regieNote, 'rappeler jeudi');
  assert.deepEqual(v.manualFields, basePlan.volunteers.find((x) => x.key === placed)!.manualFields);
});
