import { defaultPhase } from './phase.js';
/**
 * Solver and proposal tests.
 *
 *   npm test
 *
 * The properties that matter are the ones the rest of the tool relies on: never a tier 1 issue,
 * a locked assignment never moves, the same seed gives the same plan, and the objective ranking
 * actually holds when two ranks pull in opposite directions. Each of those gets a plan small
 * enough that the expected answer is obvious by hand.
 */

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_CATERING, DEFAULT_TICKETING, DEFAULT_TRAVEL_RATES,
  DEFAULT_PREFERENCE_SLOTS, DEFAULT_RULES, DEFAULT_SLOTS, type Pole, type Shift, type Volunteer ,
  absentFromPhase,
} from './model.js';
import { withChoices, type TestVolunteer } from './test-volunteers.js';
import { DEFAULT_CONSTRAINTS } from './constraints.js';
import { PlanIndex, type Assignment, type BuddyPair, type Plan } from './plan.js';
import { buildProposals, groupProposals, type Proposal, type ProposalGroup } from './proposals.js';
import { DEFAULT_WEIGHTS, SolverState, planSeed, solve, solveToConvergence } from './solver.js';
import { validate } from './validate.js';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const pole = (key: string, over: Partial<Pole> = {}): Pole => ({
  key, name: key, parentKey: null, path: key,
  allowAllDebutants: true, minExperienced: 0, defaultHeadcount: 1, ...over,
});

const shift = (key: string, poleKey: string, start: number, end: number, headcount = 1): Shift =>
  ({ key, poleKey, start, end, headcount });

const volunteer = (key: string, over: Partial<TestVolunteer> = {}): Volunteer => withChoices({
  key, firstName: key, lastName: 'T', nickname: '', email: '', phone: '', accessCode: '',
  diet: '', allergies: '',
  requestedHours: 8, preferredSlotId: null, refusedSlotIds: [], availabilityNote: '',
  refusedPoleKeys: [],
  choice1PoleKey: 'alpha', choice1Level: 'expert',
  choice2PoleKey: 'beta', choice2Level: 'expert',
  artistKeys: [], buddyRawNames: [],
  manualFields: [], needsReview: false, reviewReasons: [],
  montage: absentFromPhase(), demontage: absentFromPhase(), ...over,
});

const assign = (volunteerKey: string, shiftKey: string, locked = false): Assignment =>
  ({ volunteerKey, shiftKey, locked, source: locked ? 'manual' : 'solver' });

const POLES = [pole('alpha'), pole('beta'), pole('gamma')];

function makePlan(parts: {
  poles?: Pole[]; shifts?: Shift[]; volunteers?: Volunteer[];
  buddies?: BuddyPair[]; reserve?: string[]; assignments?: Assignment[];
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
    applicationSteps: [],
    dismissedBuddies: [],
    constraints: DEFAULT_CONSTRAINTS,
    slots: DEFAULT_SLOTS,
    preferenceSlots: DEFAULT_PREFERENCE_SLOTS,
    poles: parts.poles ?? POLES,
    shifts: parts.shifts ?? [],
    artists: [],
    organisers: [],
    leaderRoles: [],
    volunteers: parts.volunteers ?? [],
    buddies: parts.buddies ?? [],
    assignments: parts.assignments ?? [],
    reserve: parts.reserve ?? [],
    organiserShifts: [],
    montage: defaultPhase('montage', '2027-03-13T12:00:00+01:00'),
    demontage: defaultPhase('demontage', '2027-03-13T12:00:00+01:00'),
  };
}

/** A plan with enough room to make the search do real work. */
function busyPlan(): Plan {
  const shifts: Shift[] = [];
  for (const [poleKey, from, to] of [['alpha', 0, 12], ['beta', 2, 14], ['gamma', 6, 18]] as const) {
    for (let start = from; start < to; start += 2) {
      shifts.push(shift(`${poleKey}@${start}`, poleKey, start, start + 2, 2));
    }
  }
  const volunteers: Volunteer[] = [];
  const halves = [null, 'concerts', 'loto'] as const;
  for (let i = 0; i < 24; i++) {
    volunteers.push(volunteer(`v${i}`, {
      requestedHours: ([4, 6, 8] as const)[i % 3]!,
      preferredSlotId: halves[i % 3]!,
      choice1PoleKey: POLES[i % 3]!.key,
      choice2PoleKey: POLES[(i + 1) % 3]!.key,
      choice1Level: i % 4 === 0 ? 'debutant' : 'expert',
    }));
  }
  return makePlan({ shifts, volunteers });
}

const hoursOf = (plan: Plan, key: string): number => new PlanIndex(plan).hoursOf(key);
const poleOf = (plan: Plan, volunteerKey: string): string[] =>
  new PlanIndex(plan).shiftsOf(volunteerKey).map((s) => s.poleKey);

// ---------------------------------------------------------------------------
// The two promises
// ---------------------------------------------------------------------------

test('the solver never produces a tier 1 issue', () => {
  const result = solve(busyPlan(), { seed: 1, iterations: 400 });
  strictEqual(validate(result.plan).summary.tier1Count, 0);
});

test('the solver always returns a plan, even when nothing can be staffed', () => {
  // One shift in the middle of the night, and one volunteer who refused the night outright.
  // It used to be somebody who "only worked the afternoon", which is no longer a thing that
  // stops a placement: only the refused slot is.
  const result = solve(makePlan({
    shifts: [shift('s1', 'alpha', 14, 16)],
    volunteers: [volunteer('v1', { refusedSlotIds: ['00h-06h'] })],
  }), { seed: 1, iterations: 50 });

  strictEqual(result.plan.assignments.length, 0);
  const summary = validate(result.plan).summary;
  strictEqual(summary.tier1Count, 0);
  ok(summary.tier2Count > 0, 'the problem is reported, not thrown');
});

// ---------------------------------------------------------------------------
// The objective ranking
// ---------------------------------------------------------------------------

test('the 4h floor beats the requested volume: hours are spread, not hoarded', () => {
  // One volunteer could legally take both shifts and reach the 8h they asked for, leaving the
  // other at zero. Rank 1 over rank 5 says split them instead.
  const result = solve(makePlan({
    shifts: [shift('s1', 'alpha', 0, 4), shift('s2', 'alpha', 6, 10)],
    volunteers: [volunteer('a'), volunteer('b')],
  }), { seed: 1, iterations: 200 });

  strictEqual(hoursOf(result.plan, 'a'), 4);
  strictEqual(hoursOf(result.plan, 'b'), 4);
});

test('a shift is never left empty to keep someone inside their choices', () => {
  // The only volunteer chose neither pole. Rank 2 over rank 4 says place them anyway.
  const result = solve(makePlan({
    shifts: [shift('s1', 'gamma', 0, 4)],
    volunteers: [volunteer('v1', { choice1PoleKey: 'alpha', choice2PoleKey: 'beta' })],
  }), { seed: 1, iterations: 200 });

  deepStrictEqual(poleOf(result.plan, 'v1'), ['gamma']);
});

test('when both fit, each volunteer lands in their own choice 1', () => {
  const result = solve(makePlan({
    shifts: [shift('s1', 'alpha', 0, 4), shift('s2', 'beta', 0, 4)],
    volunteers: [
      volunteer('a', { requestedHours: 4, choice1PoleKey: 'alpha', choice2PoleKey: 'gamma' }),
      volunteer('b', { requestedHours: 4, choice1PoleKey: 'beta', choice2PoleKey: 'gamma' }),
    ],
  }), { seed: 1, iterations: 200 });

  deepStrictEqual(poleOf(result.plan, 'a'), ['alpha']);
  deepStrictEqual(poleOf(result.plan, 'b'), ['beta']);
});

test('a buddy request is honoured when it costs nothing else', () => {
  const result = solve(makePlan({
    shifts: [shift('s1', 'alpha', 0, 4, 2), shift('s2', 'alpha', 6, 10, 2)],
    volunteers: [
      volunteer('a', { requestedHours: 4 }), volunteer('b', { requestedHours: 4 }),
      volunteer('c', { requestedHours: 4 }), volunteer('d', { requestedHours: 4 }),
    ],
    buddies: [{ fromKey: 'a', toKey: 'b' }],
  }), { seed: 3, iterations: 400 });

  const index = new PlanIndex(result.plan);
  const shared = index.shiftsOf('a').some((s) => index.shiftsOf('b').some((t) => t.key === s.key));
  ok(shared, 'a and b should end up on the same shift');
});

// ---------------------------------------------------------------------------
// Locks, determinism, incremental re-solve
// ---------------------------------------------------------------------------

test('a locked assignment survives, however bad it is', () => {
  // v1 is locked into a pole they chose neither, while their choice 1 sits free next door.
  const plan = makePlan({
    shifts: [shift('s1', 'gamma', 0, 4), shift('s2', 'alpha', 0, 4)],
    volunteers: [
      volunteer('v1', { requestedHours: 4, choice1PoleKey: 'alpha', choice2PoleKey: 'beta' }),
      volunteer('v2', { requestedHours: 4 }),
    ],
    assignments: [assign('v1', 's1', true)],
  });
  const result = solve(plan, { seed: 1, iterations: 300 });

  ok(result.plan.assignments.some((a) => a.volunteerKey === 'v1' && a.shiftKey === 's1'));
  ok(result.plan.assignments.some((a) => a.volunteerKey === 'v1' && a.locked));
});

test('the same seed gives the same plan, byte for byte', () => {
  const plan = busyPlan();
  const a = solve(plan, { seed: 7, iterations: 300 });
  const b = solve(plan, { seed: 7, iterations: 300 });
  deepStrictEqual(a.plan.assignments, b.plan.assignments);
  strictEqual(a.score, b.score);
});

test('the search never ends worse than the construction it started from', () => {
  const result = solve(busyPlan(), { seed: 5, iterations: 500 });
  ok(result.score <= result.initialScore, `${result.score} > ${result.initialScore}`);
});

test('an existing assignment that broke a rule is handed back, never carried forward', () => {
  // Two shifts at the same time, and someone assigned to both by hand.
  const plan = makePlan({
    shifts: [shift('s1', 'alpha', 0, 4), shift('s2', 'beta', 2, 6)],
    volunteers: [volunteer('v1', { requestedHours: 8 }), volunteer('v2', { requestedHours: 8 })],
    assignments: [assign('v1', 's1'), assign('v1', 's2')],
  });
  const result = solve(plan, { seed: 1, iterations: 200 });

  strictEqual(result.dropped.length, 1);
  strictEqual(result.dropped[0]!.assignment.volunteerKey, 'v1');
  strictEqual(validate(result.plan).summary.tier1Count, 0);

  const proposals = buildProposals(plan, result.plan, result.dropped);
  ok(proposals.some((p) => p.rationale.includes('illégale')), JSON.stringify(proposals));
});

test('a re-solve after a change keeps almost everything in place', () => {
  const plan = busyPlan();
  const first = solve(plan, { seed: 2, iterations: 800 });

  // One volunteer cancels. Everyone else should stay where they are.
  const gone = 'v3';
  const after: Plan = {
    ...first.plan,
    volunteers: first.plan.volunteers.filter((v) => v.key !== gone),
    assignments: first.plan.assignments.filter((a) => a.volunteerKey !== gone),
  };
  const resolved = solve(after, { seed: 2, iterations: 800, anchor: after.assignments });

  const before = new Set(after.assignments.map((a) => `${a.volunteerKey}|${a.shiftKey}`));
  const kept = resolved.plan.assignments.filter((a) => before.has(`${a.volunteerKey}|${a.shiftKey}`));

  ok(kept.length / before.size > 0.8, `only ${kept.length}/${before.size} assignments survived`);
  strictEqual(validate(resolved.plan).summary.tier1Count, 0);
});

test('stability has a price, so a re-solve with no reason to move does not move', () => {
  const plan = busyPlan();
  const first = solve(plan, { seed: 4, iterations: 600 });
  const again = solve(first.plan, { seed: 4, iterations: 600, anchor: first.plan.assignments });
  const proposals = buildProposals(first.plan, again.plan, again.dropped);
  ok(proposals.length <= first.plan.assignments.length * 0.1,
     `${proposals.length} propositions for an unchanged plan`);
});

// ---------------------------------------------------------------------------
// Scoring machinery
// ---------------------------------------------------------------------------

test('probing a placement leaves the score exactly where it was', () => {
  const plan = busyPlan();
  const state = new SolverState(plan, DEFAULT_WEIGHTS, []);
  const target = plan.shifts[0]!;
  const before = state.score;

  for (const volunteer of plan.volunteers) {
    if (state.canAdd(volunteer.key, target)) state.deltaOfAdd(volunteer.key, target);
  }
  strictEqual(state.score, before);
});

test('the delta a probe predicts is the delta actually applied', () => {
  const plan = busyPlan();
  const state = new SolverState(plan, DEFAULT_WEIGHTS, []);
  const target = plan.shifts[2]!;
  const who = plan.volunteers.find((v) => state.canAdd(v.key, target))!;

  const predicted = state.deltaOfAdd(who.key, target);
  const before = state.score;
  state.add(who.key, target);
  strictEqual(state.score - before, predicted);
});

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

test('a relocation reads as one move, not a removal plus an addition', () => {
  const shifts = [shift('s1', 'alpha', 0, 4), shift('s2', 'alpha', 6, 10)];
  const volunteers = [volunteer('v1', { requestedHours: 4 })];
  const before = makePlan({ shifts, volunteers, assignments: [assign('v1', 's1')] });
  const after = makePlan({ shifts, volunteers, assignments: [assign('v1', 's2')] });

  const proposals = buildProposals(before, after);
  strictEqual(proposals.length, 1);
  strictEqual(proposals[0]!.kind, 'move');
  strictEqual(proposals[0]!.fromShiftKey, 's1');
  strictEqual(proposals[0]!.toShiftKey, 's2');
});

test('a plain arrival and a plain departure keep their own lines', () => {
  const shifts = [shift('s1', 'alpha', 0, 4), shift('s2', 'alpha', 6, 10)];
  const volunteers = [volunteer('a', { requestedHours: 4 }), volunteer('b', { requestedHours: 4 })];
  const before = makePlan({ shifts, volunteers, assignments: [assign('a', 's1')] });
  const after = makePlan({ shifts, volunteers, assignments: [assign('b', 's2')] });

  const proposals = buildProposals(before, after);
  deepStrictEqual(proposals.map((p) => p.kind).sort(), ['add', 'remove']);
});

test('an addition that rescues someone from zero says so', () => {
  const shifts = [shift('s1', 'alpha', 0, 4)];
  const volunteers = [volunteer('v1', { requestedHours: 4 })];
  const before = makePlan({ shifts, volunteers });
  const after = makePlan({ shifts, volunteers, assignments: [assign('v1', 's1')] });

  const proposals = buildProposals(before, after);
  strictEqual(proposals[0]!.kind, 'add');
  ok(proposals[0]!.rationale.includes('plancher'), proposals[0]!.rationale);
});

test('an unchanged plan produces no proposals at all', () => {
  const plan = makePlan({
    shifts: [shift('s1', 'alpha', 0, 4)],
    volunteers: [volunteer('v1', { requestedHours: 4 })],
    assignments: [assign('v1', 's1')],
  });
  deepStrictEqual(buildProposals(plan, plan), []);
});

// ---------------------------------------------------------------------------
// Reserve
// ---------------------------------------------------------------------------

test('someone the plan has nothing for goes on reserve rather than to zero hours', () => {
  const result = solve(makePlan({
    shifts: [shift('s1', 'alpha', 0, 4, 1)],
    volunteers: [volunteer('a', { requestedHours: 4 }), volunteer('b', { requestedHours: 4 })],
  }), { seed: 1, iterations: 300 });

  strictEqual(result.plan.assignments.length, 1);
  strictEqual(result.plan.reserve.length, 1);

  const summary = validate(result.plan).summary;
  strictEqual(summary.volunteersUnassigned, 0, 'nobody is left at zero without an explanation');
  strictEqual(summary.volunteersOnReserve, 1);
});

test('nobody is put on reserve while a place they could take is still open', () => {
  const result = solve(busyPlan(), { seed: 2, iterations: 600 });
  const stale = validate(result.plan).issues.filter((i) => i.code === 'reserve-injustifiee');
  deepStrictEqual(stale.map((i) => i.message), []);
});

test('the 4h floor is a threshold, so hours concentrate rather than spread thin', () => {
  // Eight hours of work and four volunteers. Two people at 4h with two on reserve beats four
  // people at 2h, because 4h is a floor to reach, not a quantity to approach.
  const result = solve(makePlan({
    shifts: [shift('s1', 'alpha', 0, 4, 1), shift('s2', 'alpha', 6, 10, 1)],
    volunteers: [
      volunteer('a', { requestedHours: 4 }), volunteer('b', { requestedHours: 4 }),
      volunteer('c', { requestedHours: 4 }), volunteer('d', { requestedHours: 4 }),
    ],
  }), { seed: 1, iterations: 600 });

  const index = new PlanIndex(result.plan);
  const working = result.plan.volunteers.filter((v) => index.hoursOf(v.key) > 0);
  strictEqual(working.length, 2);
  for (const v of working) strictEqual(index.hoursOf(v.key), 4);
  strictEqual(result.plan.reserve.length, 2);
});

test('a cancellation calls someone up from the reserve', () => {
  const plan = makePlan({
    shifts: [shift('s1', 'alpha', 0, 4, 1)],
    volunteers: [volunteer('a', { requestedHours: 4 }), volunteer('b', { requestedHours: 4 })],
  });
  const first = solve(plan, { seed: 1, iterations: 300 });
  const placed = first.plan.assignments[0]!.volunteerKey;

  const after: Plan = {
    ...first.plan,
    volunteers: first.plan.volunteers.filter((v) => v.key !== placed),
    assignments: [],
    reserve: first.plan.reserve.filter((k) => k !== placed),
  };
  const again = solve(after, { seed: 1, iterations: 300, anchor: after.assignments });

  deepStrictEqual(again.plan.reserve, []);
  strictEqual(again.plan.assignments.length, 1);

  const proposals = buildProposals(after, again.plan, again.dropped);
  ok(proposals.some((p) => p.kind === 'unreserve'), JSON.stringify(proposals));
});

test('joining and leaving the reserve each produce their own proposal line', () => {
  const shifts = [shift('s1', 'alpha', 0, 4, 1)];
  const volunteers = [volunteer('a', { requestedHours: 4 }), volunteer('b', { requestedHours: 4 })];
  const before = makePlan({ shifts, volunteers, assignments: [assign('a', 's1')], reserve: ['b'] });
  const after = makePlan({ shifts, volunteers, assignments: [assign('b', 's1')], reserve: ['a'] });

  const proposals = buildProposals(before, after);
  const kinds = proposals.map((p) => p.kind);
  ok(kinds.includes('reserve'), JSON.stringify(proposals));
  ok(kinds.includes('unreserve'), JSON.stringify(proposals));
  strictEqual(proposals[0]!.kind, 'reserve', 'reserve decisions are read first');
});

// ---------------------------------------------------------------------------
// Keeping a volunteer's day in one place and in one piece
// ---------------------------------------------------------------------------

test('four hours in one place beats two here and two there', () => {
  // Both arrangements are 4h in one unbroken block, and both leave exactly one shift empty, so
  // staffing and volume are level. The volunteer's choice 1 is beta, which pulls the other way.
  const result = solve(makePlan({
    shifts: [
      shift('alpha@0', 'alpha', 0, 2),
      shift('alpha@2', 'alpha', 2, 4),
      shift('beta@2', 'beta', 2, 4),
    ],
    volunteers: [
      volunteer('v1', { requestedHours: 4, choice1PoleKey: 'beta', choice2PoleKey: 'alpha' }),
    ],
  }), { seed: 1, iterations: 200 });

  deepStrictEqual(poleOf(result.plan, 'v1').sort(), ['alpha', 'alpha']);
});

test('a long day stays in one pole rather than splitting across two', () => {
  const result = solve(makePlan({
    shifts: [
      shift('alpha@0', 'alpha', 0, 4),
      shift('alpha@6', 'alpha', 6, 10),
      shift('beta@6', 'beta', 6, 10),
    ],
    volunteers: [
      volunteer('v1', { requestedHours: 8, choice1PoleKey: 'beta', choice2PoleKey: 'alpha' }),
    ],
  }), { seed: 1, iterations: 200 });

  deepStrictEqual(poleOf(result.plan, 'v1').sort(), ['alpha', 'alpha']);
});

test('a split the consecutive cap forces is free, so the hours are still given', () => {
  // 8h cannot be one block under a 4h cap. If the block penalty charged for that, the solver
  // would rather hand out 4h and eat the volume penalty, which is exactly the bug to catch.
  const result = solve(makePlan({
    shifts: [shift('alpha@0', 'alpha', 0, 4), shift('alpha@6', 'alpha', 6, 10)],
    volunteers: [volunteer('v1', { requestedHours: 8 })],
  }), { seed: 1, iterations: 200 });

  strictEqual(hoursOf(result.plan, 'v1'), 8);
});

test('a shift is still filled when the only taker would have to work in a second pole', () => {
  // Staffing outranks tidiness. One volunteer, two poles, both shifts must be covered.
  const result = solve(makePlan({
    shifts: [shift('alpha@0', 'alpha', 0, 2), shift('beta@2', 'beta', 2, 4)],
    volunteers: [volunteer('v1', { requestedHours: 4 })],
  }), { seed: 1, iterations: 200 });

  strictEqual(hoursOf(result.plan, 'v1'), 4);
  deepStrictEqual(poleOf(result.plan, 'v1').sort(), ['alpha', 'beta']);
});

// ---------------------------------------------------------------------------
// Grouping proposals into decisions
// ---------------------------------------------------------------------------

/** Applies proposals the way the screen does, so the tests measure the real thing. */
function applyProposals(plan: Plan, list: readonly Proposal[]): Plan {
  let current = plan;
  for (const p of list) {
    switch (p.kind) {
      case 'reserve':
        current = {
          ...current,
          assignments: current.assignments.filter((a) => a.volunteerKey !== p.volunteerKey),
          reserve: current.reserve.includes(p.volunteerKey)
            ? current.reserve
            : [...current.reserve, p.volunteerKey],
        };
        break;
      case 'unreserve':
        current = { ...current, reserve: current.reserve.filter((k) => k !== p.volunteerKey) };
        break;
      case 'remove':
        current = {
          ...current,
          assignments: current.assignments.filter(
            (a) => !(a.volunteerKey === p.volunteerKey && a.shiftKey === p.fromShiftKey),
          ),
        };
        break;
      case 'move':
        current = {
          ...current,
          assignments: current.assignments.map((a) =>
            a.volunteerKey === p.volunteerKey && a.shiftKey === p.fromShiftKey
              ? { ...a, shiftKey: p.toShiftKey!, source: 'manual' as const }
              : a,
          ),
          reserve: current.reserve.filter((k) => k !== p.volunteerKey),
        };
        break;
      case 'add':
        current = {
          ...current,
          assignments: [
            ...current.assignments,
            {
              volunteerKey: p.volunteerKey,
              shiftKey: p.toShiftKey!,
              locked: false,
              source: 'manual' as const,
            },
          ],
          reserve: current.reserve.filter((k) => k !== p.volunteerKey),
        };
        break;
    }
  }
  return current;
}

/** A group plus everything it says it needs, which is what one click accepts. */
function withPrerequisites(groups: readonly ProposalGroup[], id: number): Proposal[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const seen = new Set<number>();
  const queue = [id];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const need of byId.get(next)?.requires ?? []) queue.push(need);
  }
  return [...seen].sort((a, b) => a - b).flatMap((g) => byId.get(g)!.proposals);
}

test('two people trading places come back as one decision, not two lines', () => {
  // Both shifts are full, so each move needs the place the other gives up. That is a cycle of
  // length two, and a cycle is exactly what must not be splittable.
  //
  // Each volunteer starts in a pole they chose neither, so the exchange is worth 800 an hour to
  // both of them. Anything smaller and the solver rightly refuses to move anyone: two changes
  // cost 400 in stability, which is more than a choice 2 to choice 1 upgrade is worth.
  const before = makePlan({
    shifts: [shift('alpha@0', 'alpha', 0, 4), shift('beta@0', 'beta', 0, 4)],
    volunteers: [
      volunteer('a', { requestedHours: 4, choice1PoleKey: 'alpha', choice2PoleKey: 'alpha' }),
      volunteer('b', { requestedHours: 4, choice1PoleKey: 'beta', choice2PoleKey: 'beta' }),
    ],
    assignments: [assign('a', 'beta@0'), assign('b', 'alpha@0')],
  });

  const result = solve(before, { seed: 1, iterations: 300 });
  const proposals = buildProposals(before, result.plan, result.dropped);
  strictEqual(proposals.length, 2, 'le solveur doit vouloir les intervertir');

  const groups = groupProposals(before, proposals);
  strictEqual(groups.length, 1, 'un échange est une seule décision');
  strictEqual(groups[0]!.proposals.length, 2);
  deepStrictEqual(groups[0]!.requires, []);
  ok(groups[0]!.title.startsWith('Échange entre'), groups[0]!.title);
});

test('two independent changes stay two decisions', () => {
  // Nothing shared: different people, different shifts, and room to spare on both targets.
  const before = makePlan({
    shifts: [
      shift('alpha@0', 'alpha', 0, 4),
      shift('alpha@6', 'alpha', 6, 10),
      shift('beta@0', 'beta', 0, 4),
      shift('beta@6', 'beta', 6, 10),
    ],
    volunteers: [
      volunteer('a', { requestedHours: 4, choice1PoleKey: 'alpha', choice2PoleKey: 'alpha' }),
      volunteer('b', { requestedHours: 4, choice1PoleKey: 'beta', choice2PoleKey: 'beta' }),
    ],
  });

  const result = solve(before, { seed: 1, iterations: 300 });
  const groups = groupProposals(before, buildProposals(before, result.plan, result.dropped));
  ok(groups.length >= 2, 'deux ajouts sans rapport ne doivent pas être liés');
  ok(groups.every((g) => g.requires.length === 0), 'et ne doivent avoir aucun prérequis');
});

test('every group taken with its prerequisites introduces no illegality', () => {
  const seeded = solve(busyPlan(), { seed: 1, iterations: 800 }).plan;
  // A plan somebody has already been editing by hand, which is when a re-solve is asked for.
  const before: Plan = {
    ...seeded,
    assignments: seeded.assignments.filter((_, i) => i % 5 !== 0),
  };

  const result = solve(before, { seed: 4242, iterations: 600 });
  const proposals = buildProposals(before, result.plan, result.dropped);
  const groups = groupProposals(before, proposals);
  ok(groups.length > 1, 'il faut un vrai lot à découper');

  const baseline = validate(before).summary.tier1Count;
  for (const group of groups) {
    const after = validate(applyProposals(before, withPrerequisites(groups, group.id)));
    strictEqual(
      after.summary.tier1Count,
      baseline,
      `"${group.title}" crée une illégalité: ${after.issues
        .filter((i) => i.tier === 1)
        .map((i) => i.message)
        .join(' | ')}`,
    );
  }
});

test('accepting every group lands exactly on the plan the solver proposed', () => {
  const seeded = solve(busyPlan(), { seed: 1, iterations: 800 }).plan;
  const before: Plan = {
    ...seeded,
    assignments: seeded.assignments.filter((_, i) => i % 5 !== 0),
  };

  const result = solve(before, { seed: 4242, iterations: 600 });
  const groups = groupProposals(before, buildProposals(before, result.plan, result.dropped));

  const applied = applyProposals(before, groups.flatMap((g) => g.proposals));
  const keys = (plan: Plan): string[] =>
    plan.assignments.map((a) => `${a.volunteerKey}|${a.shiftKey}`).sort();

  deepStrictEqual(keys(applied), keys(result.plan));
  deepStrictEqual([...applied.reserve].sort(), [...result.plan.reserve].sort());
});

test('no group ever requires itself, directly or through a chain', () => {
  const seeded = solve(busyPlan(), { seed: 1, iterations: 800 }).plan;
  const before: Plan = {
    ...seeded,
    assignments: seeded.assignments.filter((_, i) => i % 5 !== 0),
  };
  const result = solve(before, { seed: 4242, iterations: 600 });
  const groups = groupProposals(before, buildProposals(before, result.plan, result.dropped));

  // Mutual need is what a group IS, so anything left between groups must be a strict order.
  for (const group of groups) {
    ok(
      !withPrerequisitesIds(groups, group.id).some(
        (id) => id !== group.id && groupsRequire(groups, id, group.id),
      ),
      `"${group.title}" est pris dans un cycle entre groupes`,
    );
  }
});

function withPrerequisitesIds(groups: readonly ProposalGroup[], id: number): number[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const seen = new Set<number>();
  const queue = [id];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const need of byId.get(next)?.requires ?? []) queue.push(need);
  }
  return [...seen];
}

const groupsRequire = (groups: readonly ProposalGroup[], from: number, to: number): boolean =>
  withPrerequisitesIds(groups, from).includes(to);

// ---------------------------------------------------------------------------
// Re-solving until there is nothing left to propose
// ---------------------------------------------------------------------------

test('running rounds until convergence really does stop', () => {
  const result = solveToConvergence(busyPlan(), { iterations: 400, seed: 5 });
  ok(result.converged, `arrêté au bout de ${result.rounds} tours sans converger`);
  ok(result.rounds > 1, 'un plan vide doit demander plus d\'un tour');

  // And the round after convergence proposes nothing, which is what "converged" claims.
  const again = solve(result.plan, { iterations: 400, seed: 5 });
  strictEqual(buildProposals(result.plan, again.plan, again.dropped).length, 0);
});

test('convergence never produces a tier 1 issue, however many rounds it runs', () => {
  const result = solveToConvergence(busyPlan(), { iterations: 400, seed: 11 });
  strictEqual(validate(result.plan).summary.tier1Count, 0);
});

test('no locked place is ever proposed for a move, over every round of a convergence', () => {
  // The promise the "recalculer jusqu'à stabilité" button leans on. One round honouring locks
  // is not enough on its own: the button runs a dozen, and a single slip in any of them would
  // move somebody the régisseur had pinned.
  const seeded = solve(busyPlan(), { seed: 1, iterations: 600 }).plan;
  // Locks on a third of the plan, and a hole punched in the rest so the search has real work to
  // do over several rounds. A plan already at its optimum converges in one round and would prove
  // nothing about what happens on the tenth.
  const locked: Plan = {
    ...seeded,
    assignments: seeded.assignments
      .map((a, i) => (i % 3 === 0 ? { ...a, locked: true } : a))
      .filter((a, i) => a.locked || i % 4 !== 0),
  };
  const pinned = new Set(
    locked.assignments.filter((a) => a.locked).map((a) => `${a.volunteerKey}|${a.shiftKey}`),
  );
  ok(pinned.size > 5, 'il faut de vrais verrous à tester');

  const result = solveToConvergence(locked, { iterations: 400, seed: 3 });
  ok(result.rounds > 1, 'la convergence doit avoir tourné plusieurs fois');

  // Still there, still locked, after every round.
  for (const key of pinned) {
    ok(
      result.plan.assignments.some((a) => `${a.volunteerKey}|${a.shiftKey}` === key && a.locked),
      `place verrouillée perdue: ${key}`,
    );
  }

  // And nothing in the batch handed to the régisseur touches one of them.
  const proposals = buildProposals(locked, result.plan, result.dropped);
  for (const proposal of proposals) {
    for (const shiftKey of [proposal.fromShiftKey, proposal.toShiftKey]) {
      if (!shiftKey) continue;
      ok(
        !pinned.has(`${proposal.volunteerKey}|${shiftKey}`),
        `proposition sur une place verrouillée: ${proposal.volunteerName} ${proposal.kind}`,
      );
    }
    // A reserve line would strip every shift the person holds, locked ones included.
    if (proposal.kind === 'reserve') {
      ok(
        ![...pinned].some((key) => key.startsWith(`${proposal.volunteerKey}|`)),
        `mise en réserve d'une personne verrouillée: ${proposal.volunteerName}`,
      );
    }
  }
});

test('convergence stops on its round cap rather than running forever', () => {
  const result = solveToConvergence(busyPlan(), { iterations: 50, seed: 2, maxRounds: 2 });
  strictEqual(result.rounds, 2);
  ok(!result.converged, 'atteindre le plafond doit être signalé, pas masqué');
});

test('a plan the loop calls settled yields nothing to a plain re-solve', () => {
  // The bug a régisseur reported: "Jusqu'à stabilité" finished, they accepted everything, and
  // pressing "Recalculer" found more work. The cause was that convergence was a property of the
  // seed that round happened to use, not of the plan. This is the promise, and the only way to
  // check it is the way the button does it: with no seed at all.
  const start = solve(busyPlan(), { iterations: 400 }).plan;
  const converged = solveToConvergence(start, { iterations: 400 });
  ok(converged.converged, `arrêté au bout de ${converged.rounds} tours sans se stabiliser`);

  const again = solve(converged.plan, { iterations: 400 });
  strictEqual(
    buildProposals(converged.plan, again.plan, again.dropped).length,
    0,
    'un nouveau calcul sur un plan stabilisé ne doit rien proposer',
  );
});

test('the default seed is the plan, so the same plan always runs the same search', () => {
  const plan = solve(busyPlan(), { iterations: 300 }).plan;

  // Twice with no seed: identical, because the seed comes from the plan.
  const once = solve(plan, { iterations: 300 });
  const twice = solve(plan, { iterations: 300 });
  deepStrictEqual(
    once.plan.assignments.map((a) => `${a.volunteerKey}|${a.shiftKey}`).sort(),
    twice.plan.assignments.map((a) => `${a.volunteerKey}|${a.shiftKey}`).sort(),
  );

  // Two different plans get different seeds, or a convergence could never end.
  const other = makePlan({
    shifts: [shift('s1', 'alpha', 0, 4)],
    volunteers: [volunteer('v1', { requestedHours: 4 })],
  });
  ok(planSeed(plan) !== planSeed(other));

  // And the seed is a property of the placements, not of the order they are stored in.
  const shuffled: Plan = { ...plan, assignments: [...plan.assignments].reverse() };
  strictEqual(planSeed(shuffled), planSeed(plan));
});

test('one quiet round is not enough to call a plan settled', () => {
  // stableRounds: 1 is the old, broken rule, kept reachable so the difference is measurable
  // rather than a story. It stops earlier, and on fewer rounds.
  const start = solve(busyPlan(), { iterations: 400 }).plan;
  const weak = solveToConvergence(start, { iterations: 400, stableRounds: 1 });
  const strong = solveToConvergence(start, { iterations: 400, stableRounds: 3 });

  ok(
    strong.rounds > weak.rounds,
    `trois tours calmes doivent en demander plus qu'un seul: ${strong.rounds} contre ${weak.rounds}`,
  );
});

// ---------------------------------------------------------------------------
// A locked pole: the solver leaves it alone, the boxes keep their own flags
// ---------------------------------------------------------------------------

test('the solver changes nothing inside a locked pole', () => {
  const seeded = solve(busyPlan(), { seed: 1, iterations: 600 }).plan;
  // A hole punched elsewhere, so the search has a reason to want to raid the locked pole.
  const before: Plan = {
    ...seeded,
    poles: seeded.poles.map((p) => (p.key === 'alpha' ? { ...p, locked: true } : p)),
    assignments: seeded.assignments.filter(
      (a) => a.shiftKey.startsWith('alpha@') || Math.random() > 0,
    ),
  };
  const alphaBefore = before.assignments
    .filter((a) => a.shiftKey.startsWith('alpha@'))
    .map((a) => `${a.volunteerKey}|${a.shiftKey}`)
    .sort();
  ok(alphaBefore.length > 3, 'il faut du monde dans le pôle verrouillé');

  const result = solve(before, { seed: 9, iterations: 600 });
  const alphaAfter = result.plan.assignments
    .filter((a) => a.shiftKey.startsWith('alpha@'))
    .map((a) => `${a.volunteerKey}|${a.shiftKey}`)
    .sort();

  deepStrictEqual(alphaAfter, alphaBefore, 'ni retrait, ni ajout, ni déplacement dans ce pôle');
});

test('locking a pole never writes a lock into its boxes', () => {
  // The whole point of the separation: unlocking the pole afterwards must not leave every place
  // in it individually pinned forever.
  const seeded = solve(busyPlan(), { seed: 1, iterations: 400 }).plan;
  ok(seeded.assignments.every((a) => !a.locked), 'départ sans aucune case verrouillée');

  const locked: Plan = {
    ...seeded,
    poles: seeded.poles.map((p) => (p.key === 'alpha' ? { ...p, locked: true } : p)),
  };
  const result = solve(locked, { seed: 4, iterations: 400 });

  strictEqual(
    result.plan.assignments.filter((a) => a.locked).length,
    0,
    'le verrou de pôle ne doit pas contaminer les cases',
  );
});

test('a locked pole and a locked box are different things, and both hold at once', () => {
  const seeded = solve(busyPlan(), { seed: 1, iterations: 400 }).plan;
  const boxed = seeded.assignments.find((a) => a.shiftKey.startsWith('beta@'))!;

  const plan: Plan = {
    ...seeded,
    poles: seeded.poles.map((p) => (p.key === 'alpha' ? { ...p, locked: true } : p)),
    assignments: seeded.assignments.map((a) =>
      a === boxed ? { ...a, locked: true } : { ...a, locked: false },
    ),
  };

  const result = solve(plan, { seed: 5, iterations: 400 });

  // The box keeps its own lock and its place.
  ok(
    result.plan.assignments.some(
      (a) => a.volunteerKey === boxed.volunteerKey && a.shiftKey === boxed.shiftKey && a.locked,
    ),
    'la case verrouillée reste verrouillée et en place',
  );
  // And it is the only locked one: the frozen pole added none.
  strictEqual(result.plan.assignments.filter((a) => a.locked).length, 1);
});

test('a locked pole covers its sub-poles', () => {
  const poles = [
    pole('bar'),
    pole('bar--service', { parentKey: 'bar', path: 'bar / service' }),
  ];
  const shifts = [shift('bar--service@0', 'bar--service', 0, 4, 2)];
  const volunteers = [
    volunteer('a', { requestedHours: 4, choice1PoleKey: 'bar--service', choice2PoleKey: 'bar--service' }),
    volunteer('b', { requestedHours: 4, choice1PoleKey: 'bar--service', choice2PoleKey: 'bar--service' }),
  ];

  const before = makePlan({
    poles: poles.map((p) => (p.key === 'bar' ? { ...p, locked: true } : p)),
    shifts,
    volunteers,
    assignments: [assign('a', 'bar--service@0')],
  });

  const result = solve(before, { seed: 1, iterations: 200 });
  strictEqual(
    result.plan.assignments.length,
    1,
    'verrouiller Bar verrouille Bar / Service avec lui, donc b n\'est pas ajouté',
  );
});

test('a re-solve hands back the places of somebody who cancelled, and gives them nothing', () => {
  const plan = makePlan({
    shifts: [shift('s1', 'alpha', 0, 4, 2)],
    volunteers: [volunteer('v1', { status: 'annule' }), volunteer('v2')],
    assignments: [assign('v1', 's1')],
  });
  const result = solve(plan, { seed: 1, iterations: 200 });
  strictEqual(result.dropped.length, 1, 'la place est proposée au retrait, pas effacée');
  ok(!result.plan.assignments.some((a) => a.volunteerKey === 'v1'));
  ok(!result.plan.reserve.includes('v1'), "pas de liste d'attente pour une annulation");
});
