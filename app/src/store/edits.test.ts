/**
 * The edits, tested against the two promises the brief makes about them.
 *
 * Nothing is silently dropped or reassigned: an edit touches exactly what it says it touches and
 * leaves the rest of the plan identical. And accepting a whole batch of proposals lands on
 * exactly the plan the solver proposed, which is what makes "accept all" trustworthy.
 *
 *   npm test    (in app/)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PlanIndex,
  buildProposals,
  isLegal,
  solve,
  validate,
  type Assignment,
  type Plan,
} from '../engine.ts';
import {
  addOrganiserToShift,
  assign,
  moveOrganiserToShift,
  clearUnlocked,
  rememberSheet,
  correctVolunteer,
  markReviewed,
  move,
  setHeadcount,
  setLocked,
  setReserve,
  swap,
  unassign,
} from './edits.ts';
import { applyProposals } from './applyProposals.ts';

const here = dirname(fileURLToPath(import.meta.url));

const loadFixture = (file: string): Plan =>
  JSON.parse(readFileSync(join(here, '..', '..', 'public', 'fixtures', file), 'utf8')) as Plan;

/** A solved, real-sized plan: 120 volunteers, 91 shifts, a few hundred assignments. */
const basePlan = loadFixture('balanced.json');

const keyOf = (a: Assignment): string => `${a.volunteerKey}|${a.shiftKey}`;
const keySet = (plan: Plan): Set<string> => new Set(plan.assignments.map(keyOf));

const sameBox = (a: Assignment, volunteerKey: string, shiftKey: string): boolean =>
  a.volunteerKey === volunteerKey && a.shiftKey === shiftKey;

/** The whole plan except its assignments and reserve, to prove an edit left it alone. */
const skeleton = (plan: Plan): string =>
  JSON.stringify({ poles: plan.poles, shifts: plan.shifts, volunteers: plan.volunteers, buddies: plan.buddies });

test('a fixture is there to test against', () => {
  assert.ok(basePlan.volunteers.length > 50, 'lancez `npm run fixture -- --all` dans tools/');
  assert.ok(basePlan.assignments.length > 100);
});

test('no edit mutates the plan it was given', () => {
  const before = JSON.stringify(basePlan);
  const first = basePlan.assignments[0]!;
  assign(basePlan, basePlan.volunteers[0]!.key, basePlan.shifts[0]!.key);
  unassign(basePlan, first.volunteerKey, first.shiftKey);
  move(basePlan, first.volunteerKey, first.shiftKey, basePlan.shifts[0]!.key);
  setReserve(basePlan, basePlan.volunteers[0]!.key, true);
  setHeadcount(basePlan, basePlan.shifts[0]!.key, 9);
  clearUnlocked(basePlan);
  assert.equal(JSON.stringify(basePlan), before);
});

test('assign adds exactly one box and takes the person off the reserve', () => {
  const volunteerKey = basePlan.volunteers[0]!.key;
  const reserved = setReserve(basePlan, volunteerKey, true);
  assert.ok(reserved.reserve.includes(volunteerKey));

  const shiftKey = basePlan.shifts[0]!.key;
  const after = assign(reserved, volunteerKey, shiftKey);

  assert.equal(after.assignments.length, reserved.assignments.length + 1);
  assert.ok(keySet(after).has(`${volunteerKey}|${shiftKey}`));
  assert.ok(!after.reserve.includes(volunteerKey), 'être placé et être en réserve s\'excluent');
  assert.equal(skeleton(after), skeleton(reserved));
});

test('assign twice is the same as assign once', () => {
  const { volunteerKey, shiftKey } = basePlan.assignments[3]!;
  const after = assign(basePlan, volunteerKey, shiftKey);
  assert.equal(after.assignments.length, basePlan.assignments.length);
});

test('unassign removes exactly one box and leaves every other one alone', () => {
  const target = basePlan.assignments[5]!;
  const after = unassign(basePlan, target.volunteerKey, target.shiftKey);

  assert.equal(after.assignments.length, basePlan.assignments.length - 1);
  const removed = [...keySet(basePlan)].filter((k) => !keySet(after).has(k));
  assert.deepEqual(removed, [keyOf(target)]);
});

test('move takes one box out and puts one box in, and touches nothing else', () => {
  const source = basePlan.assignments.find((a) => !a.locked)!;
  const target = basePlan.shifts.find(
    (s) =>
      s.key !== source.shiftKey &&
      !basePlan.assignments.some((a) => sameBox(a, source.volunteerKey, s.key)),
  )!;

  const after = move(basePlan, source.volunteerKey, source.shiftKey, target.key);
  const moved = after.assignments.find((a) => sameBox(a, source.volunteerKey, target.key));

  assert.ok(moved, 'la personne est sur le nouveau créneau');
  assert.equal(moved.source, 'manual');
  assert.equal(moved.locked, false, "un déplacement à la main ne verrouille rien");
  assert.equal(after.assignments.length, basePlan.assignments.length, 'un dedans, un dehors');
  assert.ok(!keySet(after).has(keyOf(source)));
  assert.equal(skeleton(after), skeleton(basePlan));
});

test('moving onto a shift the person already holds does not duplicate them', () => {
  // Somebody holding two shifts, so the second can be the target of a move from the first.
  const byVolunteer = new Map<string, string[]>();
  for (const a of basePlan.assignments) {
    byVolunteer.set(a.volunteerKey, [...(byVolunteer.get(a.volunteerKey) ?? []), a.shiftKey]);
  }
  const entry = [...byVolunteer.entries()].find(([, shifts]) => shifts.length >= 2);
  assert.ok(entry, 'il faut quelqu\'un avec deux créneaux');
  const [volunteerKey, shifts] = entry;

  const after = move(basePlan, volunteerKey, shifts[0]!, shifts[1]!);
  const held = after.assignments.filter((a) => a.volunteerKey === volunteerKey);
  assert.equal(held.length, shifts.length - 1, 'la source disparaît, la cible n\'est pas doublée');
  assert.equal(held.filter((a) => a.shiftKey === shifts[1]).length, 1);
  assert.equal(held.filter((a) => a.shiftKey === shifts[0]).length, 0);
});

test('swap exchanges two people and never passes through an over-staffed state', () => {
  const first = basePlan.assignments[0]!;
  // Neither of them may already hold the other's shift, or this is the duplicate case below
  // rather than a plain exchange.
  const second = basePlan.assignments.find(
    (a) =>
      a.shiftKey !== first.shiftKey &&
      a.volunteerKey !== first.volunteerKey &&
      !basePlan.assignments.some((b) => sameBox(b, first.volunteerKey, a.shiftKey)) &&
      !basePlan.assignments.some((b) => sameBox(b, a.volunteerKey, first.shiftKey)),
  )!;

  const after = swap(
    basePlan,
    { volunteerKey: first.volunteerKey, shiftKey: first.shiftKey },
    { volunteerKey: second.volunteerKey, shiftKey: second.shiftKey },
  );

  assert.equal(after.assignments.length, basePlan.assignments.length);
  const keys = keySet(after);
  assert.ok(keys.has(`${first.volunteerKey}|${second.shiftKey}`));
  assert.ok(keys.has(`${second.volunteerKey}|${first.shiftKey}`));
  assert.ok(!keys.has(keyOf(first)));
  assert.ok(!keys.has(keyOf(second)));

  // The headcount of both shifts is unchanged, which is the whole reason swap is one edit.
  const before = new PlanIndex(basePlan);
  const now = new PlanIndex(after);
  assert.equal(now.assigneeCount(first.shiftKey), before.assigneeCount(first.shiftKey));
  assert.equal(now.assigneeCount(second.shiftKey), before.assigneeCount(second.shiftKey));
});

test('the reserve means zero hours, so joining it gives up every shift', () => {
  const assigned = basePlan.assignments[10]!.volunteerKey;
  const after = setReserve(basePlan, assigned, true);

  assert.ok(after.reserve.includes(assigned));
  assert.equal(after.assignments.filter((a) => a.volunteerKey === assigned).length, 0);
  assert.equal(
    after.assignments.length,
    basePlan.assignments.length -
      basePlan.assignments.filter((a) => a.volunteerKey === assigned).length,
  );

  const back = setReserve(after, assigned, false);
  assert.ok(!back.reserve.includes(assigned));
  assert.equal(back.assignments.length, after.assignments.length, 'sortir de la réserve ne replace personne');
});

test('setHeadcount rounds and never goes below zero', () => {
  const shiftKey = basePlan.shifts[0]!.key;
  assert.equal(setHeadcount(basePlan, shiftKey, -4).shifts.find((s) => s.key === shiftKey)!.headcount, 0);
  assert.equal(setHeadcount(basePlan, shiftKey, 3.6).shifts.find((s) => s.key === shiftKey)!.headcount, 4);
});

test('lowering a headcount under the people already placed is allowed and reported', () => {
  const busy = [...new Set(basePlan.assignments.map((a) => a.shiftKey))]
    .map((key) => ({ key, count: basePlan.assignments.filter((a) => a.shiftKey === key).length }))
    .find((s) => s.count >= 2)!;

  const after = setHeadcount(basePlan, busy.key, busy.count - 1);
  const issues = validate(after).shifts.find((s) => s.key === busy.key)!.issues;
  assert.ok(
    issues.some((i) => i.code === 'sureffectif'),
    'le sureffectif est signalé, pas empêché, et personne n\'est retiré',
  );
  assert.equal(after.assignments.length, basePlan.assignments.length);
});

test('clearUnlocked keeps every locked box and nothing else', () => {
  const withLocks: Plan = {
    ...basePlan,
    assignments: basePlan.assignments.map((a, i) => (i % 7 === 0 ? { ...a, locked: true } : a)),
  };
  const after = clearUnlocked(withLocks);
  assert.ok(after.assignments.length > 0);
  assert.ok(after.assignments.every((a) => a.locked));
  assert.equal(after.assignments.length, withLocks.assignments.filter((a) => a.locked).length);
});

/**
 * A plan the solver has something to say about.
 *
 * The fixtures ship already solved at 3000 iterations, so re-solving them proposes nothing at
 * all. Pulling a seventh of the assignments out reproduces the real situation instead: the
 * régisseur has moved people around by hand and then asks for a re-solve.
 */
const perturbed: Plan = {
  ...basePlan,
  assignments: basePlan.assignments.filter((_, i) => i % 7 !== 0),
};

test('accepting every proposal lands exactly on the plan the solver proposed', () => {
  const result = solve(perturbed, { iterations: 300, seed: 4242 });
  const proposals = buildProposals(perturbed, result.plan, result.dropped);
  assert.ok(proposals.length > 0, 'le solveur doit avoir quelque chose à proposer');

  const applied = applyProposals(perturbed, proposals);

  assert.deepEqual(
    [...keySet(applied)].sort(),
    [...keySet(result.plan)].sort(),
    'accepter tout le lot donne les mêmes affectations que le solveur',
  );
  assert.deepEqual(
    [...applied.reserve].sort(),
    [...result.plan.reserve].sort(),
    'et la même réserve',
  );
  assert.equal(validate(applied).summary.tier1Count, 0, 'et aucune illégalité');
});

/**
 * Half a batch is not half a plan.
 *
 * Accepting an addition while rejecting the move that was going to free the place leaves the
 * shift over its headcount. That is a legitimate outcome, like any manual edit: the tool shows
 * it in red rather than refusing it. What must not happen is the régisseur finding out
 * afterwards, which is why the proposals screen validates the accepted selection before
 * applying it. This test exists to keep that warning honest by proving it has something to
 * fire on.
 */
test('a partly accepted batch can go over headcount, and it is visible before applying', () => {
  const result = solve(perturbed, { iterations: 300, seed: 4242 });
  const proposals = buildProposals(perturbed, result.plan, result.dropped);

  const additionsOnly = proposals.filter((p) => p.kind === 'add');
  const moves = proposals.filter((p) => p.kind === 'move');
  assert.ok(additionsOnly.length > 0 && moves.length > 0, 'il faut des ajouts et des déplacements');

  const preview = validate(applyProposals(perturbed, additionsOnly));
  assert.ok(
    preview.summary.tier1Count > 0,
    'accepter les ajouts en rejetant les déplacements doit produire un sureffectif visible',
  );
  assert.ok(
    preview.issues.some((i) => i.code === 'sureffectif'),
    'et il doit être nommé, pas juste compté',
  );
});

test('isLegal agrees with what a move actually produces', () => {
  const source = basePlan.assignments.find((a) => !a.locked)!;
  const withoutSource: Plan = {
    ...basePlan,
    assignments: basePlan.assignments.filter((a) => keyOf(a) !== keyOf(source)),
  };
  const context = new PlanIndex(withoutSource);
  const volunteer = context.volunteerByKey.get(source.volunteerKey)!;

  const legal = basePlan.shifts.filter((s) => isLegal(context, volunteer, s));
  assert.ok(legal.length > 0, 'la grille doit proposer au moins une cible');

  // Dropping on a target the grid would have shown as legal must not turn the plan red.
  const before = validate(basePlan).summary.tier1Count;
  const after = validate(move(basePlan, source.volunteerKey, source.shiftKey, legal[0]!.key));
  assert.equal(after.summary.tier1Count, before);
});

test('swapping somebody onto a shift they already hold does not duplicate them', () => {
  // A volunteer with two shifts can have one of their boxes dragged onto a person standing in
  // the other. Sending them there would put the same person on the same shift twice, which is
  // the `doublon` rule and a state nothing should ever produce.
  const byVolunteer = new Map<string, string[]>();
  for (const a of basePlan.assignments) {
    byVolunteer.set(a.volunteerKey, [...(byVolunteer.get(a.volunteerKey) ?? []), a.shiftKey]);
  }
  const entry = [...byVolunteer.entries()].find(([volunteerKey, shifts]) => {
    if (shifts.length < 2) return false;
    // Somebody else standing on their second shift, to be the target of the drop.
    return basePlan.assignments.some(
      (a) => a.shiftKey === shifts[1] && a.volunteerKey !== volunteerKey,
    );
  });
  assert.ok(entry, 'il faut quelqu\'un avec deux créneaux et un voisin sur le second');
  const [volunteerKey, shifts] = entry;
  const neighbour = basePlan.assignments.find(
    (a) => a.shiftKey === shifts[1] && a.volunteerKey !== volunteerKey,
  )!;

  const after = swap(
    basePlan,
    { volunteerKey, shiftKey: shifts[0]! },
    { volunteerKey: neighbour.volunteerKey, shiftKey: neighbour.shiftKey },
  );

  const held = after.assignments.filter((a) => a.volunteerKey === volunteerKey);
  assert.equal(held.length, shifts.length - 1, 'la case tirée disparaît');
  assert.equal(
    held.filter((a) => a.shiftKey === shifts[1]).length,
    1,
    'et la personne reste une seule fois sur le créneau où elle était déjà',
  );
  assert.equal(
    validate(after).issues.filter((i) => i.code === 'doublon').length,
    0,
    'aucun doublon ne doit être créé',
  );

  // The other person still makes the trip, so nobody is silently left where they were.
  assert.ok(
    after.assignments.some(
      (a) => a.volunteerKey === neighbour.volunteerKey && a.shiftKey === shifts[0],
    ),
  );
});

// ---------------------------------------------------------------------------
// The lock, honoured by hand as well as by the solver
// ---------------------------------------------------------------------------

/** The plan with one box pinned, plus the keys of that box. */
function withLockedBox(): { plan: Plan; volunteerKey: string; shiftKey: string } {
  const target = basePlan.assignments[4]!;
  return {
    plan: {
      ...basePlan,
      assignments: basePlan.assignments.map((a) =>
        keyOf(a) === keyOf(target) ? { ...a, locked: true } : a,
      ),
    },
    volunteerKey: target.volunteerKey,
    shiftKey: target.shiftKey,
  };
}

test('a locked box refuses to be moved', () => {
  const { plan, volunteerKey, shiftKey } = withLockedBox();
  const target = basePlan.shifts.find(
    (s) => s.key !== shiftKey && !plan.assignments.some((a) => sameBox(a, volunteerKey, s.key)),
  )!;

  const after = move(plan, volunteerKey, shiftKey, target.key);
  assert.equal(after, plan, "le plan doit revenir inchangé, à l'identique");
});

test('a locked box refuses to be removed', () => {
  const { plan, volunteerKey, shiftKey } = withLockedBox();
  assert.equal(unassign(plan, volunteerKey, shiftKey), plan);
});

test('an exchange is refused when either side is locked', () => {
  const { plan, volunteerKey, shiftKey } = withLockedBox();
  const other = plan.assignments.find(
    (a) => !a.locked && a.shiftKey !== shiftKey && a.volunteerKey !== volunteerKey,
  )!;

  // Locked on the dragged side.
  assert.equal(
    swap(plan, { volunteerKey, shiftKey }, { volunteerKey: other.volunteerKey, shiftKey: other.shiftKey }),
    plan,
  );
  // And locked on the target side, which is the case a screen could easily forget.
  assert.equal(
    swap(plan, { volunteerKey: other.volunteerKey, shiftKey: other.shiftKey }, { volunteerKey, shiftKey }),
    plan,
  );
});

test('the reserve refuses somebody holding a locked place, rather than half-emptying their day', () => {
  const { plan, volunteerKey } = withLockedBox();
  assert.equal(setReserve(plan, volunteerKey, true), plan);

  // Unlocking is the way through, and it works.
  const unlocked = setLocked(plan, volunteerKey, withLockedBox().shiftKey, false);
  const reserved = setReserve(unlocked, volunteerKey, true);
  assert.ok(reserved.reserve.includes(volunteerKey));
  assert.equal(reserved.assignments.filter((a) => a.volunteerKey === volunteerKey).length, 0);
});

test('unlocking then moving works, so the lock is a step and not a dead end', () => {
  const { plan, volunteerKey, shiftKey } = withLockedBox();
  const target = basePlan.shifts.find(
    (s) => s.key !== shiftKey && !plan.assignments.some((a) => sameBox(a, volunteerKey, s.key)),
  )!;

  const after = move(setLocked(plan, volunteerKey, shiftKey, false), volunteerKey, shiftKey, target.key);
  assert.ok(after.assignments.some((a) => sameBox(a, volunteerKey, target.key)));
  assert.ok(!after.assignments.some((a) => sameBox(a, volunteerKey, shiftKey)));
});

test('a lock never blocks anything but its own box', () => {
  const { plan, volunteerKey, shiftKey } = withLockedBox();
  const other = plan.assignments.find(
    (a) => !a.locked && a.shiftKey !== shiftKey && a.volunteerKey !== volunteerKey,
  )!;

  const after = unassign(plan, other.volunteerKey, other.shiftKey);
  assert.equal(after.assignments.length, plan.assignments.length - 1);
});

// ---------------------------------------------------------------------------
// Corriger une fiche à la main
// ---------------------------------------------------------------------------

test('correcting a fiche records which fields were corrected, and touches nobody else', () => {
  const target = basePlan.volunteers[0]!;
  const after = correctVolunteer(basePlan, target.key, { refusedSlotIds: ['00h-06h'] });
  const fixed = after.volunteers.find((v) => v.key === target.key)!;

  assert.deepEqual(fixed.refusedSlotIds, ['00h-06h']);
  assert.deepEqual(
    fixed.manualFields,
    ['refusedSlotIds'],
    'la liste est ce qui protège la correction du prochain import',
  );
  assert.deepEqual(
    after.volunteers.filter((v) => v.key !== target.key),
    basePlan.volunteers.filter((v) => v.key !== target.key),
    'personne d\u2019autre ne bouge',
  );
  assert.deepEqual(after.assignments, basePlan.assignments, 'et aucune affectation non plus');
});

test('a second correction adds to the list rather than replacing it', () => {
  const target = basePlan.volunteers[0]!;
  const once = correctVolunteer(basePlan, target.key, { refusedSlotIds: [] });
  const twice = correctVolunteer(once, target.key, { phone: '0611223344' });
  const fixed = twice.volunteers.find((v) => v.key === target.key)!;
  assert.deepEqual(fixed.manualFields, ['phone', 'refusedSlotIds']);
});

test('an empty correction changes nothing at all, not even the fiche', () => {
  const target = basePlan.volunteers[0]!;
  assert.equal(correctVolunteer(basePlan, target.key, {}), basePlan);
});

test('validating a fiche clears the tag and the reasons, and nothing else', () => {
  const target = basePlan.volunteers[0]!;
  const flagged = {
    ...basePlan,
    volunteers: basePlan.volunteers.map((v) =>
      v.key === target.key
        ? { ...v, needsReview: true, reviewReasons: ['un doute'] }
        : v,
    ),
  };
  const after = markReviewed(flagged, target.key);
  const read = after.volunteers.find((v) => v.key === target.key)!;
  assert.equal(read.needsReview, false);
  assert.deepEqual(read.reviewReasons, []);
  assert.deepEqual(
    read.refusedSlotIds,
    target.refusedSlotIds,
    'relire n\u2019est pas corriger: les réponses ne bougent pas',
  );
});

test('the Google Sheet link is remembered on the plan, trimmed, and only when it changes', () => {
  const url = ' https://docs.google.com/spreadsheets/d/abc/edit ';
  const after = rememberSheet(basePlan, url);
  assert.equal(after.sheetUrl, 'https://docs.google.com/spreadsheets/d/abc/edit');

  // Re-importing from the same sheet must not produce a save, an undo step and a journal line
  // every time: the same link is not a change.
  assert.equal(rememberSheet(after, url), after);
  assert.deepEqual(
    { ...after, sheetUrl: basePlan.sheetUrl },
    basePlan,
    'et rien d\u2019autre du planning ne bouge',
  );
});

/*
 * An orga's place in a créneau, dragged from one to another since 2026-09-12.
 */
test('moving an orga is one edit, so undoing it puts them back rather than losing them', () => {
  const from = basePlan.shifts[0]!;
  const to = basePlan.shifts.find((s) => s.key !== from.key)!;
  const withOrga: Plan = {
    ...basePlan,
    organisers: [
      {
        key: 'o1', firstName: 'Camille', lastName: 'Dubois', email: '', phone: '',
        accessCode: '', diet: '', allergies: '', note: '',
        montageFrom: null, demontageUntil: null, montagePoleKeys: [], demontagePoleKeys: [],
      },
    ],
  };

  const placed = addOrganiserToShift(withOrga, 'o1', from.key);
  const moved = moveOrganiserToShift(placed, 'o1', from.key, to.key);

  assert.equal(moved.organiserShifts.length, 1, 'toujours une seule place tenue');
  assert.equal(moved.organiserShifts[0]!.shiftKey, to.key);
  assert.equal(moved.assignments.length, basePlan.assignments.length, 'aucun bénévole ne bouge');

  // A move onto the créneau they are already on is not a change, so it writes nothing and leaves
  // no entry in the undo stack.
  assert.equal(moveOrganiserToShift(moved, 'o1', to.key, to.key), moved);
});
