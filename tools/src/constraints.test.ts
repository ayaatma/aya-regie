/**
 * Réglages avancés: every criterion blocks, costs or says nothing as the event decides.
 *
 *   npm test
 *
 * Micro-plans again, one question each. The defaults are held to the measured weights first,
 * because an event that never opens the card must solve exactly as it did before the card existed.
 */

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_CATERING,
  DEFAULT_PREFERENCE_SLOTS,
  DEFAULT_RULES,
  DEFAULT_SLOTS,
  DEFAULT_TICKETING,
  DEFAULT_TRAVEL_RATES,
  absentFromPhase,
  type Pole,
  type Shift,
  type Volunteer,
} from './model.js';
import { withChoices, type TestVolunteer } from './test-volunteers.js';
import {
  CRITERIA,
  DEFAULT_CONSTRAINTS,
  resolveConstraints,
  type ConstraintSettings,
  type CriterionId,
  type CriterionOverride,
} from './constraints.js';
import { defaultPhase } from './phase.js';
import { dayIndexAt, eventDays, firstBoundary, type VolumeSettings } from './days.js';
import { PlanIndex, type Assignment, type Plan } from './plan.js';
import { DEFAULT_WEIGHTS, solve } from './solver.js';
import { TIER1, TIER2, blockersFor, costsFor, isLegal, validate } from './validate.js';

const pole = (key: string, over: Partial<Pole> = {}): Pole => ({
  key, name: key, parentKey: null, path: key,
  allowAllDebutants: true, minExperienced: 0, defaultHeadcount: 1, ...over,
});

const shift = (key: string, poleKey: string, start: number, end: number, headcount = 1): Shift =>
  ({ key, poleKey, start, end, headcount });

const volunteer = (key: string, over: Partial<TestVolunteer> = {}): Volunteer => withChoices({
  key, firstName: key, lastName: 'Test', nickname: '', email: '', phone: '', accessCode: '',
  diet: '', allergies: '', requestedHours: 8, preferredSlotId: null, refusedSlotIds: [],
  availabilityNote: '', refusedPoleKeys: [], choice1PoleKey: 'bar',  choice1Level: 'expert', choice2PoleKey: 'secu', choice2Level: 'expert',
  artistKeys: [], buddyRawNames: [], manualFields: [], needsReview: false, reviewReasons: [],
  montage: absentFromPhase(), demontage: absentFromPhase(), ...over,
});

const assign = (volunteerKey: string, shiftKey: string): Assignment =>
  ({ volunteerKey, shiftKey, locked: false, source: 'manual' });

function makePlan(parts: {
  shifts: Shift[];
  volunteers: Volunteer[];
  assignments?: Assignment[];
  criteria?: Partial<Record<CriterionId, CriterionOverride>>;
  longDay?: Partial<ConstraintSettings>;
  volume?: Partial<VolumeSettings>;
  lengthHours?: number;
  startISO?: string;
}): Plan {
  const start = parts.startISO ?? '2027-03-13T12:00:00+01:00';
  return {
    name: 'test', startISO: start, lengthHours: parts.lengthHours ?? 18, address: '', sheetUrl: '',
    rules: DEFAULT_RULES, catering: DEFAULT_CATERING, ticketing: DEFAULT_TICKETING,
    travel: DEFAULT_TRAVEL_RATES,
    poleChoicesRanked: true,
    volume: { scope: 'event', dayStartHour: 12, options: [4, 6, 8], ...parts.volume },
    formMapping: { columns: {}, answers: {} },
    applicationSteps: [],
    dismissedBuddies: [],
    constraints: { ...DEFAULT_CONSTRAINTS, ...parts.longDay, criteria: parts.criteria ?? {} },
    slots: DEFAULT_SLOTS, preferenceSlots: DEFAULT_PREFERENCE_SLOTS,
    poles: [pole('bar'), pole('secu'), pole('propre')],
    shifts: parts.shifts, artists: [], organisers: [], leaderRoles: [],
    volunteers: parts.volunteers, buddies: [], assignments: parts.assignments ?? [], reserve: [],
    organiserShifts: [],
    montage: defaultPhase('montage', start), demontage: defaultPhase('demontage', start),
  };
}

const tierOfCode = (plan: Plan, code: string): number[] =>
  validate(plan).issues.filter((i) => i.code === code).map((i) => i.tier);

// ---------------------------------------------------------------------------

test('the defaults are the weights measured before the card existed, and nothing more blocks', () => {
  deepStrictEqual({ ...DEFAULT_WEIGHTS }, {
    floorBelow: 30000, floorPerHour: 2000, reserve: 20000, staffing: 3000,
    poleFragmentation: 2500, blockSplit: 1200, allDebutants: 600, minExperienced: 600,
    outsideChoice: 700, volume: 60, artist: 50, buddy: 5000, choice2: 100, debutantStacking: 8,
    overflow: 6, againstPreference: 1500, stability: 200,
    refusedPole: 0, availability: 0, volumeOver: 0, maxConsecutive: 0, maxBlocks: 0, minBreak: 0,
  });
  const blocking = CRITERIA.filter((c) => c.defaultMode === 'block').map((c) => c.id).sort();
  deepStrictEqual(blocking, ['availability', 'maxBlocks', 'maxConsecutive', 'minBreak', 'refusedPole', 'volumeOver']);
});

test('a mode the criterion refuses, or a weight that is not a price, falls back to the default', () => {
  const resolved = resolveConstraints({
    ...DEFAULT_CONSTRAINTS,
    criteria: { floor: { mode: 'block' }, buddy: { weight: -3 }, staffing: { mode: 'off', weight: 10 } },
  });
  deepStrictEqual(resolved.floor, { mode: 'weight', weight: 30000 });
  deepStrictEqual(resolved.buddy, { mode: 'weight', weight: 5000 });
  deepStrictEqual(resolved.staffing, { mode: 'weight', weight: 10 });
});

test('a refused pole: blocking, weighed as a tier 2 signalement, or silent', () => {
  const v = volunteer('a', { refusedPoleKeys: ['secu'] });
  const s = shift('s', 'secu', 0, 2);
  const at = (mode: 'block' | 'weight' | 'off') =>
    makePlan({ shifts: [s], volunteers: [v], assignments: [assign('a', 's')], criteria: { refusedPole: { mode } } });

  ok(!isLegal(new PlanIndex({ ...at('block'), assignments: [] }), v, s));
  deepStrictEqual(tierOfCode(at('block'), TIER1.poleRefuse), [1]);

  ok(isLegal(new PlanIndex({ ...at('weight'), assignments: [] }), v, s));
  deepStrictEqual(tierOfCode(at('weight'), TIER1.poleRefuse), [2]);

  deepStrictEqual(tierOfCode(at('off'), TIER1.poleRefuse), []);
});

test('a refused tranche weighed rather than blocked is allowed and still said', () => {
  const v = volunteer('a', { refusedSlotIds: [DEFAULT_SLOTS[0]!.id] });
  const s = shift('s', 'bar', 0, 2);
  const plan = makePlan({ shifts: [s], volunteers: [v], assignments: [assign('a', 's')], criteria: { availability: { mode: 'weight' } } });
  deepStrictEqual(blockersFor(new PlanIndex({ ...plan, assignments: [] }), v, s), []);
  deepStrictEqual(tierOfCode(plan, TIER1.trancheRefusee), [2]);
});

test('the volume ceiling and the rhythm of the day can each become a price', () => {
  const v = volunteer('a', { requestedHours: 4 });
  const shifts = [shift('s1', 'bar', 0, 3), shift('s2', 'bar', 3, 6)];
  const assignments = [assign('a', 's1'), assign('a', 's2')];
  const soft = makePlan({
    shifts, volunteers: [v], assignments,
    criteria: { volumeOver: { mode: 'weight' }, maxConsecutive: { mode: 'weight' } },
  });
  deepStrictEqual(tierOfCode(soft, TIER1.volumeDepasse), [2]);
  deepStrictEqual(tierOfCode(soft, TIER1.dureeConsecutive), [2]);

  const off = makePlan({
    shifts, volunteers: [v], assignments,
    criteria: { volumeOver: { mode: 'off' }, maxConsecutive: { mode: 'off' } },
  });
  deepStrictEqual(validate(off).issues.filter((i) => i.volunteerKeys.includes('a')).map((i) => i.code), []);
});

test('a créneau longer than the cap is only "à découper" while the cap blocks', () => {
  const s = shift('long', 'bar', 0, 6);
  const blocked = makePlan({ shifts: [s], volunteers: [] });
  ok(validate(blocked).issues.some((i) => i.code === TIER2.creneauTropLong));
  const priced = makePlan({ shifts: [s], volunteers: [], criteria: { maxConsecutive: { mode: 'weight' } } });
  ok(!validate(priced).issues.some((i) => i.code === TIER2.creneauTropLong));
});

test('"pas sur le choix 1" blocking covers choice 2 and outside; "ni l\'un ni l\'autre" only outside', () => {
  const v = volunteer('a');
  const onChoice2 = shift('c2', 'secu', 0, 2);
  const outside = shift('out', 'propre', 4, 6);

  const only1 = new PlanIndex(makePlan({ shifts: [onChoice2, outside], volunteers: [v], criteria: { notChoice1: { mode: 'block' } } }));
  deepStrictEqual(blockersFor(only1, v, onChoice2).map((b) => b.code), [TIER1.pasChoix1]);
  deepStrictEqual(blockersFor(only1, v, outside).map((b) => b.code), [TIER1.pasChoix1]);

  const within2 = new PlanIndex(makePlan({ shifts: [onChoice2, outside], volunteers: [v], criteria: { outsideChoices: { mode: 'block' } } }));
  ok(isLegal(within2, v, onChoice2));
  deepStrictEqual(blockersFor(within2, v, outside).map((b) => b.code), [TIER1.horsChoix]);

  const placed = makePlan({
    shifts: [outside], volunteers: [v], assignments: [assign('a', 'out')],
    criteria: { outsideChoices: { mode: 'block' } },
  });
  deepStrictEqual(tierOfCode(placed, TIER1.horsChoix), [1]);
});

test('a preference made blocking refuses a créneau past the accepted overflow, not inside it', () => {
  const loto = DEFAULT_PREFERENCE_SLOTS[0]!;
  const v = volunteer('a', { preferredSlotId: loto.id });
  const inOverflow = shift('in', 'bar', loto.end, loto.end + loto.overflowHours);
  const beyond = shift('beyond', 'bar', loto.end + loto.overflowHours, loto.end + loto.overflowHours + 2);
  const index = new PlanIndex(makePlan({ shifts: [inOverflow, beyond], volunteers: [v], criteria: { preference: { mode: 'block' } } }));
  ok(isLegal(index, v, inOverflow));
  deepStrictEqual(blockersFor(index, v, beyond).map((b) => b.code), [TIER2.preferenceContrariee]);
});

test('the solver goes where a weighed rule lets it and never where a blocking one does not', () => {
  // One place, one person, and the only créneau is on the pole that person refused.
  const v = volunteer('a', { refusedPoleKeys: ['secu'], requestedHours: 4 });
  const s = shift('s', 'secu', 0, 2);
  const blocked = solve(makePlan({ shifts: [s], volunteers: [v] }), { seed: 1, iterations: 50 });
  strictEqual(blocked.plan.assignments.length, 0);

  const cheap = solve(
    makePlan({ shifts: [s], volunteers: [v], criteria: { refusedPole: { mode: 'weight', weight: 100 } } }),
    { seed: 1, iterations: 50 },
  );
  deepStrictEqual(cheap.plan.assignments.map((a) => a.shiftKey), ['s']);
});

test('a consecutive cap made a cheap price lets the solver build the longer block', () => {
  const v = volunteer('a', { requestedHours: 6, choice1PoleKey: 'bar' });
  const shifts = [shift('s1', 'bar', 0, 2), shift('s2', 'bar', 2, 4), shift('s3', 'bar', 4, 6)];
  const blocked = solve(makePlan({ shifts, volunteers: [v] }), { seed: 3, iterations: 200 });
  strictEqual(blocked.plan.assignments.length, 2);

  const priced = solve(
    makePlan({ shifts, volunteers: [v], criteria: { maxConsecutive: { mode: 'weight', weight: 10 } } }),
    { seed: 3, iterations: 200 },
  );
  strictEqual(priced.plan.assignments.length, 3);
  deepStrictEqual(tierOfCode({ ...makePlan({ shifts, volunteers: [v], criteria: { maxConsecutive: { mode: 'weight', weight: 10 } } }), assignments: priced.plan.assignments }, TIER1.dureeConsecutive), [2]);
});

test('where a day reads long is the event\'s', () => {
  const v = volunteer('a', { requestedHours: 8 });
  const shifts = [shift('s1', 'bar', 0, 3), shift('s2', 'bar', 6, 8)];
  const assignments = [assign('a', 's1'), assign('a', 's2')];
  const standard = validate(makePlan({ shifts, volunteers: [v], assignments }));
  strictEqual(standard.volunteers[0]!.volumeBand, 'aucune');
  const shorter = validate(makePlan({ shifts, volunteers: [v], assignments, longDay: { longDayHours: 4, veryLongDayHours: 5 } }));
  strictEqual(shorter.volunteers[0]!.volumeBand, 'orange-fonce');
});

// ---------------------------------------------------------------------------
// N pole choices, ranked or not (2026-09-14)

test('a third choice costs two rank steps, and outside costs one step past the last', () => {
  const plan = makePlan({ shifts: [], volunteers: [] });
  const three = volunteer('a', {
    choices: [
      { poleKey: 'bar', raw: '', level: 'expert' },
      { poleKey: 'secu', raw: '', level: 'intermediaire' },
      { poleKey: 'propre', raw: '', level: 'debutant' },
    ],
  });
  const index = new PlanIndex({ ...plan, volunteers: [three] });
  strictEqual(index.rankOf(three, 'bar'), 0);
  strictEqual(index.rankOf(three, 'propre'), 2);
  strictEqual(index.levelIn(three, 'secu'), 'intermediaire');
  const unranked = new PlanIndex({ ...plan, volunteers: [three], poleChoicesRanked: false });
  strictEqual(unranked.rankOf(three, 'propre'), 0);
  strictEqual(unranked.choiceIndexOf(three, 'propre'), 2, 'la position reste connue');
});

test('the solver prefers a second choice to a third, and treats them alike when unranked', () => {
  const choices = [
    { poleKey: 'bar', raw: '', level: 'expert' as const },
    { poleKey: 'secu', raw: '', level: 'expert' as const },
    { poleKey: 'propre', raw: '', level: 'expert' as const },
  ];
  // Two créneaux at the same hour, one on choice 2 and one on choice 3: one person, one place.
  const shifts = [shift('c3', 'propre', 0, 4), shift('c2', 'secu', 0, 4)];
  const v = volunteer('a', { requestedHours: 4, choices });
  const ranked = solve(makePlan({ shifts, volunteers: [v] }), { seed: 2, iterations: 100 });
  deepStrictEqual(ranked.plan.assignments.map((a) => a.shiftKey), ['c2']);
});

test('blocking "pas sur le premier choix" has no effect on an unranked event', () => {
  const v = volunteer('a');
  const onSecond = shift('c2', 'secu', 0, 2);
  const plan = makePlan({ shifts: [onSecond], volunteers: [v], criteria: { notChoice1: { mode: 'block' } } });
  ok(!isLegal(new PlanIndex(plan), v, onSecond));
  ok(isLegal(new PlanIndex({ ...plan, poleChoicesRanked: false }), v, onSecond));
});

// ---------------------------------------------------------------------------
// Volume per day (2026-09-14)

test('a day starts at the boundary hour, and an event starting before it has a short first day', () => {
  // Local time of the test machine: build the start from local parts so the clock is exact.
  const start = new Date(2027, 2, 12, 10, 0, 0).toISOString();
  strictEqual(firstBoundary(start, 12), 2);
  strictEqual(dayIndexAt(2, 1), 0);
  strictEqual(dayIndexAt(2, 2), 1);
  strictEqual(dayIndexAt(2, 25.9), 1);
  strictEqual(dayIndexAt(2, 26), 2);
  deepStrictEqual(eventDays(start, 30, 12), [{ start: 0, end: 2 }, { start: 2, end: 26 }, { start: 26, end: 30 }]);
  const atNoon = new Date(2027, 2, 12, 12, 0, 0).toISOString();
  deepStrictEqual(eventDays(atNoon, 48, 12), [{ start: 0, end: 24 }, { start: 24, end: 48 }]);
});

test('per day: 2h-6h and 18h-22h are two days when the boundary is noon', () => {
  const start = new Date(2027, 2, 12, 12, 0, 0).toISOString();
  const v = volunteer('a', { requestedHours: 4 });
  // Hours from a noon start: 14 is 2h the next morning, 30 is 18h the next evening.
  const shifts = [shift('night', 'bar', 14, 18), shift('evening', 'bar', 30, 34)];
  const plan = makePlan({
    startISO: start, lengthHours: 48, shifts, volunteers: [v],
    assignments: [assign('a', 'night'), assign('a', 'evening')],
    volume: { scope: 'day' },
  });
  const index = new PlanIndex(plan);
  strictEqual(index.dayOf(14), 0);
  strictEqual(index.dayOf(30), 1);
  const result = validate(plan);
  deepStrictEqual(result.volunteers[0]!.hoursByDay, [4, 4]);
  strictEqual(result.volunteers[0]!.requestedTotalHours, 8, 'deux jours disponibles, 4 h chacun');
  ok(!result.issues.some((i) => i.code === TIER1.volumeDepasse), '4 h par jour, 8 h en tout: pas de dépassement');
  ok(!result.issues.some((i) => i.code === TIER1.tropDeBlocs), 'un bloc par jour');

  const asEvent = validate({ ...plan, volume: { ...plan.volume, scope: 'event' } });
  ok(asEvent.issues.some((i) => i.code === TIER1.volumeDepasse), 'compté sur tout l\'événement, 8 h dépassent 4 h');
});

test('per day: the floor is judged on a day somebody works, not on a day off', () => {
  const start = new Date(2027, 2, 12, 12, 0, 0).toISOString();
  const v = volunteer('a', { requestedHours: 4 });
  const plan = makePlan({
    startISO: start, lengthHours: 48, shifts: [shift('a1', 'bar', 0, 4), shift('b1', 'bar', 24, 26)],
    volunteers: [v], assignments: [assign('a', 'a1'), assign('a', 'b1')], volume: { scope: 'day' },
  });
  const floors = validate(plan).issues.filter((i) => i.code === TIER2.plancherNonAtteint);
  strictEqual(floors.length, 1);
  deepStrictEqual(floors[0]!.shiftKeys, ['b1']);
});

test('per day, the solver fills each day to the volume instead of the event once', () => {
  const start = new Date(2027, 2, 12, 12, 0, 0).toISOString();
  const v = volunteer('a', { requestedHours: 4 });
  const shifts = [shift('d1', 'bar', 2, 6), shift('d2', 'bar', 26, 30)];
  const asEvent = solve(makePlan({ startISO: start, lengthHours: 48, shifts, volunteers: [v] }), { seed: 1, iterations: 50 });
  strictEqual(asEvent.plan.assignments.length, 1);
  const perDay = solve(
    makePlan({ startISO: start, lengthHours: 48, shifts, volunteers: [v], volume: { scope: 'day' } }),
    { seed: 1, iterations: 50 },
  );
  strictEqual(perDay.plan.assignments.length, 2);
});

test('a placement a weighed rule allows still says what it costs; a blocking one says nothing here', () => {
  const v = volunteer('a', { refusedPoleKeys: ['secu'] });
  const s = shift('s', 'secu', 0, 2);
  const weighed = new PlanIndex(makePlan({ shifts: [s], volunteers: [v], criteria: { refusedPole: { mode: 'weight' } } }));
  deepStrictEqual(costsFor(weighed, v, s).map((c) => c.code), [TIER1.poleRefuse]);
  const blocked = new PlanIndex(makePlan({ shifts: [s], volunteers: [v] }));
  deepStrictEqual(costsFor(blocked, v, s), []);
  const outside = volunteer('b', { choices: [] });
  const onBar = shift('bar1', 'bar', 4, 6);
  deepStrictEqual(costsFor(new PlanIndex(makePlan({ shifts: [onBar], volunteers: [outside] })), outside, onBar).map((c) => c.code), [TIER1.horsChoix]);
});
