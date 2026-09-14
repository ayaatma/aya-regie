/**
 * The catering edits, against the one thing that makes them different from every other edit here.
 *
 * A ticked box is a DECISION, and a decision has to be told apart from the tool's own reading of
 * the plan. So the tests below are almost all about the same question: what is stored, and what
 * is left free to follow the plan. Storing an agreement would freeze it; dropping a
 * disagreement would lose what a human decided.
 *
 *   npm test    (in app/)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PlanIndex, cateringReport, defaultMealChoices, mealServices, type Plan } from '../engine.ts';
import { normalisePlan } from '../persistence/normalise.ts';
import {
  addService,
  addTier,
  clearMeals,
  deleteService,
  deleteTier,
  serviceRemovalCost,
  setCateringRules,
  setMeal,
  setService,
  setTier,
} from './cateringEdits.ts';

const here = dirname(fileURLToPath(import.meta.url));

const base = normalisePlan(
  JSON.parse(readFileSync(join(here, '..', '..', 'public', 'fixtures', 'balanced.json'), 'utf8')),
);

/** The same plan with the catering switched on, which is where every test below starts. */
const plan: Plan = setCateringRules(base, { enabled: true });

test('no catering edit mutates the plan it was given', () => {
  const before = JSON.stringify(plan);
  setCateringRules(plan, { drinkPerHours: 9 });
  addService(plan, 'Brunch', 10, 12);
  setService(plan, 'midi', { label: 'Déjeuner' });
  deleteService(plan, 'soir');
  addTier(plan);
  setTier(plan, 0, { meals: 9 });
  deleteTier(plan, 0);
  setMeal(plan, 'benevole', plan.volunteers[0]!.key, 'x|midi', true, false);
  clearMeals(plan, 'benevole', plan.volunteers[0]!.key);
  assert.equal(JSON.stringify(plan), before);
});

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

test('a figure is clamped rather than refused', () => {
  const after = setCateringRules(plan, { drinkPerHours: -3, organiserMeals: 2.4 });
  assert.equal(after.catering.rules.drinkPerHours, 0);
  assert.equal(after.catering.rules.organiserMeals, 2);
});

test('switching the catering off keeps every rule behind it', () => {
  const off = setCateringRules(plan, { enabled: false });
  assert.deepEqual(off.catering.rules.exploitTiers, plan.catering.rules.exploitTiers);
  assert.deepEqual(mealServices(off), [], 'et plus aucun service');
});

test('a new service gets a key of its own, and a second one with the same name does not collide', () => {
  const once = addService(plan, 'Brunch', 10, 12);
  const twice = addService(once, 'Brunch', 16, 17);
  const keys = twice.catering.rules.services.map((s) => s.key);
  assert.deepEqual(keys, ['midi', 'soir', 'brunch', 'brunch-2']);
});

test('renaming a service never moves its key, because every ticked box names it', () => {
  const after = setService(plan, 'midi', { label: 'Déjeuner' });
  const service = after.catering.rules.services.find((s) => s.key === 'midi')!;
  assert.equal(service.label, 'Déjeuner');
});

test('an hour outside the clock is brought back onto it', () => {
  const after = setService(plan, 'midi', { fromHour: -2, toHour: 99 });
  const service = after.catering.rules.services.find((s) => s.key === 'midi')!;
  assert.equal(service.fromHour, 0);
  assert.equal(service.toHour, 24);
});

test('a tier can be added, edited and removed without touching its neighbours', () => {
  const added = addTier(plan);
  assert.equal(added.catering.rules.exploitTiers.length, 3);

  const edited = setTier(added, 0, { meals: 5 });
  assert.equal(edited.catering.rules.exploitTiers[0]!.meals, 5);
  assert.deepEqual(edited.catering.rules.exploitTiers[1], added.catering.rules.exploitTiers[1]);

  const removed = deleteTier(edited, 0);
  assert.equal(removed.catering.rules.exploitTiers.length, 2);
  assert.deepEqual(removed.catering.rules.exploitTiers[0], added.catering.rules.exploitTiers[1]);
});

// ---------------------------------------------------------------------------
// One person's plate
// ---------------------------------------------------------------------------

/** Somebody the solver actually placed, so the tool has an opinion about their meals. */
function someoneWhoEats(): { key: string; service: string } {
  const index = new PlanIndex(plan);
  const report = cateringReport(plan, index);
  const person = report.people.find((p) => p.kind === 'benevole' && p.serviceKeys.length > 0);
  assert.ok(person, 'la fixture doit contenir au moins un bénévole qui mange');
  return { key: person.key, service: person.serviceKeys[0]! };
}

test('unticking a box the tool ticked stores the disagreement, and only that', () => {
  const { key, service } = someoneWhoEats();
  const after = setMeal(plan, 'benevole', key, service, false, true);

  assert.deepEqual(after.catering.choices, [
    { personKind: 'benevole', personKey: key, serviceKey: service, takes: false },
  ]);

  const person = cateringReport(after).people.find((p) => p.key === key)!;
  assert.ok(!person.serviceKeys.includes(service));
  assert.deepEqual(person.handPicked, [service]);
});

test('ticking it back stores nothing at all, so it follows the planning again', () => {
  const { key, service } = someoneWhoEats();
  const off = setMeal(plan, 'benevole', key, service, false, true);
  const on = setMeal(off, 'benevole', key, service, true, true);
  assert.deepEqual(on.catering.choices, []);
});

test('a decision survives the person moving somewhere else in the planning', () => {
  const { key, service } = someoneWhoEats();
  const after = setMeal(plan, 'benevole', key, service, false, true);
  // Whatever the planning does next, the row stays: that is the whole point of storing it.
  const moved: Plan = { ...after, assignments: after.assignments.filter((a) => a.volunteerKey !== key) };
  assert.equal(moved.catering.choices.length, 1);
  assert.deepEqual(cateringReport(moved).people.find((p) => p.key === key)!.serviceKeys, []);
});

test('« suivre le planning » drops every decision about one person and nobody else', () => {
  const { key, service } = someoneWhoEats();
  const other = plan.volunteers.find((v) => v.key !== key)!;
  const withBoth = setMeal(
    setMeal(plan, 'benevole', key, service, false, true),
    'benevole',
    other.key,
    service,
    true,
    false,
  );
  assert.equal(withBoth.catering.choices.length, 2);

  const cleared = clearMeals(withBoth, 'benevole', key);
  assert.deepEqual(cleared.catering.choices.map((c) => c.personKey), [other.key]);
});

test('deleting a service says how many decisions it takes with it, then takes them', () => {
  const { key, service } = someoneWhoEats();
  const [, windowKey] = service.split('|');
  const marked = setMeal(plan, 'benevole', key, service, false, true);

  assert.equal(serviceRemovalCost(marked, windowKey!), 1);
  const after = deleteService(marked, windowKey!);
  assert.deepEqual(after.catering.choices, []);
  assert.ok(!after.catering.rules.services.some((s) => s.key === windowKey));
});

test('what the screen draws as a checkbox is what the engine computed for that person', () => {
  // The screen passes `computed` to setMeal, and getting it from anywhere but the engine is how
  // a tick would quietly be stored as a disagreement it is not.
  const index = new PlanIndex(plan);
  const services = mealServices(plan);
  const { key, service } = someoneWhoEats();
  assert.ok(defaultMealChoices(plan, index, services, 'benevole', key).has(service));
});
