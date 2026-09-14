import { defaultPhase } from './phase.js';
/**
 * Validation engine tests.
 *
 *   npm test
 *
 * Hand-built micro-plans, one per rule, because a rule is only really tested when the plan
 * around it is small enough that nothing else can explain the result. The scenario-scale checks
 * live in `validate-cli.ts`, which runs the engine over the generated datasets.
 */

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_CATERING,
  DEFAULT_TICKETING,
  DEFAULT_TRAVEL_RATES,
  DEFAULT_RULES,
  DEFAULT_PREFERENCE_SLOTS,
  DEFAULT_SLOTS,
  toClock,
  toLabel,
  type Artist,
  type Pole,
  type Shift,
  type Volunteer,
  type Window,
  absentFromPhase,
  makeArtist,
} from './model.js';
import { withChoices, type TestVolunteer } from './test-volunteers.js';
import { DEFAULT_CONSTRAINTS } from './constraints.js';
import { buildBlocks, PlanIndex, type Assignment, type BuddyPair, type Plan } from './plan.js';
import { TIER1, TIER2, blockersFor, validate, type ValidationResult } from './validate.js';
import { preferenceMisfit, refusedWindows, usableWindows } from './availability.js';
import type { Organiser, OrganiserShift } from './model.js';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const pole = (key: string, over: Partial<Pole> = {}): Pole => ({
  key,
  name: key,
  parentKey: null,
  path: key,
  allowAllDebutants: false,
  minExperienced: 0, defaultHeadcount: 1,
  ...over,
});

const shift = (key: string, poleKey: string, start: number, end: number, headcount = 1): Shift =>
  ({ key, poleKey, start, end, headcount });

const volunteer = (key: string, over: Partial<TestVolunteer> = {}): Volunteer => withChoices({
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
  choice1PoleKey: 'bar-service',
   choice1Level: 'expert',
  choice2PoleKey: 'secu',
   choice2Level: 'expert',
  artistKeys: [],
  buddyRawNames: [],
  manualFields: [],
  needsReview: false,
  reviewReasons: [],
  montage: absentFromPhase(),
  demontage: absentFromPhase(),
  ...over,
});

const assign = (volunteerKey: string, shiftKey: string): Assignment =>
  ({ volunteerKey, shiftKey, locked: false, source: 'solver' });

const BASE_POLES: Pole[] = [
  pole('bar'),
  pole('bar-service', { parentKey: 'bar', path: 'bar / service' }),
  pole('secu'),
  pole('proprete', { allowAllDebutants: true }),
  pole('technique', { minExperienced: 1 }),
];

function makePlan(parts: {
  poles?: Pole[];
  shifts?: Shift[];
  artists?: Artist[];
  volunteers?: Volunteer[];
  buddies?: BuddyPair[]; reserve?: string[];
  assignments?: Assignment[];
  organiserShifts?: OrganiserShift[];
}): Plan {
  return {
    name: 'test',
    startISO: '2027-03-13T12:00:00+01:00',
    lengthHours: 18,
    address: '',
    sheetUrl: '',
    rules: DEFAULT_RULES,
    catering: DEFAULT_CATERING,
    ticketing: DEFAULT_TICKETING,
    travel: DEFAULT_TRAVEL_RATES,
    poleChoicesRanked: true,
    volume: { scope: 'event', dayStartHour: 12, options: [4, 6, 8] },
    formMapping: { columns: {}, answers: {} },
    dismissedBuddies: [],
    constraints: DEFAULT_CONSTRAINTS,
    slots: DEFAULT_SLOTS,
    preferenceSlots: DEFAULT_PREFERENCE_SLOTS,
    poles: parts.poles ?? BASE_POLES,
    shifts: parts.shifts ?? [],
    artists: parts.artists ?? [],
    organisers: [],
    leaderRoles: [],
    volunteers: parts.volunteers ?? [],
    buddies: parts.buddies ?? [],
    assignments: parts.assignments ?? [],
    reserve: parts.reserve ?? [],
    organiserShifts: parts.organiserShifts ?? [],
    montage: defaultPhase('montage', '2027-03-13T12:00:00+01:00'),
    demontage: defaultPhase('demontage', '2027-03-13T12:00:00+01:00'),
  };
}

const codes = (result: ValidationResult): string[] => result.issues.map((i) => i.code);
const has = (result: ValidationResult, code: string): boolean => codes(result).includes(code);
const count = (result: ValidationResult, code: string): number =>
  codes(result).filter((c) => c === code).length;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

test('touching shifts merge into one block, across poles', () => {
  const blocks = buildBlocks([
    shift('a', 'bar-service', 0, 2),
    shift('b', 'secu', 2, 4),
    shift('c', 'secu', 8, 10),
  ]);
  strictEqual(blocks.length, 2);
  deepStrictEqual([blocks[0]!.start, blocks[0]!.end], [0, 4]);
  deepStrictEqual([blocks[1]!.start, blocks[1]!.end], [8, 10]);
});

// ---------------------------------------------------------------------------
// Tier 1
// ---------------------------------------------------------------------------

test('two shifts at the same time is a chevauchement', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2), shift('s2', 'secu', 1, 3)],
    volunteers: [volunteer('v1')],
    assignments: [assign('v1', 's1'), assign('v1', 's2')],
  }));
  strictEqual(count(result, TIER1.chevauchement), 1);
});

test('a veto covers the whole subtree of the refused pole', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2)],
    volunteers: [volunteer('v1', { refusedPoleKeys: ['bar'] })],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(count(result, TIER1.poleRefuse), 1);
});

test('a shift overlapping the refused slot is caught', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'secu', 5, 7)], // straddles 18h
    volunteers: [volunteer('v1', { refusedSlotIds: ['18h-00h'] })],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(count(result, TIER1.trancheRefusee), 1);
});

test('a preference never makes a placement illegal, in either direction', () => {
  // The rule this replaces: "soirée" used to forbid anything before the boundary and
  // "après-midi" anything past the overflow limit, both as tier 1. They are prices now, and a
  // price that reached tier 1 would be the same bug wearing a different name.
  const early = validate(makePlan({
    shifts: [shift('s1', 'secu', 0, 2)], // 12h-14h for somebody who prefers the concerts
    volunteers: [volunteer('v1', { preferredSlotId: 'concerts' })],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(early.summary.tier1Count, 0);

  const late = validate(makePlan({
    shifts: [shift('s1', 'secu', 14, 16)], // 02h-04h for somebody who prefers the loto
    volunteers: [volunteer('v1', { preferredSlotId: 'loto' })],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(late.summary.tier1Count, 0);
});

test('working against the stated preference is reported as tier 2, on both sides', () => {
  // 20h is the boundary and 22h the end of the accepted overflow, in an event starting at noon.
  const concerts = validate(makePlan({
    shifts: [shift('s1', 'secu', 4, 8)], // 16h-20h, four hours before the boundary
    volunteers: [volunteer('v1', { preferredSlotId: 'concerts', requestedHours: 4 })],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(count(concerts, TIER2.preferenceContrariee), 1);
  strictEqual(concerts.volunteers[0]!.againstPreferenceHours, 4);

  const loto = validate(makePlan({
    shifts: [shift('s1', 'secu', 8, 12)], // 20h-00h: 2h tolerated, then 2h against
    volunteers: [volunteer('v1', { preferredSlotId: 'loto', requestedHours: 4 })],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(count(loto, TIER2.preferenceContrariee), 1);
  strictEqual(loto.volunteers[0]!.toleratedOverflowHours, 2);
  strictEqual(loto.volunteers[0]!.againstPreferenceHours, 2);
});

test('more than 4h in a row is caught even when split across poles', () => {
  const result = validate(makePlan({
    shifts: [
      shift('s1', 'bar-service', 0, 2),
      shift('s2', 'secu', 2, 4),
      shift('s3', 'bar-service', 4, 6),
    ],
    volunteers: [volunteer('v1')],
    assignments: [assign('v1', 's1'), assign('v1', 's2'), assign('v1', 's3')],
  }));
  strictEqual(count(result, TIER1.dureeConsecutive), 1);
  ok(!has(result, TIER1.tropDeBlocs), 'three touching shifts are one block, not three');
});

test('a third block is refused even when every break is long enough', () => {
  const result = validate(makePlan({
    shifts: [
      shift('s1', 'bar-service', 0, 2),
      shift('s2', 'secu', 4, 6),
      shift('s3', 'bar-service', 8, 10),
    ],
    volunteers: [volunteer('v1')],
    assignments: [assign('v1', 's1'), assign('v1', 's2'), assign('v1', 's3')],
  }));
  strictEqual(count(result, TIER1.tropDeBlocs), 1);
  ok(!has(result, TIER1.pauseInsuffisante));
});

test('a break under 2h between two blocks is caught', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2), shift('s2', 'secu', 3, 5)],
    volunteers: [volunteer('v1')],
    assignments: [assign('v1', 's1'), assign('v1', 's2')],
  }));
  strictEqual(count(result, TIER1.pauseInsuffisante), 1);
});

test('exceeding the requested volume is caught on its own', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 4), shift('s2', 'secu', 6, 8)],
    volunteers: [volunteer('v1', { requestedHours: 4 })],
    assignments: [assign('v1', 's1'), assign('v1', 's2')],
  }));
  strictEqual(count(result, TIER1.volumeDepasse), 1);
  ok(!has(result, TIER1.dureeConsecutive));
  ok(!has(result, TIER1.tropDeBlocs));
});

test('more people than places is a sureffectif', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2, 1)],
    volunteers: [volunteer('v1'), volunteer('v2')],
    assignments: [assign('v1', 's1'), assign('v2', 's1')],
  }));
  strictEqual(count(result, TIER1.sureffectif), 1);
});

test('dangling references and duplicates are reported, not thrown', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2, 2)],
    volunteers: [volunteer('v1')],
    assignments: [assign('v1', 's1'), assign('v1', 's1'), assign('fantome', 's1'), assign('v1', 'inconnu')],
  }));
  strictEqual(count(result, TIER1.doublon), 1);
  strictEqual(count(result, TIER1.referenceInconnue), 2);
});

// ---------------------------------------------------------------------------
// Tier 2
// ---------------------------------------------------------------------------

test('nobody finishes at zero, and under 4h is its own signal', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2)],
    volunteers: [volunteer('v1'), volunteer('v2')],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(count(result, TIER2.sansAffectation), 1);
  strictEqual(count(result, TIER2.plancherNonAtteint), 1);
});

test('an empty shift and an incomplete one are told apart', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2, 2), shift('s2', 'secu', 6, 8, 2)],
    volunteers: [volunteer('v1')],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(count(result, TIER2.creneauIncomplet), 1);
  strictEqual(count(result, TIER2.creneauVide), 1);
});

test('a full shift of nothing but débutants is red, unless the pole is exempt', () => {
  const flagged = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2, 2)],
    volunteers: [
      volunteer('v1', { choice1Level: 'debutant' }),
      volunteer('v2', { choice1Level: 'debutant' }),
    ],
    assignments: [assign('v1', 's1'), assign('v2', 's1')],
  }));
  strictEqual(count(flagged, TIER2.queDesDebutants), 1);

  const exempt = validate(makePlan({
    shifts: [shift('s1', 'proprete', 0, 2, 2)],
    volunteers: [
      volunteer('v1', { choice1PoleKey: 'proprete', choice1Level: 'debutant' }),
      volunteer('v2', { choice1PoleKey: 'proprete', choice1Level: 'debutant' }),
    ],
    assignments: [assign('v1', 's1'), assign('v2', 's1')],
  }));
  ok(!has(exempt, TIER2.queDesDebutants));
});

test('experience is only judged once a shift is full', () => {
  const incomplete = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2, 2)],
    volunteers: [volunteer('v1', { choice1Level: 'debutant' })],
    assignments: [assign('v1', 's1')],
  }));
  ok(has(incomplete, TIER2.creneauIncomplet));
  ok(!has(incomplete, TIER2.queDesDebutants), 'an incomplete shift is already red for being incomplete');
});

test('a pole requiring an experienced volunteer says so when it does not get one', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'technique', 0, 2, 1)],
    volunteers: [volunteer('v1', { choice1PoleKey: 'technique', choice1Level: 'debutant' })],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(count(result, TIER2.experienceInsuffisante), 1);
});

test('an unknown level counts as inexperienced', () => {
  // v1 chose neither pole of this shift, so nothing says they know the job.
  const result = validate(makePlan({
    shifts: [shift('s1', 'technique', 0, 2, 1)],
    volunteers: [volunteer('v1', { choice1PoleKey: 'secu', choice2PoleKey: 'proprete' })],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(count(result, TIER2.experienceInsuffisante), 1);
  strictEqual(count(result, TIER2.queDesDebutants), 1);
  strictEqual(result.shifts[0]!.stars[0]!.level, null);
});

test('missing a named artist is reported, never blocking', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'secu', 6, 8)],
    artists: [makeArtist({ key: 'a1', name: 'SYNTH-K', start: 7, end: 9 })],
    volunteers: [volunteer('v1', { artistKeys: ['a1'] })],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(count(result, TIER2.artisteManque), 1);
  strictEqual(result.summary.tier1Count, 0);
  strictEqual(result.artists[0]!.assignedDuring, 1);
});

test('a shift longer than the consecutive cap is flagged as undoable', () => {
  const result = validate(makePlan({ shifts: [shift('s1', 'bar-service', 0, 5)] }));
  strictEqual(count(result, TIER2.creneauTropLong), 1);
});

// ---------------------------------------------------------------------------
// blockersFor, the predicate the solver will share
// ---------------------------------------------------------------------------

test('blockersFor is empty on a legal placement and names the reason otherwise', () => {
  const plan = makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2), shift('s2', 'secu', 1, 3)],
    volunteers: [volunteer('v1')],
    assignments: [assign('v1', 's1')],
  });
  const index = new PlanIndex(plan);
  const v1 = plan.volunteers[0]!;

  strictEqual(blockersFor(index, v1, plan.shifts[0]!)[0]?.code, TIER1.dejaAffecte);
  deepStrictEqual(
    blockersFor(index, v1, plan.shifts[1]!).map((b) => b.code),
    [TIER1.chevauchement],
  );

  const empty = new PlanIndex(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2)],
    volunteers: [volunteer('v1')],
  }));
  deepStrictEqual(blockersFor(empty, v1, empty.plan.shifts[0]!), []);
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

test('the row colour follows the total, and red always wins', () => {
  const result = validate(makePlan({
    shifts: [
      shift('a1', 'bar-service', 0, 4), shift('a2', 'bar-service', 6, 8),
      shift('b1', 'secu', 0, 4), shift('b2', 'secu', 6, 10),
      shift('c1', 'proprete', 0, 4),
    ],
    volunteers: [
      volunteer('six', { requestedHours: 6 }),
      volunteer('huit'),
      volunteer('rouge', { requestedHours: 4, refusedPoleKeys: ['proprete'] }),
    ],
    assignments: [
      assign('six', 'a1'), assign('six', 'a2'),
      assign('huit', 'b1'), assign('huit', 'b2'),
      assign('rouge', 'c1'),
    ],
  }));
  const colourOf = (key: string) => result.volunteers.find((v) => v.key === key)!.colour;
  strictEqual(colourOf('six'), 'orange-clair');
  strictEqual(colourOf('huit'), 'orange-fonce');
  strictEqual(colourOf('rouge'), 'rouge');
});

test('hours are split by choice, and every out-of-choice placement is listed', () => {
  const result = validate(makePlan({
    shifts: [
      shift('s1', 'bar-service', 0, 2),
      shift('s2', 'secu', 4, 6),
      shift('s3', 'proprete', 8, 10),
    ],
    volunteers: [volunteer('v1', { requestedHours: 8 })],
    assignments: [assign('v1', 's1'), assign('v1', 's2'), assign('v1', 's3')],
  }));
  const report = result.volunteers[0]!;
  deepStrictEqual(report.hoursByRank, [2, 2]);
  strictEqual(report.hoursOutside, 2);
  deepStrictEqual(report.horsChoixPoles, ['proprete']);
  deepStrictEqual(result.summary.horsChoix, [{ volunteerKey: 'v1', name: 'v1 Test', poles: ['proprete'] }]);
});

test('a buddy request counts as honoured only on a shared shift', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2, 2), shift('s2', 'secu', 4, 6, 2)],
    volunteers: [volunteer('a'), volunteer('b'), volunteer('c')],
    buddies: [{ fromKey: 'a', toKey: 'b' }, { fromKey: 'a', toKey: 'c' }],
    assignments: [assign('a', 's1'), assign('b', 's1'), assign('c', 's2')],
  }));
  const a = result.volunteers.find((v) => v.key === 'a')!;
  deepStrictEqual(a.buddies.map((b) => [b.toKey, b.honoured]), [['b', true], ['c', false]]);
  strictEqual(result.summary.buddyRequests, 2);
  strictEqual(result.summary.buddyHonoured, 1);
});

test('overflow inside the accepted band is measured and is not a signalement', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'secu', 6, 10)], // 18h-22h: 2h before the boundary, 2h tolerated after
    volunteers: [volunteer('v1', { preferredSlotId: 'loto', requestedHours: 4 })],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(result.volunteers[0]!.toleratedOverflowHours, 2);
  strictEqual(result.volunteers[0]!.againstPreferenceHours, 0);
  strictEqual(result.summary.tier1Count, 0);
  ok(!has(result, TIER2.preferenceContrariee), 'le débordement accepté ne se signale pas');
});

// ---------------------------------------------------------------------------
// Gap diagnosis: the recruitment question
// ---------------------------------------------------------------------------

test('a gap caused by nobody being free at that hour says so', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'secu', 12, 14, 1)], // 00h-02h
    volunteers: [
      // A refused slot, not a preference: a preference has not made anybody unavailable since
      // 2026-09-08, and writing this test with one would have quietly stopped testing anything.
      volunteer('v1', { refusedSlotIds: ['00h-06h'] }),
      volunteer('v2', { refusedSlotIds: ['00h-06h'] }),
    ],
  }));
  const gap = result.shifts[0]!.gap!;
  strictEqual(gap.disponibles, 0);
  strictEqual(gap.indisponibles, 2);
  ok(gap.raison.includes('indisponibilité horaire'), gap.raison);
});

test('a gap caused by vetoes is told apart from a gap caused by the clock', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'secu', 6, 8, 1)],
    volunteers: [
      volunteer('v1', { refusedPoleKeys: ['secu'] }),
      volunteer('v2', { refusedPoleKeys: ['secu'] }),
    ],
  }));
  const gap = result.shifts[0]!.gap!;
  strictEqual(gap.refusentLePole, 2);
  strictEqual(gap.indisponibles, 0);
  ok(gap.raison.includes('boudé'), gap.raison);
});

test('a gap caused by everyone being full says the hours are missing', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'secu', 6, 8, 1), shift('s2', 'bar-service', 0, 4, 2)],
    volunteers: [
      volunteer('v1', { requestedHours: 4 }),
      volunteer('v2', { requestedHours: 4 }),
    ],
    assignments: [assign('v1', 's2'), assign('v2', 's2')],
  }));
  const gap = result.shifts.find((s) => s.key === 's1')!.gap!;
  strictEqual(gap.satures, 2);
  ok(gap.raison.includes('au maximum'), gap.raison);
});

test('a material share of vetoes beats a larger count of saturated volunteers', () => {
  // Under a shortage everyone is saturated, so saturation always wins on count while explaining
  // nothing. The veto is the narrower, actionable reason and must come out on top.
  const result = validate(makePlan({
    shifts: [shift('s1', 'secu', 6, 8, 1), shift('s2', 'bar-service', 0, 4, 4)],
    volunteers: [
      volunteer('r1', { refusedPoleKeys: ['secu'] }),
      volunteer('r2', { refusedPoleKeys: ['secu'] }),
      volunteer('r3', { refusedPoleKeys: ['secu'] }),
      volunteer('f1', { requestedHours: 4 }),
      volunteer('f2', { requestedHours: 4 }),
      volunteer('f3', { requestedHours: 4 }),
      volunteer('f4', { requestedHours: 4 }),
    ],
    assignments: [assign('f1', 's2'), assign('f2', 's2'), assign('f3', 's2'), assign('f4', 's2')],
  }));
  const gap = result.shifts.find((s) => s.key === 's1')!.gap!;
  deepStrictEqual([gap.indisponibles, gap.refusentLePole, gap.satures], [0, 3, 4]);
  ok(gap.raison.includes('boudé'), gap.raison);
});

test('a gap with willing takers points at the plan, not at recruitment', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'secu', 6, 8, 1)],
    volunteers: [volunteer('v1')],
  }));
  const gap = result.shifts[0]!.gap!;
  strictEqual(gap.disponibles, 1);
  ok(gap.raison.includes('la contrainte est ailleurs'), gap.raison);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

test('the summary adds up and carries the over-recruitment signal', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 4, 1)], // 4 person-hours, so a ceiling of 1 volunteer
    volunteers: [volunteer('v1', { requestedHours: 4 }), volunteer('v2', { requestedHours: 4 })],
    assignments: [assign('v1', 's1')],
  }));
  const { summary } = result;
  strictEqual(summary.demandHours, 4);
  strictEqual(summary.assignedHours, 4);
  strictEqual(summary.gapHours, 0);
  strictEqual(summary.shiftsFilled, 1);
  strictEqual(summary.volunteersUnassigned, 1);
  strictEqual(summary.volunteerCeiling, 1);
  strictEqual(summary.overRecruited, true);
  deepStrictEqual(
    summary.gapsBySlot.map((s) => [s.id, s.hours]),
    [['12h-18h', 0], ['18h-00h', 0], ['00h-06h', 0]],
  );
});

test('gap hours are split across the slots a shift straddles', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'secu', 4, 8, 2)], // 16h-20h, two places, nobody assigned
  }));
  deepStrictEqual(
    result.summary.gapsBySlot.map((s) => [s.id, s.hours]),
    [['12h-18h', 4], ['18h-00h', 4], ['00h-06h', 0]],
    "les tranches arrivent dans l'ordre où le régisseur les a déclarées",
  );
  deepStrictEqual(result.summary.gapsByPole, [{ poleKey: 'secu', path: 'secu', gapHours: 8 }]);
});

test('validate never mutates the plan it is given', () => {
  const plan = makePlan({
    shifts: [shift('s1', 'bar-service', 0, 2)],
    volunteers: [volunteer('v1')],
    assignments: [assign('v1', 's1')],
  });
  const before = JSON.stringify(plan);
  validate(plan);
  strictEqual(JSON.stringify(plan), before);
});

// ---------------------------------------------------------------------------
// Reserve
// ---------------------------------------------------------------------------

test('a volunteer on reserve is at zero hours on purpose, and that is not an error', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 4, 1)],
    volunteers: [volunteer('a', { requestedHours: 4 }), volunteer('b', { requestedHours: 4 })],
    reserve: ['b'],
    assignments: [assign('a', 's1')],
  }));
  ok(!has(result, TIER2.sansAffectation), 'reserve is not a forgotten volunteer');
  ok(!has(result, TIER2.plancherNonAtteint));
  strictEqual(result.summary.volunteersOnReserve, 1);
  strictEqual(result.summary.volunteersUnassigned, 0);
  strictEqual(result.volunteers.find((v) => v.key === 'b')!.reserve, true);
});

test('a volunteer on reserve who could fill a gap means the list is stale', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 4, 2)],
    volunteers: [volunteer('a', { requestedHours: 4 }), volunteer('b', { requestedHours: 4 })],
    reserve: ['b'],
    assignments: [assign('a', 's1')],
  }));
  strictEqual(count(result, TIER2.reserveInjustifiee), 1);
  ok(result.issues.find((i) => i.code === TIER2.reserveInjustifiee)!.message.includes('rappeler'));
});

test('holding a shift while on reserve is a contradiction and is reported', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'bar-service', 0, 4, 1)],
    volunteers: [volunteer('a', { requestedHours: 4 })],
    reserve: ['a'],
    assignments: [assign('a', 's1')],
  }));
  strictEqual(count(result, TIER2.reserveAffectee), 1);
});

test('the gap diagnosis puts the reserve first, because it has a phone number attached', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'secu', 6, 8, 1)],
    volunteers: [volunteer('a'), volunteer('b')],
    reserve: ['a', 'b'],
  }));
  const gap = result.shifts[0]!.gap!;
  strictEqual(gap.enReserve, 2);
  strictEqual(gap.disponibles, 0);
  ok(gap.raison.includes('rappeler'), gap.raison);
});

// ---------------------------------------------------------------------------
// Reading an hour offset back as a real time
// ---------------------------------------------------------------------------

test('the clock is read off the event start, not off an assumed midday', () => {
  // The grid used to compute the hour as midday plus the offset, which was exact for this event
  // and wrong for every other. Making the start editable turned that into a silent one-off on
  // every label at once.
  strictEqual(toClock('2027-03-13T12:00:00+01:00', 0), '12h');
  strictEqual(toClock('2027-03-13T12:00:00+01:00', 10.5), '22h30');

  // An evening event: the same offsets must land elsewhere.
  strictEqual(toClock('2027-03-13T20:00:00+01:00', 0), '20h');
  strictEqual(toClock('2027-03-13T20:00:00+01:00', 6), '2h', 'et passer minuit sans se perdre');
});

test('a label crossing midnight names the right day', () => {
  strictEqual(toLabel('2027-03-13T12:00:00+01:00', 0), '13/03 12:00');
  strictEqual(toLabel('2027-03-13T12:00:00+01:00', 14), '14/03 02:00');
});

test('a summer event is not shifted by an hour', () => {
  // The old code added a fixed +01:00. In July the offset is +02:00, so every label was out by
  // an hour the moment the régisseur could move the date.
  strictEqual(toClock('2027-07-04T20:00:00+02:00', 0), '20h');
  strictEqual(toLabel('2027-07-04T20:00:00+02:00', 5), '05/07 01:00');
});

// ---------------------------------------------------------------------------
// Slots as configuration, not as a constant
// ---------------------------------------------------------------------------

test('the usable windows depend on the refused slots and on nothing else', () => {
  // `usableWindows` enumerated named slots per half, then read the two boundaries, and now
  // reads neither: the preference stopped being a constraint on 2026-09-08, and the refused
  // slot is the only answer left that can make an hour impossible.
  const expected: Array<[string, string | null, Window[]]> = [
    // THE PREFERENCE NO LONGER NARROWS ANYTHING, which is why the first three rows are now
    // identical and every other row depends only on the refused slot. Before 2026-09-08,
    // 'evening' returned 6-18 and 'afternoon' 0-12 with nothing refused at all.
    ['any', null, [{ start: 0, end: 18 }]],
    ['concerts', null, [{ start: 0, end: 18 }]],
    ['loto', null, [{ start: 0, end: 18 }]],
    ['concerts', '00h-06h', [{ start: 0, end: 12 }]],
    ['loto', '12h-18h', [{ start: 6, end: 18 }]],
    ['any', '18h-00h', [{ start: 0, end: 6 }, { start: 12, end: 18 }]],
    ['any', '12h-18h', [{ start: 6, end: 18 }]],
  ];

  for (const [half, refused, windows] of expected) {
    deepStrictEqual(
      usableWindows(refusedWindows(DEFAULT_SLOTS, refused === null ? [] : [refused]), 18),
      windows,
      `${half} refusant ${refused ?? 'rien'}`,
    );
  }
});

test('a differently shaped set of slots is honoured, ids and all', () => {
  // An event with two slots instead of three, named whatever the form calls them.
  const slots = [
    { id: 'jour', label: 'Journée', start: 0, end: 5, overflowHours: 0 },
    { id: 'nuit', label: 'Nuit', start: 5, end: 10, overflowHours: 0 },
  ];
  const plan: Plan = {
    ...makePlan({
      shifts: [shift('s1', 'secu', 0, 2), shift('s2', 'secu', 6, 8)],
      volunteers: [volunteer('v1', { refusedSlotIds: ['nuit'], requestedHours: 4 })],
      assignments: [assign('v1', 's2')],
    }),
    slots,
    lengthHours: 10,
    address: '',
    sheetUrl: '',
  };

  const result = validate(plan);
  strictEqual(count(result, TIER1.trancheRefusee), 1, 'la tranche refusée est celle déclarée');
  deepStrictEqual(
    result.summary.gapsBySlot.map((s) => s.id),
    ['jour', 'nuit'],
    'le résumé suit les tranches du plan, pas trois noms fixés',
  );
});

test('a refusal naming a slot the plan no longer has simply stops applying', () => {
  // Slots are configuration, so one can be removed after people have answered. Their answer is
  // kept as they gave it, and the rule it referred to quietly has nothing to bite on.
  const plan: Plan = {
    ...makePlan({
      shifts: [shift('s1', 'secu', 0, 4)],
      volunteers: [volunteer('v1', { refusedSlotIds: ['tranche-supprimee'], requestedHours: 4 })],
      assignments: [assign('v1', 's1')],
    }),
  };
  const result = validate(plan);
  strictEqual(count(result, TIER1.trancheRefusee), 0);
  strictEqual(
    plan.volunteers[0]!.refusedSlotIds[0],
    'tranche-supprimee',
    'la réponse du bénévole est conservée telle quelle',
  );
});

test('moving the preferred slot moves what an answer counts as working against it', () => {
  // The boundary used to be a rule of the event; it is the edge of a slot now, and the
  // régisseur moves it in Réglages like any other slot.
  const shifts = [shift('s1', 'secu', 8, 10)]; // 20h-22h
  const volunteers = [volunteer('v1', { preferredSlotId: 'concerts', requestedHours: 4 })];
  const assignments = [assign('v1', 's1')];

  const atDefault = validate(makePlan({ shifts, volunteers, assignments }));
  strictEqual(atDefault.volunteers[0]!.againstPreferenceHours, 0, 'les concerts commencent à 20h');

  const base = makePlan({ shifts, volunteers, assignments });
  const later = validate({
    ...base,
    // The concerts start at midnight instead.
    preferenceSlots: base.preferenceSlots.map((s) => (s.id === 'concerts' ? { ...s, start: 12 } : s)),
  });
  strictEqual(
    later.volunteers[0]!.againstPreferenceHours,
    2,
    'le même créneau va désormais contre la réponse « Concerts »',
  );
  strictEqual(later.summary.tier1Count, 0, 'et reste légal');
});

test('the tolerated band is a property of the preferred slot, on either side of it', () => {
  // A slot from 14h to 20h with a 2 h band: 12h-14h and 20h-22h are tolerated, the rest is
  // against. The old rules could only tolerate on one side of one boundary.
  const base = makePlan({
    shifts: [shift('s1', 'secu', 0, 4), shift('s2', 'secu', 8, 12)], // 12h-16h and 20h-00h
    volunteers: [volunteer('v1', { preferredSlotId: 'milieu', requestedHours: 8 })],
    assignments: [assign('v1', 's1'), assign('v1', 's2')],
  });
  const result = validate({
    ...base,
    preferenceSlots: [
      ...base.preferenceSlots,
      { id: 'milieu', label: 'Milieu', start: 2, end: 8, overflowHours: 2 },
    ],
  });
  strictEqual(result.volunteers[0]!.toleratedOverflowHours, 4, '12h-14h et 20h-22h');
  strictEqual(result.volunteers[0]!.againstPreferenceHours, 2, '22h-00h');
  strictEqual(count(result, TIER2.preferenceContrariee), 1);
  const message = result.issues.find((i) => i.code === TIER2.preferenceContrariee)!.message;
  ok(message.includes('« Milieu »'), 'le signalement nomme la tranche préférée');
  ok(message.includes('débordement accepté de 2h'), 'et le débordement accepté');
});

test('a preference naming a slot the plan no longer has costs nothing and is not reported', () => {
  const result = validate(makePlan({
    shifts: [shift('s1', 'secu', 0, 4)],
    volunteers: [volunteer('v1', { preferredSlotId: 'tranche-supprimee', requestedHours: 4 })],
    assignments: [assign('v1', 's1')],
  }));
  strictEqual(result.volunteers[0]!.againstPreferenceHours, 0);
  ok(!has(result, TIER2.preferenceContrariee));
});

// ---------------------------------------------------------------------------
// Orgas standing in a créneau of the exploit
//
// The decision of 2026-09-10: the régisseur may put one there by hand, the solver never does,
// no hour rule applies to them, and they take a place. That last part is the only thing the
// engine knows about them, and these four tests are what it means.
// ---------------------------------------------------------------------------

const orga = (key: string): Organiser => ({
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
});

/** A plan with one two-place créneau and one orga standing in it. */
function withOrga(places: number, assignments: Assignment[] = []): Plan {
  const base = makePlan({
    shifts: [shift('s1', 'alpha', 0, 2, places)],
    volunteers: [volunteer('v1'), volunteer('v2')],
    assignments,
    organiserShifts: [{ key: 'os1', organiserKey: 'o1', shiftKey: 's1' }],
  });
  return { ...base, organisers: [orga('o1')] };
}

test('an orga in a créneau takes one of its places', () => {
  const index = new PlanIndex(withOrga(2));
  const found = index.shiftByKey.get('s1')!;
  strictEqual(index.headcountOf(found), 1);
  strictEqual(index.orgasOn('s1').length, 1);
});

test('a créneau whose places are all held by orgas asks for nobody, and is not reported empty', () => {
  const result = validate(withOrga(1));
  strictEqual(has(result, TIER2.creneauVide), false);
  strictEqual(result.shifts[0]!.missing, 0);
});

test('a volunteer placed on a créneau an orga has filled is over the effectif', () => {
  const result = validate(withOrga(1, [assign('v1', 's1')]));
  ok(has(result, TIER1.sureffectif));
});

test('the orgas are reported on the créneau, and count in no rule of their own', () => {
  const result = validate(withOrga(2, [assign('v1', 's1')]));
  deepStrictEqual(result.shifts[0]!.orgas.map((o) => o.key), ['o1']);
  // One place, one volunteer, one orga: nothing missing, nothing illegal.
  strictEqual(result.shifts[0]!.missing, 0);
  strictEqual(result.issues.filter((i) => i.tier === 1).length, 0);
});

test('two overlapping créneaux for one orga are reported, and nothing is removed', () => {
  const base = makePlan({
    shifts: [shift('s1', 'alpha', 0, 4, 2), shift('s2', 'beta', 2, 6, 2)],
    volunteers: [volunteer('v1')],
    organiserShifts: [
      { key: 'os1', organiserKey: 'o1', shiftKey: 's1' },
      { key: 'os2', organiserKey: 'o1', shiftKey: 's2' },
    ],
  });
  const index = new PlanIndex({ ...base, organisers: [orga('o1')] });
  const clashes = index.organiserClashes();
  strictEqual(clashes.length, 1);
  deepStrictEqual([clashes[0]!.first.key, clashes[0]!.second.key], ['s1', 's2']);
  strictEqual(index.shiftsOfOrganiser('o1').length, 2);
});

/*
 * A pole that wants its responsable in support, 2026-09-12.
 *
 * Not a rule of `validate`, on purpose, and not a refusal: whether running a pole and holding a
 * créneau of it fit into one pair of hands is a fact about the job, so the pole carries it and
 * `PlanIndex` reports what contradicts it. See `Pole.leaderSupportOnly`.
 */
test('a responsable holding a créneau of a support-only pole is reported, and nothing is removed', () => {
  const base = makePlan({
    poles: [pole('bar', { leaderSupportOnly: true }), pole('secu')],
    shifts: [shift('s1', 'bar', 0, 4, 2), shift('s2', 'secu', 0, 4, 2)],
    organiserShifts: [
      { key: 'os1', organiserKey: 'o1', shiftKey: 's1' },
      { key: 'os2', organiserKey: 'o1', shiftKey: 's2' },
    ],
  });
  const index = new PlanIndex({
    ...base,
    organisers: [orga('o1')],
    leaderRoles: [{ key: 'r1', organiserKey: 'o1', poleKey: 'bar', start: null, end: null }],
  });

  const breaches = index.supportOnlyBreaches();
  strictEqual(breaches.length, 1, 'le créneau de sécu ne concerne pas son rôle au bar');
  strictEqual(breaches[0]!.shift.key, 's1');
  strictEqual(breaches[0]!.pole.key, 'bar');
  // Reported, never removed: the two places it holds are still there.
  strictEqual(index.shiftsOfOrganiser('o1').length, 2);
});

test('a pole that lets its responsable work reports nothing at all', () => {
  // The default, and what the tool did before the flag existed: a plan written earlier flags
  // nothing the day this ships.
  const base = makePlan({
    poles: [pole('bar'), pole('secu')],
    shifts: [shift('s1', 'bar', 0, 4, 2)],
    organiserShifts: [{ key: 'os1', organiserKey: 'o1', shiftKey: 's1' }],
  });
  const index = new PlanIndex({
    ...base,
    organisers: [orga('o1')],
    leaderRoles: [{ key: 'r1', organiserKey: 'o1', poleKey: 'bar', start: null, end: null }],
  });
  deepStrictEqual(index.supportOnlyBreaches(), []);
});

test('a role with its own hours only clashes with the créneaux inside them', () => {
  // Responsable of the bar from 14h to 18h, working the bar at 22h: two jobs one after the other,
  // not two at once. Reading the role as covering the whole event would have said otherwise.
  const base = makePlan({
    poles: [pole('bar', { leaderSupportOnly: true })],
    shifts: [shift('s1', 'bar', 2, 4, 2), shift('s2', 'bar', 10, 12, 2)],
    organiserShifts: [
      { key: 'os1', organiserKey: 'o1', shiftKey: 's1' },
      { key: 'os2', organiserKey: 'o1', shiftKey: 's2' },
    ],
  });
  const index = new PlanIndex({
    ...base,
    organisers: [orga('o1')],
    leaderRoles: [{ key: 'r1', organiserKey: 'o1', poleKey: 'bar', start: 2, end: 4 }],
  });

  const breaches = index.supportOnlyBreaches();
  strictEqual(breaches.length, 1);
  strictEqual(breaches[0]!.shift.key, 's1');
});

test('a responsable of a pole covers its sub-poles, so a créneau there counts too', () => {
  const base = makePlan({
    poles: [
      pole('bar', { leaderSupportOnly: true }),
      pole('bar-service', { parentKey: 'bar', path: 'bar / service' }),
    ],
    shifts: [shift('s1', 'bar-service', 0, 4, 2)],
    organiserShifts: [{ key: 'os1', organiserKey: 'o1', shiftKey: 's1' }],
  });
  const index = new PlanIndex({
    ...base,
    organisers: [orga('o1')],
    leaderRoles: [{ key: 'r1', organiserKey: 'o1', poleKey: 'bar', start: null, end: null }],
  });
  strictEqual(index.supportOnlyBreaches().length, 1);
});

test('the tolerated overflow is priced by its distance from the edge, on either side', () => {
  const loto = { id: 'loto', label: 'Loto', start: 0, end: 8, overflowHours: 2 };
  // 20h-22h, entirely in the band after the loto: ∫ d from 0 to 2 = 2.
  deepStrictEqual(preferenceMisfit(loto, { start: 8, end: 10 }), {
    tolerated: 2,
    against: 0,
    toleratedDistance: 2,
  });
  // 21h-23h: one hour tolerated at distance 1 to 2 (1.5), one hour against.
  deepStrictEqual(preferenceMisfit(loto, { start: 9, end: 11 }), {
    tolerated: 1,
    against: 1,
    toleratedDistance: 1.5,
  });
  // The band before the start is priced the same way, measured from the start.
  const milieu = { id: 'm', label: 'Milieu', start: 4, end: 8, overflowHours: 2 };
  deepStrictEqual(preferenceMisfit(milieu, { start: 2, end: 4 }), {
    tolerated: 2,
    against: 0,
    toleratedDistance: 2,
  });
  // Inside the tranche, and with no preference at all, nothing costs anything.
  deepStrictEqual(preferenceMisfit(milieu, { start: 4, end: 8 }), { tolerated: 0, against: 0, toleratedDistance: 0 });
  deepStrictEqual(preferenceMisfit(null, { start: 0, end: 18 }), { tolerated: 0, against: 0, toleratedDistance: 0 });
});
