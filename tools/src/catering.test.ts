/**
 * The catering rules, and the two different ways somebody comes to have a plate.
 *
 * What is actually being pinned here is the pair of defaults: a quota spent on the nearest
 * services during the exploit, a plain overlap during the two phases, and one plate per service
 * however many reasons a person has to be there. Everything else is arithmetic.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CATERING,
  DEFAULT_TICKETING,
  DEFAULT_TRAVEL_RATES,
  DEFAULT_RULES,
  DEFAULT_PREFERENCE_SLOTS,
  DEFAULT_SLOTS,
  absentFromPhase,
  type CateringSettings,
  type MealChoice,
  type Organiser,
  type Pole,
  type Shift,
  type Volunteer,
} from './model.js';
import { DEFAULT_CONSTRAINTS } from './constraints.js';
import { PlanIndex, type Assignment, type Plan } from './plan.js';
import { defaultPhase, type Phase, type PhaseAssignment } from './phase.js';
import {
  cateringReport,
  drinksForHours,
  isStandardDiet,
  mealServices,
  mealsForHours,
  setMealChoice,
} from './catering.js';

const START = '2027-03-13T12:00:00+01:00';
/** Two full days before the event, so the montage's last day IS the day of the exploit. */
const MONTAGE_START = '2027-03-11T08:00:00+01:00';

const pole = (key: string): Pole => ({
  key,
  name: key,
  parentKey: null,
  path: key,
  allowAllDebutants: true,
  minExperienced: 0,
  defaultHeadcount: 4,
});

const shift = (key: string, start: number, end: number): Shift =>
  ({ key, poleKey: 'bar', start, end, headcount: 4 });

const volunteer = (key: string, over: Partial<Volunteer> = {}): Volunteer => ({
  key,
  firstName: key,
  lastName: 'Test',
  nickname: '',
  email: '',
  phone: '',
  accessCode: '',
  diet: '',
  allergies: '',
  requestedHours: 8,
  preferredSlotId: null,
  refusedSlotIds: [],
  availabilityNote: '',
  refusedPoleKeys: [],
  choices: [],
  artistKeys: [],
  buddyRawNames: [],
  manualFields: [],
  needsReview: false,
  reviewReasons: [],
  montage: absentFromPhase(),
  demontage: absentFromPhase(),
  ...over,
});

const organiser = (key: string, over: Partial<Organiser> = {}): Organiser => ({
  key,
  firstName: key,
  lastName: 'Orga',
  email: '',
  phone: '',
  accessCode: '',
  diet: '',
  allergies: '',
  note: '',
  montageFrom: null,
  demontageUntil: null,
  montagePoleKeys: [],
  demontagePoleKeys: [],
  ...over,
});

function makePlan(parts: {
  volunteers?: Volunteer[];
  organisers?: Organiser[];
  shifts?: Shift[];
  assignments?: Assignment[];
  organiserShifts?: Plan['organiserShifts'];
  montage?: Phase;
  catering?: CateringSettings;
}): Plan {
  return {
    name: 'catering',
    startISO: START,
    lengthHours: 18,
    address: '',
    sheetUrl: '',
    rules: DEFAULT_RULES,
    slots: DEFAULT_SLOTS,
    preferenceSlots: DEFAULT_PREFERENCE_SLOTS,
    poles: [pole('bar')],
    shifts: parts.shifts ?? [],
    artists: [],
    organisers: parts.organisers ?? [],
    leaderRoles: [],
    volunteers: parts.volunteers ?? [],
    buddies: [],
    assignments: parts.assignments ?? [],
    reserve: [],
    organiserShifts: parts.organiserShifts ?? [],
    montage: parts.montage ?? defaultPhase('montage', MONTAGE_START),
    demontage: defaultPhase('demontage', START),
    ticketing: DEFAULT_TICKETING,
    travel: DEFAULT_TRAVEL_RATES,
    poleChoicesRanked: true,
    volume: { scope: 'event', dayStartHour: 12, options: [4, 6, 8] },
    formMapping: { columns: {}, answers: {} },
    applicationSteps: [],
    skills: [],
    teamsEnabled: false,
    defaultShiftHours: 2,
    teams: [],
    sideActivities: [],
    equipment: [],
    dismissedBuddies: [],
    constraints: DEFAULT_CONSTRAINTS,
    catering: parts.catering ?? {
      ...DEFAULT_CATERING,
      rules: { ...DEFAULT_CATERING.rules, enabled: true },
    },
  };
}

const report = (plan: Plan) => cateringReport(plan, new PlanIndex(plan));
const takenBy = (plan: Plan, key: string): string[] =>
  report(plan).people.find((p) => p.key === key)?.serviceKeys ?? [];

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

test('the tiers are steps: the highest one reached wins', () => {
  const tiers = [{ fromHours: 4, meals: 1 }, { fromHours: 6, meals: 2 }];
  assert.equal(mealsForHours(0, tiers), 0);
  assert.equal(mealsForHours(3.5, tiers), 0);
  assert.equal(mealsForHours(4, tiers), 1);
  assert.equal(mealsForHours(5, tiers), 1);
  assert.equal(mealsForHours(6, tiers), 2);
  assert.equal(mealsForHours(8, tiers), 2);
});

test('tiers typed in out of order still read as steps', () => {
  // They are entered by hand in Réglages, and "à partir de 6 h" is as likely to be typed first.
  const tiers = [{ fromHours: 6, meals: 2 }, { fromHours: 4, meals: 1 }];
  assert.equal(mealsForHours(4, tiers), 1);
  assert.equal(mealsForHours(6, tiers), 2);
});

test('one drink ticket per full tranche, and none at all when the rule is zero', () => {
  assert.equal(drinksForHours(4, 2), 2);
  assert.equal(drinksForHours(5, 2), 2);
  assert.equal(drinksForHours(8, 2), 4);
  assert.equal(drinksForHours(8, 0), 0);
});

test('the standard plate is recognised however it was written, and nothing else is', () => {
  for (const answer of ['', 'Non', 'aucun', 'Sans restriction', 'sans restrictions', 'Omnivore']) {
    assert.equal(isStandardDiet(answer), true, answer);
  }
  for (const answer of ['Végétarien', 'Sans porc', 'végétalien', 'pas de gluten']) {
    assert.equal(isStandardDiet(answer), false, answer);
  }
});

// ---------------------------------------------------------------------------
// The services
// ---------------------------------------------------------------------------

test('a disabled catering produces no service at all', () => {
  const plan = makePlan({ catering: DEFAULT_CATERING });
  assert.deepEqual(mealServices(plan), []);
});

test('an exploit alone is fed twice: one midi and one soir, on the event day', () => {
  const services = mealServices(makePlan({}));
  assert.equal(services.length, 2);
  assert.deepEqual(services.map((s) => s.windowKey), ['midi', 'soir']);
  assert.equal(services[0]!.dayKey, services[1]!.dayKey);
  for (const service of services) assert.ok(service.inMoment.exploit);
});

test('a meal shared by the montage and the exploit is ONE service, in both moments', () => {
  // The montage runs into the early afternoon of the event day, so its midi and the exploit's
  // midi are the same plate, and the soir belongs to the exploit alone.
  const montage: Phase = { ...defaultPhase('montage', MONTAGE_START), enabled: true, lengthHours: 53 };
  const services = mealServices(makePlan({ montage }));
  const shared = services.filter((s) => s.inMoment.montage && s.inMoment.exploit);

  assert.equal(shared.length, 1, 'midi of the event day, counted once');
  assert.equal(shared[0]!.windowKey, 'midi');
  // One key, so one box and one plate, whichever grid brought the person on site.
  assert.equal(new Set(services.map((s) => s.key)).size, services.length);
});

// ---------------------------------------------------------------------------
// The exploit: a quota, spent on the nearest services
// ---------------------------------------------------------------------------

test('four hours on the exploit earn one meal, and it is the service they work beside', () => {
  const plan = makePlan({
    shifts: [shift('s1', 0, 4)], // 12h to 16h
    volunteers: [volunteer('v1')],
    assignments: [{ volunteerKey: 'v1', shiftKey: 's1', locked: false, source: 'manual' }],
  });
  const person = report(plan).people.find((p) => p.key === 'v1')!;

  assert.equal(person.exploitMeals, 1);
  assert.equal(person.drinks, 2);
  assert.equal(person.serviceKeys.length, 1);
  assert.ok(person.serviceKeys[0]!.endsWith('|midi'));
});

test('the whole quota is spent, on the nearest services first, however far they are', () => {
  // 20h to 02h: six hours, so two meals are owed. Soir is the one they are there for; midi is
  // six hours before they arrive and is ticked all the same, since 2026-09-13: "s'il a droit à
  // 2 repas, les placer les deux les plus proches de ses créneaux". The régisseur unticks it if
  // the person is not there for it.
  const plan = makePlan({
    shifts: [shift('s1', 8, 14)],
    volunteers: [volunteer('v1')],
    assignments: [{ volunteerKey: 'v1', shiftKey: 's1', locked: false, source: 'manual' }],
  });
  const person = report(plan).people.find((p) => p.key === 'v1')!;

  assert.equal(person.exploitMeals, 2, 'owed two');
  assert.deepEqual(person.serviceKeys.map((k) => k.split('|')[1]), ['midi', 'soir'], 'both ticked');
});

test('three hours earn nothing, so nothing is ticked', () => {
  const plan = makePlan({
    shifts: [shift('s1', 0, 3)],
    volunteers: [volunteer('v1')],
    assignments: [{ volunteerKey: 'v1', shiftKey: 's1', locked: false, source: 'manual' }],
  });
  const person = report(plan).people.find((p) => p.key === 'v1')!;
  assert.equal(person.exploitMeals, 0);
  assert.deepEqual(person.serviceKeys, []);
});

test('an orga who works no créneau at all still gets the two meals and the two tickets', () => {
  const plan = makePlan({ organisers: [organiser('o1')] });
  const person = report(plan).people.find((p) => p.key === 'o1')!;

  assert.equal(person.exploitMeals, 2);
  assert.equal(person.drinks, 2);
  assert.equal(person.serviceKeys.length, 2, 'both services of the event day');
});

test('the orga floor lifts and never caps', () => {
  const plan = makePlan({
    shifts: [shift('s1', 0, 8)],
    organisers: [organiser('o1')],
    organiserShifts: [{ key: 'os1', organiserKey: 'o1', shiftKey: 's1' }],
  });
  const person = report(plan).people.find((p) => p.key === 'o1')!;
  assert.equal(person.drinks, 4, 'eight hours beat the floor of two');
});

// ---------------------------------------------------------------------------
// The phases: a presence, not a quota
// ---------------------------------------------------------------------------

/** A montage running from 08:00 two days before the event, with one person placed on it. */
function montageWith(assignments: PhaseAssignment[]): Phase {
  return {
    ...defaultPhase('montage', MONTAGE_START),
    enabled: true,
    volunteersAllowed: true,
    lengthHours: 60,
    assignments,
  };
}

test('somebody on the montage grid across the hour of a meal eats it', () => {
  // Hour 4 to 8 of a montage starting at 08:00 is 12:00 to 16:00 that first day.
  const plan = makePlan({
    volunteers: [volunteer('v1', { montage: { present: true, note: '', windows: [] } })],
    montage: montageWith([
      { key: 'pa1', personKind: 'benevole', personKey: 'v1', poleKey: 'general', eventKey: '', start: 4, end: 8 },
    ]),
  });

  const keys = takenBy(plan, 'v1');
  assert.equal(keys.length, 1);
  assert.ok(keys[0]!.endsWith('|midi'));
});

test('somebody on the montage who leaves before the meal does not eat it', () => {
  const plan = makePlan({
    volunteers: [volunteer('v1', { montage: { present: true, note: '', windows: [] } })],
    montage: montageWith([
      { key: 'pa1', personKind: 'benevole', personKey: 'v1', poleKey: 'general', eventKey: '', start: 0, end: 3 },
    ]),
  });
  assert.deepEqual(takenBy(plan, 'v1'), []);
});

test('a bénévole nobody has placed yet still eats what they declared', () => {
  // 2026-09-12: bénévoles are no longer placed from their answer, so the boxes alone would have
  // left everybody who said "je viens jeudi" off the caterer's sheet entirely. They turn up and
  // expect lunch. The declaration is already narrowed to the window the régisseur opened.
  const plan = makePlan({
    volunteers: [volunteer('v1', { montage: { present: true, note: '', windows: [{ start: 4, end: 8 }] } })],
    montage: montageWith([]),
  });

  const keys = takenBy(plan, 'v1');
  assert.equal(keys.length, 1);
  assert.ok(keys[0]!.endsWith('|midi'));
});

test('once a box exists it decides alone, so a trimmed box takes the meal with it', () => {
  // The régisseur trimmed Thursday to 09h-11h because the person leaves before lunch. Feeding
  // them anyway would be the tool overruling the one person who knows.
  const plan = makePlan({
    volunteers: [volunteer('v1', { montage: { present: true, note: '', windows: [] } })],
    montage: montageWith([
      { key: 'pa1', personKind: 'benevole', personKey: 'v1', poleKey: 'general', eventKey: '', start: 1, end: 3 },
    ]),
  });
  assert.deepEqual(takenBy(plan, 'v1'), []);
});

test('a phase that is switched off feeds nobody, whatever is written in it', () => {
  const plan = makePlan({
    volunteers: [volunteer('v1')],
    montage: { ...montageWith([
      { key: 'pa1', personKind: 'benevole', personKey: 'v1', poleKey: 'general', eventKey: '', start: 4, end: 8 },
    ]), enabled: false },
  });
  assert.deepEqual(takenBy(plan, 'v1'), []);
});

test('one plate for a person who is on site for two reasons at the same service', () => {
  // On the montage on the morning of the event AND working the exploit from midday: the midi of
  // that day is one service, and their exploit quota is spent on it rather than doubled.
  const plan = makePlan({
    shifts: [shift('s1', 0, 4)],
    volunteers: [volunteer('v1', { montage: { present: true, note: '', windows: [] } })],
    assignments: [{ volunteerKey: 'v1', shiftKey: 's1', locked: false, source: 'manual' }],
    montage: montageWith([
      { key: 'pa1', personKind: 'benevole', personKey: 'v1', poleKey: 'general', eventKey: '', start: 52, end: 53 },
    ]),
  });

  const keys = takenBy(plan, 'v1');
  assert.equal(keys.length, 1, 'one plate, not two');
  assert.equal(new Set(keys).size, keys.length);
});

// ---------------------------------------------------------------------------
// What the régisseur decides on top
// ---------------------------------------------------------------------------

test('an unticked box overrides the default and is remembered', () => {
  const base = makePlan({
    shifts: [shift('s1', 0, 4)],
    volunteers: [volunteer('v1')],
    assignments: [{ volunteerKey: 'v1', shiftKey: 's1', locked: false, source: 'manual' }],
  });
  const service = takenBy(base, 'v1')[0]!;

  const choices = setMealChoice(base, 'benevole', 'v1', service, false, true);
  assert.equal(choices.length, 1);

  const plan: Plan = { ...base, catering: { ...base.catering, choices } };
  const person = report(plan).people.find((p) => p.key === 'v1')!;
  assert.deepEqual(person.serviceKeys, []);
  assert.deepEqual(person.handPicked, [service]);
});

test('a decision that agrees with the tool is not stored, so the default stays free to move', () => {
  const base = makePlan({ volunteers: [volunteer('v1')] });
  const service = mealServices(base)[0]!.key;
  const existing: MealChoice[] = [
    { personKind: 'benevole', personKey: 'v1', serviceKey: service, takes: true },
  ];
  const plan: Plan = { ...base, catering: { ...base.catering, choices: existing } };

  assert.deepEqual(setMealChoice(plan, 'benevole', 'v1', service, false, false), []);
});

test('a ticked box against the tool puts somebody in the count who had earned nothing', () => {
  const base = makePlan({ volunteers: [volunteer('v1', { diet: 'Végétarien' })] });
  const service = mealServices(base)[0]!.key;
  const plan: Plan = {
    ...base,
    catering: {
      ...base.catering,
      choices: [{ personKind: 'benevole', personKey: 'v1', serviceKey: service, takes: true }],
    },
  };

  const result = report(plan);
  const fill = result.fills.find((f) => f.service.key === service)!;
  assert.equal(fill.total, 1);
  assert.deepEqual(fill.byDiet, [{ label: 'Végétarien', count: 1 }]);
  assert.equal(result.meals, 1);
});

// ---------------------------------------------------------------------------
// What the caterer reads
// ---------------------------------------------------------------------------

test('the diets and the allergies only list people who actually eat', () => {
  const plan = makePlan({
    shifts: [shift('s1', 0, 4)],
    volunteers: [
      volunteer('mange', { diet: 'Végétarien', allergies: 'Fruits à coque' }),
      volunteer('absent', { diet: 'Végétalien', allergies: 'Gluten' }),
      volunteer('standard', { diet: 'Sans restriction', allergies: 'Non' }),
    ],
    assignments: [
      { volunteerKey: 'mange', shiftKey: 's1', locked: false, source: 'manual' },
      { volunteerKey: 'standard', shiftKey: 's1', locked: false, source: 'manual' },
    ],
  });

  const result = report(plan);
  assert.deepEqual(result.diets.map((d) => d.label), ['Végétarien']);
  assert.deepEqual(result.allergies, [{ name: 'mange Test', text: 'Fruits à coque' }]);
});

test('the totals are the ticked boxes and the tickets, over everybody', () => {
  const plan = makePlan({
    shifts: [shift('s1', 0, 6)],
    organisers: [organiser('o1')],
    volunteers: [volunteer('v1')],
    assignments: [{ volunteerKey: 'v1', shiftKey: 's1', locked: false, source: 'manual' }],
  });

  const result = report(plan);
  // The orga takes both services on the floor alone. The bénévole works midday to six, is owed
  // two, and both are within reach: midi runs inside their créneau and soir opens an hour after
  // it ends, which is somebody eating after their shift rather than a plate nobody collects.
  assert.equal(result.meals, 4);
  assert.equal(result.drinks, 2 + 3);
  assert.deepEqual(result.fills.map((f) => f.total), [2, 2]);
});
