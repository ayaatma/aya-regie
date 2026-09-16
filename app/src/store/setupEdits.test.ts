/**
 * The Réglages edits, tested against the one rule they all have to obey.
 *
 * Several of them destroy assignments: deleting a pole deletes its shifts, deleting a shift
 * removes the people standing in it. That is allowed. What is not allowed is doing it quietly,
 * or moving somebody somewhere else to keep the numbers tidy, or rewriting what a volunteer
 * said they wanted so the data stops dangling.
 *
 *   npm test    (in app/)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PlanIndex, validate, type Plan } from '../engine.ts';
import {
  addArtist,
  addLeaderOnPole,
  assignOrganiserToPole,
  assignOrganiserToPoleAt,
  removeLeaderRole,
  giveOrganiserCode,
  clearOrganiserCode,
  addPole,
  addShift,
  canMovePole,
  deleteArtist,
  FALLBACK_SHIFT_HOURS,
  defaultShiftHours,
  setEventShiftHours,
  setPoleShiftHours,
  shiftHoursByHand,
  deleteOrganiser,
  deletePole,
  deleteShift,
  duplicatePole,
  movePole,
  poleCopyPreview,
  poleRemovalCost,
  regenerateCost,
  regenerateShifts,
  renamePole,
  setPoleDefaults,
  setArtist,
  setEventLength,
  setEventName,
  setEventStart,
  setOrganiserWindow,
  setPoleLocked,
  setRules,
  setShiftWindow,
  updateOrganiser,
} from './setupEdits.ts';

const here = dirname(fileURLToPath(import.meta.url));

const plan = JSON.parse(
  readFileSync(join(here, '..', '..', 'public', 'fixtures', 'balanced.json'), 'utf8'),
) as Plan;

const index = new PlanIndex(plan);
const aRoot = plan.poles.find((p) => p.parentKey === null && plan.poles.some((c) => c.parentKey === p.key))!;
const aLeaf = plan.poles.find((p) => p.parentKey !== null)!;

test('no setup edit mutates the plan it was given', () => {
  const before = JSON.stringify(plan);
  setRules(plan, { maxBlocks: 9 });
  addPole(plan, 'Essai', null);
  renamePole(plan, aRoot.key, 'Autre');
  setPoleDefaults(plan, aRoot.key, { defaultHeadcount: 9 });
  deletePole(plan, aLeaf.key);
  addShift(plan, aLeaf.key, 0, 2);
  deleteShift(plan, plan.shifts[0]!.key);
  setShiftWindow(plan, plan.shifts[0]!.key, 1, 3);
  regenerateShifts(plan, aLeaf.key, { from: 0, to: 8, block: 4 });
  addLeaderOnPole(plan, aRoot.key, 'Untel');
  duplicatePole(plan, aLeaf.key);
  movePole(plan, aLeaf.key, 1);
  assert.equal(JSON.stringify(plan), before);
});

test('deleting a pole says its price beforehand, and the price is right', () => {
  const cost = poleRemovalCost(plan, aRoot.key);
  assert.ok(cost.poles > 1, 'un pôle avec des sous-pôles doit en compter plusieurs');
  assert.ok(cost.shifts > 0 && cost.assignments > 0);

  const after = deletePole(plan, aRoot.key);
  assert.equal(plan.poles.length - after.poles.length, cost.poles);
  assert.equal(plan.shifts.length - after.shifts.length, cost.shifts);
  assert.equal(plan.assignments.length - after.assignments.length, cost.assignments);
});

test('deleting a pole never rewrites what a volunteer said they wanted', () => {
  const cost = poleRemovalCost(plan, aRoot.key);
  assert.ok(cost.choices > 0, 'des bénévoles doivent avoir choisi ce pôle');

  const after = deletePole(plan, aRoot.key);
  assert.deepEqual(
    after.volunteers.map((v) => JSON.stringify([v.choices, v.refusedPoleKeys])),
    plan.volunteers.map((v) => JSON.stringify([v.choices, v.refusedPoleKeys])),
    'les réponses au formulaire sont conservées telles quelles',
  );
});

test('deleting a pole leaves the rest of the plan untouched and legal', () => {
  const after = deletePole(plan, aLeaf.key);
  const survivors = new Set(after.shifts.map((s) => s.key));
  for (const a of after.assignments) {
    assert.ok(survivors.has(a.shiftKey), 'aucune affectation orpheline ne doit rester');
  }
  assert.equal(
    validate(after).issues.filter((i) => i.code === 'reference-inconnue').length,
    0,
  );
});

test('renaming a pole rewrites its path and every sub-pole path under it', () => {
  const after = renamePole(plan, aRoot.key, 'Nouveau nom');
  const renamed = after.poles.find((p) => p.key === aRoot.key)!;
  assert.equal(renamed.name, 'Nouveau nom');
  assert.equal(renamed.path, 'Nouveau nom');

  for (const child of after.poles.filter((p) => p.parentKey === aRoot.key)) {
    assert.equal(child.path, `Nouveau nom / ${child.name}`);
  }
});

test('a new sub-pole gets a key nothing else uses, and the right path', () => {
  const once = addPole(plan, 'Renfort', aRoot.key);
  const twice = addPole(once, 'Renfort', aRoot.key);
  const created = twice.poles.filter((p) => p.name === 'Renfort');

  assert.equal(created.length, 2, 'deux pôles peuvent porter le même nom');
  assert.equal(new Set(created.map((p) => p.key)).size, 2, 'mais pas la même clé');
  for (const pole of created) assert.equal(pole.path, `${aRoot.name} / Renfort`);
});

test('deleting a shift removes the people on it and nobody else', () => {
  const target = plan.shifts.find((s) => plan.assignments.some((a) => a.shiftKey === s.key))!;
  const on = plan.assignments.filter((a) => a.shiftKey === target.key).length;
  assert.ok(on > 0);

  const after = deleteShift(plan, target.key);
  assert.equal(after.shifts.length, plan.shifts.length - 1);
  assert.equal(after.assignments.length, plan.assignments.length - on);
  assert.ok(!after.assignments.some((a) => a.shiftKey === target.key));
});

test('moving a shift keeps its people, and shows the damage rather than undoing it', () => {
  // Somebody who ruled out the night outright, dragged into the middle of it by their shift
  // moving under them. The tool must report it, not quietly drop them.
  //
  // A refused slot, not a preference. This test used to pick an "après-midi" answer, which was
  // a hard rule until 2026-09-08 and is a price now: the shift would move, the plan would stay
  // legal, and the test would fail while the tool behaved exactly as intended.
  const nightRefuser = plan.volunteers.find(
    (v) => v.refusedSlotIds.includes('00h-06h') && index.shiftsOf(v.key).length > 0,
  );
  assert.ok(nightRefuser, 'il faut quelqu\'un qui a refusé la tranche de nuit');
  const shift = index.shiftsOf(nightRefuser.key)[0]!;

  const after = setShiftWindow(plan, shift.key, 14, 16);
  assert.equal(after.assignments.length, plan.assignments.length, 'personne n\'est retiré');

  const report = validate(after);
  assert.ok(
    report.summary.tier1Count > validate(plan).summary.tier1Count,
    'le problème doit apparaître en rouge',
  );
});

test('regenerating a pole builds a regular series and says what it costs', () => {
  const cost = regenerateCost(plan, aLeaf.key);
  assert.ok(cost.shifts > 0);

  const after = regenerateShifts(plan, aLeaf.key, { from: 0, to: 12, block: 4 });
  const created = after.shifts.filter((s) => s.poleKey === aLeaf.key);

  assert.equal(created.length, 3, '12 h en blocs de 4 h font trois créneaux');
  for (const shift of created) assert.equal(shift.end - shift.start, 4);
  assert.equal(after.assignments.length, plan.assignments.length - cost.assignments);

  // Every other pole is left exactly as it was.
  assert.equal(
    after.shifts.filter((s) => s.poleKey !== aLeaf.key).length,
    plan.shifts.filter((s) => s.poleKey !== aLeaf.key).length,
  );
});

test('regenerating trims the last shift rather than overrunning the window', () => {
  const after = regenerateShifts(plan, aLeaf.key, { from: 0, to: 10, block: 4 });
  const created = after.shifts.filter((s) => s.poleKey === aLeaf.key).sort((a, b) => a.start - b.start);
  assert.equal(created.length, 3);
  assert.equal(created[2]!.end, 10);
  assert.equal(created[2]!.end - created[2]!.start, 2);
});

test('the scheduling rules can be tightened, and the plan then reports the damage', () => {
  const tightened = setRules(plan, { maxConsecutiveHours: 1 });
  assert.equal(tightened.rules.maxConsecutiveHours, 1);
  assert.ok(
    validate(tightened).summary.tier1Count > 0,
    'durcir une règle doit faire apparaître ce qui ne la respecte plus',
  );
  assert.equal(tightened.assignments.length, plan.assignments.length, 'sans rien déplacer');
});

test('the rules refuse values that would make no sense', () => {
  const floored = setRules(plan, { maxBlocks: 0, minBreakHours: -5, maxConsecutiveHours: 0 });
  assert.equal(floored.rules.maxBlocks, 1);
  assert.equal(floored.rules.minBreakHours, 0);
  assert.ok(floored.rules.maxConsecutiveHours > 0);
});

/** The person and the role just created on `aRoot`, which most of these tests start from. */
function oneOrganiser(on = aRoot.key, name = 'Camille Dubois') {
  const next = addLeaderOnPole(plan, on, name);
  const organiser = next.organisers[next.organisers.length - 1]!;
  const role = next.leaderRoles[next.leaderRoles.length - 1]!;
  return { plan: next, organiser, role };
}

test('pole organisers are added, edited and removed, and are never volunteers', () => {
  const { plan: withOne, organiser, role } = oneOrganiser();
  assert.equal(withOne.organisers.length, plan.organisers.length + 1);
  assert.equal(withOne.leaderRoles.length, plan.leaderRoles.length + 1);

  assert.equal(role.poleKey, aRoot.key);
  assert.equal(role.organiserKey, organiser.key);
  assert.equal(organiser.firstName, 'Camille', 'le prénom est coupé au premier espace');
  assert.equal(organiser.lastName, 'Dubois');
  assert.equal(withOne.volunteers.length, plan.volunteers.length, "un responsable n'est pas un bénévole");
  assert.equal(withOne.assignments.length, plan.assignments.length);

  const edited = updateOrganiser(withOne, organiser.key, { phone: '06 00 00 00 00' });
  assert.equal(edited.organisers.find((l) => l.key === organiser.key)!.phone, '06 00 00 00 00');

  const removed = deleteOrganiser(edited, organiser.key);
  assert.equal(removed.organisers.length, plan.organisers.length);
  assert.equal(removed.leaderRoles.length, plan.leaderRoles.length, 'ses pôles partent avec');
});

test('a organiser is never given an access code just by being created', () => {
  // A credential handed out as a side effect of typing a name would open the whole planning to
  // whoever happened to see the screen. The régisseur generates them, once, on purpose.
  const { organiser } = oneOrganiser();
  assert.equal(organiser.accessCode, '');
});

test('one person runs several poles, and the same pole twice', () => {
  const { plan: withOne, organiser } = oneOrganiser();
  const other = plan.poles.find((p) => p.parentKey === null && p.key !== aRoot.key)!;

  const two = assignOrganiserToPole(withOne, organiser.key, other.key);
  assert.equal(two.organisers.length, withOne.organisers.length, 'toujours une seule personne');
  assert.equal(two.leaderRoles.filter((r) => r.organiserKey === organiser.key).length, 2);

  // Two windows on one pole is how "de 14h à 18h, puis de 22h à 02h" is written down. Refusing
  // the second role would leave no way to say it at all.
  const twice = assignOrganiserToPole(two, organiser.key, aRoot.key);
  assert.equal(twice.leaderRoles.filter((r) => r.poleKey === aRoot.key).length, 2);
  assert.equal(
    new Set(twice.leaderRoles.map((r) => r.key)).size,
    twice.leaderRoles.length,
    'deux rôles ne partagent jamais une clé',
  );
});

test('deleting a pole takes its roles and leaves the people', () => {
  const { plan: withOne, organiser } = oneOrganiser();
  const other = plan.poles.find((p) => p.parentKey === null && p.key !== aRoot.key)!;
  const both = assignOrganiserToPole(withOne, organiser.key, other.key);

  const after = deletePole(both, aRoot.key);
  assert.ok(!after.leaderRoles.some((r) => r.poleKey === aRoot.key));
  assert.ok(
    after.organisers.some((l) => l.key === organiser.key),
    'perdre un pôle ne fait pas perdre la personne qui le tenait',
  );
  assert.equal(
    after.leaderRoles.filter((r) => r.organiserKey === organiser.key).length,
    1,
    'son autre pôle est intact',
  );
});

test('a code is issued only on purpose, and is sized for what it opens', () => {
  const { plan: withOne, organiser } = oneOrganiser();
  assert.equal(organiser.accessCode, '');

  const issued = giveOrganiserCode(withOne, organiser.key);
  const code = issued.organisers.find((l) => l.key === organiser.key)!.accessCode;

  // Fourteen characters of a 31-letter alphabet, about 69 bits, against 8 and about 40 for a
  // volunteer. A organiser's code opens every volunteer's contact details, so it guards what a
  // régisseur's password guards.
  assert.equal(code.length, 14);
  assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]+$/, 'ni 0/O ni 1/I/L: on le dicte');
});

test('regenerating replaces the code and touches nothing else', () => {
  const { plan: withOne, organiser } = oneOrganiser();
  const first = giveOrganiserCode(withOne, organiser.key);
  const firstCode = first.organisers.find((l) => l.key === organiser.key)!.accessCode;

  const second = giveOrganiserCode(first, organiser.key);
  const secondCode = second.organisers.find((l) => l.key === organiser.key)!.accessCode;

  assert.notEqual(secondCode, firstCode, "l'ancien code cesse de fonctionner");
  assert.deepEqual(second.leaderRoles, first.leaderRoles, 'ses pôles ne bougent pas');
  assert.equal(second.volunteers.length, first.volunteers.length);
});

test('no two organisers are ever issued the same code', () => {
  const { plan: withOne, organiser } = oneOrganiser();
  const two = addLeaderOnPole(withOne, aRoot.key, 'Dominique Roy');
  const other = two.organisers[two.organisers.length - 1]!;

  const both = giveOrganiserCode(giveOrganiserCode(two, organiser.key), other.key);
  const codes = both.organisers.map((l) => l.accessCode).filter((c) => c !== '');
  assert.equal(codes.length, 2);
  assert.equal(new Set(codes).size, 2);
});

test("revoking a code keeps the person, their poles and their details", () => {
  const { plan: withOne, organiser } = oneOrganiser();
  const issued = giveOrganiserCode(
    updateOrganiser(withOne, organiser.key, { phone: '06 01 02 03 04' }),
    organiser.key,
  );

  const revoked = clearOrganiserCode(issued, organiser.key);
  const after = revoked.organisers.find((l) => l.key === organiser.key)!;
  assert.equal(after.accessCode, '', 'un code vide n\'authentifie rien');
  assert.equal(after.phone, '06 01 02 03 04');
  assert.equal(revoked.leaderRoles.length, issued.leaderRoles.length);
});

test('removing one role leaves the person and their other poles alone', () => {
  const { plan: withOne, organiser, role } = oneOrganiser();
  const other = plan.poles.find((p) => p.parentKey === null && p.key !== aRoot.key)!;
  const both = assignOrganiserToPole(withOne, organiser.key, other.key);

  const after = removeLeaderRole(both, role.key);
  assert.ok(after.organisers.some((l) => l.key === organiser.key));
  assert.deepEqual(
    after.leaderRoles.filter((r) => r.organiserKey === organiser.key).map((r) => r.poleKey),
    [other.key],
  );
});

// ---------------------------------------------------------------------------
// A organiser's hours, entered one field at a time
// ---------------------------------------------------------------------------

test('a organiser window can be filled in one half at a time', () => {
  // The reported bug: a new organiser has neither end, so typing the first number hit a coherence
  // check and was thrown away. The field looked broken because nothing could ever be entered.
  const { plan: withOne, role } = oneOrganiser();

  assert.equal(role.start, null);
  assert.equal(role.end, null);

  const started = setOrganiserWindow(withOne, role.key, 2, null);
  assert.equal(
    started.leaderRoles.find((r) => r.key === role.key)!.start,
    2,
    'la première moitié doit être conservée',
  );

  const finished = setOrganiserWindow(started, role.key, 2, 8);
  const done = finished.leaderRoles.find((r) => r.key === role.key)!;
  assert.equal(done.start, 2);
  assert.equal(done.end, 8);
});

test('an incoherent organiser window is stored, not silently discarded', () => {
  // Storing it is what lets the screen say "the end must be after the start" instead of the
  // value vanishing under the cursor.
  const { plan: withOne, role } = oneOrganiser();


  const backwards = setOrganiserWindow(withOne, role.key, 8, 2);
  const stored = backwards.leaderRoles.find((r) => r.key === role.key)!;
  assert.equal(stored.start, 8);
  assert.equal(stored.end, 2);
});

test('a organiser window clears back to nothing', () => {
  const { plan: withOne, role } = oneOrganiser();


  const set = setOrganiserWindow(withOne, role.key, 2, 8);
  const cleared = setOrganiserWindow(set, role.key, null, null);

  const done = cleared.leaderRoles.find((r) => r.key === role.key)!;
  assert.equal(done.start, null);
  assert.equal(done.end, null);
});

test('an artist set can be renamed and retimed', () => {
  const artist = plan.artists[0]!;

  const renamed = setArtist(plan, artist.key, { name: 'Autre nom' });
  assert.equal(renamed.artists.find((a) => a.key === artist.key)!.name, 'Autre nom');
  assert.equal(
    renamed.artists.find((a) => a.key === artist.key)!.start,
    artist.start,
    'renommer ne déplace pas le set',
  );

  const moved = setArtist(plan, artist.key, { start: 3, end: 5 });
  const after = moved.artists.find((a) => a.key === artist.key)!;
  assert.equal(after.start, 3);
  assert.equal(after.end, 5);
  assert.equal(after.name, artist.name, 'déplacer ne renomme pas le set');
});

// ---------------------------------------------------------------------------
// The event itself
// ---------------------------------------------------------------------------

test('moving the start slides the whole plan without rescheduling anything', () => {
  const after = setEventStart(plan, '2027-06-01T20:00:00+02:00');
  assert.notEqual(after.startISO, plan.startISO);
  // Decimal hours from the start, so nothing about the plan itself moves.
  assert.deepEqual(after.shifts, plan.shifts);
  assert.deepEqual(after.assignments, plan.assignments);
});

test('a start that is not a date is refused rather than corrupting the plan', () => {
  assert.equal(setEventStart(plan, 'pas une date'), plan);
  assert.equal(setEventLength(plan, 0), plan);
  assert.equal(setEventLength(plan, Number.NaN), plan);
  assert.equal(setEventName(plan, '   '), plan);
});

test('shortening the event deletes nothing', () => {
  const after = setEventLength(plan, 4);
  assert.equal(after.lengthHours, 4);
  assert.equal(after.shifts.length, plan.shifts.length, 'les créneaux qui dépassent restent');
  assert.equal(after.assignments.length, plan.assignments.length);
  assert.equal(after.artists.length, plan.artists.length);
});

test('a new artist lands after the last one when there is room, and is never empty', () => {
  // Room at the end: it follows the last set.
  const roomy = setEventLength(plan, Math.max(...plan.artists.map((a) => a.end)) + 3);
  const afterLast = addArtist(roomy, 'Nouvelle scène').artists.slice(-1)[0]!;
  assert.equal(afterLast.start, Math.max(...plan.artists.map((a) => a.end)));
  assert.ok(afterLast.end > afterLast.start);

  // No room, because the line-up already runs to the closing hour. Parking it there would make
  // a set of zero length, which is not a set the régisseur could even grab to move.
  const full = addArtist(plan, 'Nouvelle scène').artists.slice(-1)[0]!;
  assert.equal(full.start, 0, 'sans place à la fin, il se pose au début');
  assert.ok(full.end > full.start, 'et jamais de durée nulle');
});

test('removing an artist keeps what volunteers said about them', () => {

  const named = plan.artists.find((a) =>
    plan.volunteers.some((v) => v.artistKeys.includes(a.key)),
  )!;
  const removed = deleteArtist(plan, named.key);
  assert.equal(removed.artists.length, plan.artists.length - 1);
  assert.deepEqual(
    removed.volunteers.map((v) => v.artistKeys.join(',')),
    plan.volunteers.map((v) => v.artistKeys.join(',')),
    'ce qu\'un bénévole a dit ne pas vouloir manquer reste sa réponse',
  );
});

// ---------------------------------------------------------------------------
// A pole lock, which is not a box lock
// ---------------------------------------------------------------------------

test('locking a pole leaves every box flag exactly as it was', () => {
  const locked = setPoleLocked(plan, aRoot.key, true);
  assert.equal(locked.poles.find((p) => p.key === aRoot.key)!.locked, true);
  assert.deepEqual(
    locked.assignments.map((a) => a.locked),
    plan.assignments.map((a) => a.locked),
  );

  const unlocked = setPoleLocked(locked, aRoot.key, false);
  assert.equal(unlocked.poles.find((p) => p.key === aRoot.key)!.locked, undefined);
  assert.deepEqual(unlocked.poles, plan.poles, 'déverrouiller rend le pôle tel qu\'il était');
});

test('a new shift takes its length from the pole, and existing shifts never move', () => {
  const before = plan.shifts.filter((s) => s.poleKey === aLeaf.key).map((s) => s.end - s.start);

  const configured = setPoleShiftHours(plan, aLeaf.key, 4);
  assert.deepEqual(
    configured.shifts.filter((s) => s.poleKey === aLeaf.key).map((s) => s.end - s.start),
    before,
    'changer la valeur par défaut ne touche aucun créneau existant',
  );

  const added = addShift(configured, aLeaf.key, 0);
  const created = added.shifts[added.shifts.length - 1]!;
  assert.equal(created.end - created.start, 4, 'le nouveau créneau prend la durée du pôle');

  // And an explicit length still wins, which is what the regeneration tool passes.
  const explicit = addShift(configured, aLeaf.key, 0, 3);
  const last = explicit.shifts[explicit.shifts.length - 1]!;
  assert.equal(last.end - last.start, 3);
});

test('a pole with no length of its own follows the event, two hours by default', () => {
  const bare: Plan = {
    ...plan,
    poles: plan.poles.map((p) => {
      if (p.key !== aLeaf.key) return p;
      const { defaultShiftHours: _gone, ...rest } = p;
      return rest;
    }),
  };
  const added = addShift(bare, aLeaf.key, 0);
  const created = added.shifts[added.shifts.length - 1]!;
  assert.equal(created.end - created.start, FALLBACK_SHIFT_HOURS);
});

test('changing the event’s length moves every pole that follows it, and none set by hand', () => {
  const leaves = plan.poles.filter((p) => p.key !== aLeaf.key).slice(0, 1);
  const other = leaves[0]!;
  const follows = (p: Plan): Plan => ({
    ...p,
    poles: p.poles.map((pole) => {
      const { defaultShiftHours: _gone, ...rest } = pole;
      return rest;
    }),
  });

  // The leaf is set by hand to 4 h, the other pole follows the event.
  const start = setPoleShiftHours(follows(plan), aLeaf.key, 4);
  assert.equal(shiftHoursByHand(start.poles.find((p) => p.key === aLeaf.key)!), true, 'réglé à la main');
  assert.equal(shiftHoursByHand(start.poles.find((p) => p.key === other.key)!), false);

  const moved = setEventShiftHours(start, 3);
  const pole = (key: string) => moved.poles.find((p) => p.key === key)!;
  assert.equal(defaultShiftHours(moved, pole(other.key)), 3, "le pôle qui suit prend la durée de l'événement");
  assert.equal(defaultShiftHours(moved, pole(aLeaf.key)), 4, 'le pôle réglé à la main garde la sienne');
  assert.deepEqual(moved.shifts, start.shifts, 'aucun créneau existant ne bouge');

  // Setting the event's own value, or going back, is following the event again: no key left.
  const same = setPoleShiftHours(moved, aLeaf.key, 3);
  assert.equal('defaultShiftHours' in same.poles.find((p) => p.key === aLeaf.key)!, false);
  const back = setPoleShiftHours(moved, aLeaf.key, null);
  assert.equal('defaultShiftHours' in back.poles.find((p) => p.key === aLeaf.key)!, false);
  assert.equal(defaultShiftHours(back, back.poles.find((p) => p.key === aLeaf.key)!), 3);
});

// ---------------------------------------------------------------------------
// Duplicating a pole, and the order the poles are drawn in
// ---------------------------------------------------------------------------

test('duplicating a sub-pole copies its créneaux and not one single person', () => {
  const source = plan.poles.find(
    (p) => p.parentKey !== null && plan.shifts.some((s) => s.poleKey === p.key),
  )!;
  const before = poleCopyPreview(plan, source.key)!;
  assert.ok(before.shifts > 0, 'le sous-pôle testé doit avoir des créneaux');

  const after = duplicatePole(plan, source.key);
  const copy = after.poles.find((p) => p.name === before.name)!;

  assert.ok(copy, 'la copie existe');
  assert.equal(after.poles.length, plan.poles.length + before.poles);
  assert.equal(after.shifts.length, plan.shifts.length + before.shifts);

  // The créneaux come across with the same hours and the same effectifs, and empty.
  const sourceShifts = plan.shifts
    .filter((s) => s.poleKey === source.key)
    .map((s) => `${s.start}-${s.end}x${s.headcount}`)
    .sort();
  const copied = after.shifts
    .filter((s) => s.poleKey === copy.key)
    .map((s) => `${s.start}-${s.end}x${s.headcount}`)
    .sort();
  assert.deepEqual(copied, sourceShifts);

  const copiedKeys = new Set(after.shifts.filter((s) => s.poleKey === copy.key).map((s) => s.key));
  assert.equal(
    after.assignments.filter((a) => copiedKeys.has(a.shiftKey)).length,
    0,
    'personne ne doit être dupliqué avec les créneaux',
  );
  assert.equal(after.assignments.length, plan.assignments.length, 'et rien ne bouge ailleurs');
});

test('a duplicated pole gets a fresh key, the right path, and no lock', () => {
  const source = plan.poles.find((p) => p.parentKey !== null)!;
  const locked = setPoleLocked(plan, source.key, true);
  const after = duplicatePole(locked, source.key);

  assert.equal(new Set(after.poles.map((p) => p.key)).size, after.poles.length, 'clés uniques');
  assert.equal(new Set(after.shifts.map((s) => s.key)).size, after.shifts.length, 'clés uniques');

  const parent = after.poles.find((p) => p.key === source.parentKey)!;
  const copy = after.poles.find((p) => p.parentKey === source.parentKey && p.key !== source.key
    && p.name.startsWith(source.name))!;
  assert.equal(copy.path, `${parent.path} / ${copy.name}`);
  assert.equal(copy.locked, undefined, 'une copie vide n\u2019a rien d\u2019équilibré à la main');
  assert.equal(after.poles.find((p) => p.key === source.key)!.locked, true, 'l\u2019original garde le sien');
});

test('the copy is numbered the way a file manager numbers a copy', () => {
  const source = plan.poles.find((p) => p.parentKey !== null)!;

  const once = duplicatePole(plan, source.key);
  assert.ok(
    once.poles.some((p) => p.name === `${source.name} 2`),
    `attendu "${source.name} 2"`,
  );

  const twice = duplicatePole(once, source.key);
  assert.ok(twice.poles.some((p) => p.name === `${source.name} 3`), 'puis 3, pas 2 deux fois');

  // Duplicating the copy carries on from its own number rather than appending another one.
  const copy = once.poles.find((p) => p.name === `${source.name} 2`)!;
  const third = duplicatePole(once, copy.key);
  assert.ok(
    third.poles.some((p) => p.name === `${source.name} 3`),
    'la copie d\u2019une copie continue la série',
  );
});

test('duplicating a pole with sub-poles copies the whole branch, once', () => {
  const before = poleCopyPreview(plan, aRoot.key)!;
  assert.ok(before.poles > 1, 'le pôle testé doit avoir des sous-pôles');

  const after = duplicatePole(plan, aRoot.key);
  assert.equal(after.poles.length, plan.poles.length + before.poles);

  const copy = after.poles.find((p) => p.name === before.name)!;
  assert.equal(copy.parentKey, null);
  const children = after.poles.filter((p) => p.parentKey === copy.key);
  assert.equal(children.length, plan.poles.filter((p) => p.parentKey === aRoot.key).length);
  for (const child of children) assert.equal(child.path, `${copy.name} / ${child.name}`);
});

test('a duplicated pole sits right next to the one it was copied from', () => {
  const source = plan.poles.find((p) => p.parentKey !== null)!;
  const after = duplicatePole(plan, source.key);
  const at = after.poles.findIndex((p) => p.key === source.key);
  assert.equal(after.poles[at + 1]!.name, `${source.name} 2`);
});

test('moving a sub-pole swaps it with its neighbour and touches nothing else', () => {
  const siblings = plan.poles.filter((p) => p.parentKey === aRoot.key);
  assert.ok(siblings.length > 1, 'il faut au moins deux sous-pôles pour en échanger deux');

  const after = movePole(plan, siblings[1]!.key, -1);
  const moved = after.poles.filter((p) => p.parentKey === aRoot.key);
  assert.deepEqual(
    moved.map((p) => p.key),
    [siblings[1]!.key, siblings[0]!.key, ...siblings.slice(2).map((p) => p.key)],
  );

  // Same poles, same everything else: only the order of the array changed.
  assert.deepEqual(
    [...after.poles].sort((a, b) => a.key.localeCompare(b.key)),
    [...plan.poles].sort((a, b) => a.key.localeCompare(b.key)),
  );
  assert.deepEqual(after.shifts, plan.shifts);
  assert.deepEqual(after.assignments, plan.assignments);
  assert.deepEqual(after.volunteers, plan.volunteers);
});

test('moving a pole keeps every sub-pole behind its own parent', () => {
  const roots = plan.poles.filter((p) => p.parentKey === null);
  const after = movePole(plan, roots[roots.length - 1]!.key, -1);

  const seen = new Set<string>();
  for (const pole of after.poles) {
    if (pole.parentKey !== null) {
      assert.ok(seen.has(pole.parentKey), `${pole.key} précède son parent`);
    }
    seen.add(pole.key);
  }
  assert.equal(after.poles.length, plan.poles.length);
});

test('the ends of the list refuse to move, and say so before the click', () => {
  const siblings = plan.poles.filter((p) => p.parentKey === aRoot.key);
  const first = siblings[0]!;
  const last = siblings[siblings.length - 1]!;

  assert.equal(canMovePole(plan, first.key, -1), false);
  assert.equal(canMovePole(plan, first.key, 1), true);
  assert.equal(canMovePole(plan, last.key, 1), false);

  assert.deepEqual(movePole(plan, first.key, -1).poles, plan.poles);
  assert.deepEqual(movePole(plan, last.key, 1).poles, plan.poles);
});

test('a duplicated pole and a reordered plan both stay legal', () => {
  const duplicated = duplicatePole(plan, aLeaf.key);
  const moved = movePole(duplicated, aLeaf.key, 1);
  for (const after of [duplicated, moved]) {
    assert.equal(
      validate(after).issues.filter((i) => i.code === 'reference-inconnue').length,
      0,
    );
  }
});

/*
 * Dropping an orga on a pole's frise, added 2026-09-12: the one place a role is born with hours.
 */
test('a role dropped on a frise arrives with its two hours, and never replaces another', () => {
  const { plan: withOne, organiser } = oneOrganiser();

  const dropped = assignOrganiserToPoleAt(withOne, organiser.key, aRoot.key, 5.25, 7.25);
  const created = dropped.leaderRoles[dropped.leaderRoles.length - 1]!;
  assert.equal(created.start, 5.25);
  assert.equal(created.end, 7.25);
  assert.equal(created.poleKey, aRoot.key);
  assert.equal(created.organiserKey, organiser.key);

  // The role the fixture already had is untouched: a second window on one pole is a legitimate
  // way of saying "de 14h à 18h, puis de 22h à 02h", so a drop adds rather than overwrites.
  assert.equal(dropped.leaderRoles.length, withOne.leaderRoles.length + 1);
  assert.equal(
    new Set(dropped.leaderRoles.map((r) => r.key)).size,
    dropped.leaderRoles.length,
    'deux rôles ne partagent jamais une clé',
  );

  // Both edges are then dragged on the band, through the function Réglages already used.
  const pulled = setOrganiserWindow(dropped, created.key, 5.25, 9);
  assert.equal(pulled.leaderRoles.find((r) => r.key === created.key)!.end, 9);
});

test('a frise drop for somebody who is not an orga writes nothing', () => {
  const nobody = assignOrganiserToPoleAt(plan, 'personne-de-ce-nom', aRoot.key, 0, 2);
  assert.equal(nobody, plan, 'le plan est rendu tel quel');
});
