/**
 * The Réglages avancés edits, against the one rule that makes them different: an override equal
 * to the default is not stored. And the round trip through `normalisePlan`, which is what a plan
 * from the database goes through.
 *
 *   npm test    (in app/)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_RULES, isLegal, newEventPlan, PlanIndex, resolveConstraints, validate, type Plan } from '../engine.ts';
import { normalisePlan } from '../persistence/normalise.ts';
import {
  changedCriteria,
  isDefaultCard,
  resetAdvancedSettings,
  resetCriterion,
  setCriterion,
  setLongDay,
} from './constraintEdits.ts';
import { setRules } from './setupEdits.ts';
import { addBuddy, removeBuddy } from './edits.ts';

const here = dirname(fileURLToPath(import.meta.url));

const plan: Plan = normalisePlan(
  JSON.parse(readFileSync(join(here, '..', '..', 'public', 'fixtures', 'balanced.json'), 'utf8')),
);

test('a plan from before the card opens on the defaults, and a stored one comes back whole', () => {
  assert.deepEqual(plan.constraints.criteria, {});
  assert.equal(plan.constraints.longDayHours, 6);
  assert.ok(isDefaultCard(plan));

  const edited = setLongDay(setCriterion(plan, 'refusedPole', { mode: 'weight', weight: 900 }), { longDayHours: 5 });
  const back = normalisePlan(JSON.parse(JSON.stringify(edited)));
  assert.deepEqual(back.constraints, edited.constraints);
});

test('choosing the default again stores nothing, field by field', () => {
  const weighted = setCriterion(plan, 'buddy', { weight: 7000 });
  assert.deepEqual(weighted.constraints.criteria.buddy, { weight: 7000 });
  const off = setCriterion(weighted, 'buddy', { mode: 'off' });
  assert.deepEqual(off.constraints.criteria.buddy, { mode: 'off', weight: 7000 });
  const back = setCriterion(setCriterion(off, 'buddy', { mode: 'weight' }), 'buddy', { weight: 5000 });
  assert.equal('buddy' in back.constraints.criteria, false);
  assert.equal(changedCriteria(back), 0);
});

test('a mode the criterion cannot take is not stored', () => {
  assert.equal('floor' in setCriterion(plan, 'floor', { mode: 'block' }).constraints.criteria, false);
});

test('the normaliser drops what the engine does not know, and keeps what it does', () => {
  const raw = JSON.parse(JSON.stringify(plan));
  raw.constraints = {
    criteria: { unknown: { mode: 'block' }, artist: { mode: 'block', weight: 'x' }, buddy: { weight: -1 } },
    longDayHours: 0,
  };
  const back = normalisePlan(raw);
  assert.deepEqual(back.constraints.criteria, { artist: { mode: 'block' } });
  assert.equal(back.constraints.longDayHours, 6);
  assert.equal(back.constraints.veryLongDayHours, 8);
});

test('a refused pole made a weight opens the drop targets the grid used to grey, and says so', () => {
  const index = new PlanIndex({ ...plan, assignments: [] });
  const refuser = plan.volunteers.find((v) => v.refusedPoleKeys.length > 0);
  assert.ok(refuser, 'la fixture doit contenir un refus de pôle');
  const shift = plan.shifts.find((s) => refuser.refusedPoleKeys.some((root) => index.isUnder(s.poleKey, root)));
  assert.ok(shift);
  const blocked = { ...plan, assignments: [] };
  const weighed = setCriterion(blocked, 'refusedPole', { mode: 'weight' });
  assert.equal(isLegal(new PlanIndex(blocked), refuser, shift), false);
  assert.equal(resolveConstraints(weighed.constraints).refusedPole.mode, 'weight');
  const placed = { ...weighed, assignments: [{ volunteerKey: refuser.key, shiftKey: shift.key, locked: true, source: 'manual' as const }] };
  const tiers = validate(placed).issues.filter((i) => i.code === 'pole-refuse').map((i) => i.tier);
  assert.deepEqual(tiers, [2]);
});

test('resetting a row forgets its override; resetting the card also puts the thresholds back', () => {
  const edited = setRules(setCriterion(plan, 'maxBlocks', { mode: 'weight' }), { maxBlocks: 3 });
  assert.equal(resetCriterion(edited, 'maxBlocks').constraints.criteria.maxBlocks, undefined);
  assert.equal(isDefaultCard(edited), false);
  const reset = resetAdvancedSettings(edited);
  assert.ok(isDefaultCard(reset));
  assert.deepEqual(reset.rules, DEFAULT_RULES);
});

test('a very long day is never shorter than a long one', () => {
  const edited = setLongDay(plan, { longDayHours: 7, veryLongDayHours: 5 });
  assert.equal(edited.constraints.veryLongDayHours, 7);
});

test('a new event speaks of no loto: no tranche, no pole, and it stays that way through storage', () => {
  const fresh = normalisePlan(JSON.parse(JSON.stringify(newEventPlan('Festival', new Date(2027, 5, 1, 9, 0)))));
  assert.deepEqual(fresh.slots, []);
  assert.deepEqual(fresh.preferenceSlots, []);
  assert.deepEqual(fresh.poles, []);
  assert.equal(fresh.lengthHours, 12);
  assert.equal(new Date(fresh.startISO).getDate(), 2, 'le lendemain, à midi');
  assert.equal(new Date(fresh.startISO).getHours(), 12);
  // An old plan with no tranche key at all still gets the ones its volunteers answered against.
  const old = normalisePlan({ name: 'ancien' });
  assert.equal(old.slots.length, 3);
});

test('a binôme added by hand survives a re-import, and one removed by hand stays removed', () => {
  const [a, b, c] = plan.volunteers;
  const added = addBuddy(plan, a!.key, c!.key);
  assert.ok(added.buddies.some((p) => p.fromKey === a!.key && p.toKey === c!.key && p.manual));
  const existing = plan.buddies[0];
  if (existing) {
    const removed = removeBuddy(added, existing.fromKey, existing.toKey);
    assert.ok(removed.dismissedBuddies.some((p) => p.fromKey === existing.fromKey && p.toKey === existing.toKey));
    assert.ok(!removed.buddies.some((p) => p.fromKey === existing.fromKey && p.toKey === existing.toKey && !p.manual));
  }
  const again = removeBuddy(added, a!.key, c!.key);
  assert.equal(again.dismissedBuddies.length, added.dismissedBuddies.length, 'un binôme ajouté à la main ne laisse rien derrière lui');
  assert.equal(addBuddy(plan, b!.key, b!.key), plan, 'pas de binôme avec soi-même');
});
