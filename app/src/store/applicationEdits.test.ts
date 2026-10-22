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
  addDefaultSteps,
  missingDefaultSteps,
  setStepMail,
} from './applicationEdits.ts';

const here = dirname(fileURLToPath(import.meta.url));
const basePlan: Plan = normalisePlan(
  JSON.parse(readFileSync(join(here, '..', '..', 'public', 'fixtures', 'balanced.json'), 'utf8')),
);

const placed = basePlan.assignments[0]!.volunteerKey;

test('a plan written before the tracking opens as candidatures with the default steps', () => {
  assert.ok(basePlan.volunteers.every((v) => v.status === 'candidature' && v.statusSteps!.length === 0));
  // The defaults of 2026-10-22: three steps by mail, the validation mail being recorded by itself.
  assert.deepEqual(basePlan.applicationSteps.map((s) => s.key), ['heures-supp', 'planning', 'infos']);
  assert.ok(basePlan.applicationSteps.every((s) => s.mail !== undefined));
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
  // The steps of an event set up on 2026-09-15, ticked by hand.
  const older: Plan = {
    ...basePlan,
    applicationSteps: [
      { key: 'confirmation', label: 'Mail de confirmation envoyé' },
      { key: 'reconfirmee', label: 'Présence reconfirmée' },
      { key: 'infos', label: 'Infos pratiques envoyées' },
    ],
  };
  let plan = setApplicationStep(older, placed, 'infos', true);
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

test('an event of 2026-09-15 gets the steps by mail on demand, keeping its own « infos »', () => {
  const older: Plan = {
    ...basePlan,
    applicationSteps: [
      { key: 'confirmation', label: 'Mail de confirmation envoyé' },
      { key: 'infos', label: 'Infos pratiques envoyées' },
    ],
  };
  assert.equal(missingDefaultSteps(older), 3, 'two to add, one to give a mail');
  const upgraded = addDefaultSteps(older);
  assert.deepEqual(upgraded.applicationSteps.map((s) => s.key), ['confirmation', 'infos', 'heures-supp', 'planning']);
  const infos = upgraded.applicationSteps.find((s) => s.key === 'infos')!;
  assert.equal(infos.label, 'Infos pratiques envoyées', 'its own name stays');
  assert.equal(infos.mail?.reply, 'aucune');
  assert.equal(upgraded.applicationSteps[0]!.mail, undefined, 'a step of its own is left alone');
  assert.equal(missingDefaultSteps(upgraded), 0);

  const plain = setStepMail(upgraded, 'planning', undefined);
  assert.deepEqual(plain.applicationSteps.find((s) => s.key === 'planning'), { key: 'planning', label: 'Planning' });
});

test('a step and its mail survive the normaliser, and a broken mail is dropped', () => {
  const round = normalisePlan(JSON.parse(JSON.stringify({ ...basePlan, applicationSteps: [
    { key: 'a', label: 'A', mail: { subject: 'S', body: 'B', placedOnly: false, minRequestedHours: 6, reply: 'oui-non', question: 'Q ?' } },
    { key: 'b', label: 'B', mail: 'nonsense' },
    { key: 'c', label: 'C', mail: { reply: 'peut-etre', minRequestedHours: -2 } },
  ] })));
  assert.deepEqual(round.applicationSteps[0], {
    key: 'a', label: 'A', mail: { subject: 'S', body: 'B', placedOnly: false, minRequestedHours: 6, reply: 'oui-non', question: 'Q ?' },
  });
  assert.deepEqual(round.applicationSteps[1], { key: 'b', label: 'B' });
  assert.equal(round.applicationSteps[2]!.mail?.reply, 'aucune');
  assert.equal(round.applicationSteps[2]!.mail?.minRequestedHours, 0);
  assert.equal(round.applicationSteps[2]!.mail?.placedOnly, true);
});
