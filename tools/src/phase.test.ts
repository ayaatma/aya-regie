/**
 * The montage and the démontage, tested on the four things the régisseur asked for by name:
 * nights that are not worked, half-days, everybody landing in Général by default, and an
 * événement that can be short of people.
 *
 *   npm test    (in tools/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { absentFromPhase, type Organiser, type Volunteer } from './model.js';
import {
  GENERAL_POLE_KEY,
  type Phase,
  type PhaseAssignment,
  clipWindows,
  alignPhase,
  defaultPhase,
  defaultPhaseStart,
  eventFills,
  generalPole,
  phaseClashes,
  phaseDayParts,
  phaseDays,
  declaredPlacements,
  phaseIssues,
  phasePeople,
  placementsFor,
  subtractWindows,
  workedWindows,
} from './phase.js';

/** A montage starting Wednesday 10 March 2027 at 08:00, three days long. */
const montage = (over: Partial<Phase> = {}): Phase => ({
  ...defaultPhase('montage', '2027-03-10T08:00:00+01:00'),
  enabled: true,
  lengthHours: 64, // 08:00 Wednesday to midnight Friday
  poles: [generalPole(), { key: 'bar', name: 'Bar' }, { key: 'scene', name: 'Scène' }],
  ...over,
});

const orga = (over: Partial<Organiser> = {}): Organiser => ({
  key: 'o1',
  firstName: 'Camille',
  lastName: 'Dubois',
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

const benevole = (over: Partial<Volunteer> = {}): Volunteer => ({
  key: 'v1',
  firstName: 'Alex',
  lastName: 'Martin',
  nickname: '',
  email: '',
  phone: '',
  accessCode: '',
  diet: '',
  allergies: '',
  requestedHours: 4,
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

// ---------------------------------------------------------------------------
// Window algebra
// ---------------------------------------------------------------------------

test('subtracting a window out of the middle of another leaves two pieces', () => {
  const left = subtractWindows([{ start: 0, end: 10 }], [{ start: 4, end: 6 }]);
  assert.deepEqual(left, [
    { start: 0, end: 4 },
    { start: 6, end: 10 },
  ]);
});

test('subtracting more than there is leaves nothing at all, and never a negative piece', () => {
  assert.deepEqual(subtractWindows([{ start: 2, end: 4 }], [{ start: 0, end: 10 }]), []);
});

test('clipping keeps only what is inside the bounds', () => {
  const kept = clipWindows([{ start: 0, end: 10 }, { start: 20, end: 30 }], { start: 5, end: 25 });
  assert.deepEqual(kept, [
    { start: 5, end: 10 },
    { start: 20, end: 25 },
  ]);
});

// ---------------------------------------------------------------------------
// Nights and half-days
// ---------------------------------------------------------------------------

test('the night is not worked, so each day is one worked band from 8h', () => {
  const days = phaseDays(montage());
  assert.equal(days.length, 3);
  // The phase starts at 08:00 on its first day, which is exactly when the night ends.
  assert.deepEqual(days[0]!.segments, [{ start: 0, end: 16 }]);
  // The second day runs from 08:00 to midnight: 24 hours in, 40 hours in.
  assert.deepEqual(days[1]!.segments, [{ start: 24, end: 40 }]);
});

test('a night band that wraps past midnight cuts both ends of a day', () => {
  // Nobody works between 22h and 8h, so a day is worked from 8h to 22h.
  const days = phaseDays(montage({ offStartHour: 22, offEndHour: 8 }));
  assert.deepEqual(days[1]!.segments, [{ start: 24, end: 38 }]);
});

test('when nothing is off, a day is worked around the clock', () => {
  const days = phaseDays(montage({ offStartHour: 0, offEndHour: 0 }));
  assert.deepEqual(days[1]!.segments, [{ start: 16, end: 40 }]);
});

test('a day is cut into a morning and an afternoon at the split hour', () => {
  const parts = phaseDayParts(montage());
  const firstDay = parts.filter((p) => p.dayIndex === 0);
  assert.deepEqual(
    firstDay.map((p) => [p.half, p.start, p.end]),
    [
      ['matin', 0, 5], // 08:00 to 13:00
      ['apresmidi', 5, 16], // 13:00 to midnight
    ],
  );
});

test('a half-day the night swallows whole produces no box', () => {
  // Nobody works before 14h, so there is no morning at all.
  const parts = phaseDayParts(montage({ offStartHour: 0, offEndHour: 14 }));
  assert.equal(parts.some((p) => p.half === 'matin'), false);
  assert.equal(parts.length, 3);
});

test('the worked hours of the phase are the days put end to end', () => {
  assert.equal(workedWindows(montage()).length, 3);
});

// ---------------------------------------------------------------------------
// Who is on site
// ---------------------------------------------------------------------------

test('an orga who said nothing is not on the montage at all', () => {
  assert.deepEqual(phasePeople(montage(), [orga()], []), []);
});

test('an orga is on site from their arrival to the end, nights taken out', () => {
  const people = phasePeople(montage(), [orga({ montageFrom: 24 })], []);
  assert.equal(people.length, 1);
  assert.deepEqual(people[0]!.presence, [
    { start: 24, end: 40 },
    { start: 48, end: 64 },
  ]);
});

test('an orga with no declared pole falls into Général, one with a pole into theirs', () => {
  const phase = montage();
  const [general] = phasePeople(phase, [orga({ montageFrom: 0 })], []);
  assert.equal(general!.defaultPoleKey, GENERAL_POLE_KEY);

  const [atBar] = phasePeople(phase, [orga({ montageFrom: 0, montagePoleKeys: ['bar'] })], []);
  assert.equal(atBar!.defaultPoleKey, 'bar');
});

test('a declared pole the phase does not have falls back to Général rather than vanishing', () => {
  const [person] = phasePeople(montage(), [orga({ montageFrom: 0, montagePoleKeys: ['plonge'] })], []);
  assert.equal(person!.defaultPoleKey, GENERAL_POLE_KEY);
});

test('a bénévole is not on site while the phase is closed to them', () => {
  const said = benevole({ montage: { present: true, note: 'je peux venir', windows: [] } });
  assert.deepEqual(phasePeople(montage(), [], [said]), []);
});

test('a bénévole who gave no hours gets the whole window opened to the bénévoles', () => {
  const phase = montage({ volunteersAllowed: true, volunteersFrom: 24, volunteersUntil: 64 });
  const said = benevole({ montage: { present: true, note: 'je viens', windows: [] } });
  const [person] = phasePeople(phase, [], [said]);
  assert.deepEqual(person!.presence, [
    { start: 24, end: 40 },
    { start: 48, end: 64 },
  ]);
});

test('a bénévole who named hours outside the opening is never placed outside it', () => {
  const phase = montage({ volunteersAllowed: true, volunteersFrom: 24, volunteersUntil: 64 });
  const said = benevole({
    montage: { present: true, note: 'dès mercredi', windows: [{ start: 0, end: 40 }] },
  });
  const [person] = phasePeople(phase, [], [said]);
  assert.deepEqual(person!.presence, [{ start: 24, end: 40 }]);
});

// ---------------------------------------------------------------------------
// What the grid draws
// ---------------------------------------------------------------------------

const placedAt = (over: Partial<PhaseAssignment> = {}): PhaseAssignment => ({
  key: 'a1',
  personKind: 'orga',
  personKey: 'o1',
  poleKey: 'bar',
  eventKey: '',
  start: 24,
  end: 30,
  ...over,
});

test('a box is a row of the plan, and there is no other kind', () => {
  const phase = montage({ assignments: [placedAt()] });
  const [person] = phasePeople(phase, [orga({ montageFrom: 24 })], []);

  // The declaration produced no box of its own: it is what `declaredPlacements` asks for, and
  // what the store writes. What is drawn is what the plan holds, and nothing else.
  assert.deepEqual(
    placementsFor(person!, phase).map((b) => [b.poleKey, b.start, b.end, b.assignmentKey]),
    [['bar', 24, 30, 'a1']],
  );
});

test('what a declaration asks for is one box per worked day, in the declared pole', () => {
  const phase = montage();
  const [person] = phasePeople(phase, [orga({ montageFrom: 30, montagePoleKeys: ['bar'] })], []);

  assert.deepEqual(declaredPlacements(person!), [
    { poleKey: 'bar', start: 30, end: 40 },
    { poleKey: 'bar', start: 48, end: 64 },
  ]);
});

test('a declaration with no pole asks for Général', () => {
  const phase = montage();
  const [person] = phasePeople(phase, [orga({ montageFrom: 48 })], []);
  assert.deepEqual(declaredPlacements(person!), [
    { poleKey: GENERAL_POLE_KEY, start: 48, end: 64 },
  ]);
});

test("a bénévole's answer asks for no box at all: it is a willingness, not a presence", () => {
  // 2026-09-12. An orga writes down when they ARE there; a bénévole answers whether they WOULD
  // come, out of a hundred and twenty people for a montage that needs fifteen. Drawing the second
  // buried the handful the régisseur actually wanted on the grid.
  const phase = montage({ volunteersAllowed: true, volunteersFrom: 0, volunteersUntil: 72 });
  const people = phasePeople(phase, [], [benevole({ montage: { present: true, note: '', windows: [] } })]);

  assert.equal(people.length, 1, 'toujours sur la liste, donc toujours dans « Disponibles »');
  assert.ok(people[0]!.presence.length > 0, 'et toujours une présence déclarée');
  assert.deepEqual(declaredPlacements(people[0]!), [], 'mais aucune case écrite pour autant');
});

// ---------------------------------------------------------------------------
// What a placement contradicts, which is the whole use left for a declaration
// ---------------------------------------------------------------------------

test('a placement on a day somebody said they were away is reported, in full', () => {
  const phase = montage({ assignments: [placedAt({ start: 0, end: 6 })] });
  const issues = phaseIssues(phase, [orga({ montageFrom: 24 })], []);

  assert.deepEqual(
    issues.map((i) => [i.code, i.assignmentKey]),
    [['hors-presence', 'a1']],
  );
  assert.match(issues[0]!.message, /en dehors/);
});

test('a placement that overruns a declared window is reported for the part that overruns', () => {
  // Declared from hour 24; placed from 20, so four hours of it are outside.
  const phase = montage({ assignments: [placedAt({ start: 20, end: 30 })] });
  const issues = phaseIssues(phase, [orga({ montageFrom: 24 })], []);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /4 h/);
});

test("un bénévole sans horaire est tenu à la fenêtre du réglage, et le rouge le dit", () => {
  /*
   * 2026-09-13, et c'était un message faux. Quelqu'un qui coche « oui je viens » sans donner
   * d'horaire n'a rien déclaré sur le QUAND: la fenêtre qui le retient est celle que le régisseur
   * a ouverte aux bénévoles dans Réglages. Dire « en dehors de ce qui a été déclaré » envoyait
   * lire le formulaire de la personne, qui disait exactement ce qu'on en attendait, et le rouge
   * restait.
   */
  const phase = montage({
    volunteersAllowed: true,
    volunteersFrom: 8,
    volunteersUntil: 20,
    assignments: [
      { key: 'a1', personKind: 'benevole', personKey: 'v1', poleKey: 'general', eventKey: '', start: 8, end: 30 },
    ],
  });
  const [issue] = phaseIssues(phase, [], [benevole({ montage: { present: true, note: '', windows: [] } })]);

  assert.ok(issue, 'la case déborde de la fenêtre, donc elle est signalée');
  assert.match(issue!.message, /fenêtre ouverte aux bénévoles/);
  assert.match(issue!.message, /réglage de la phase qui décide/);
  assert.doesNotMatch(issue!.message, /en dehors de ce qui a été déclaré/);
});

test("un bénévole qui A donné ses horaires est bien tenu aux siens", () => {
  const phase = montage({
    volunteersAllowed: true,
    volunteersFrom: 0,
    volunteersUntil: 40,
    assignments: [
      { key: 'a1', personKind: 'benevole', personKey: 'v1', poleKey: 'general', eventKey: '', start: 8, end: 30 },
    ],
  });
  const [issue] = phaseIssues(
    phase,
    [],
    [benevole({ montage: { present: true, note: 'je viens jeudi', windows: [{ start: 8, end: 12 }] } })],
  );

  assert.ok(issue);
  assert.match(issue!.message, /en dehors de ce qui a été déclaré/);
});

test('somebody who declared nothing at all is reported as such, not as an overrun', () => {
  const phase = montage({ assignments: [placedAt()] });
  const issues = phaseIssues(phase, [orga()], []);
  assert.match(issues[0]!.message, /pas déclaré/);
});

test('a placement inside the declared window is reported as nothing', () => {
  const phase = montage({ assignments: [placedAt({ poleKey: GENERAL_POLE_KEY })] });
  assert.deepEqual(phaseIssues(phase, [orga({ montageFrom: 24 })], []), []);
});

test('a pole other than the one on the form is reported, and names the declared one', () => {
  const phase = montage({ assignments: [placedAt({ poleKey: 'scene' })] });
  const issues = phaseIssues(phase, [orga({ montageFrom: 24, montagePoleKeys: ['bar'] })], []);

  assert.deepEqual(issues.map((i) => i.code), ['autre-pole']);
  assert.match(issues[0]!.message, /Bar/);
});

test('a bénévole is never in the wrong pole, because the form never asks them', () => {
  const phase = montage({
    volunteersAllowed: true,
    volunteersFrom: 0,
    volunteersUntil: 64,
    assignments: [placedAt({ personKind: 'benevole', personKey: 'v1', start: 0, end: 16 })],
  });
  const said = benevole({ montage: { present: true, note: '', windows: [] } });
  assert.deepEqual(phaseIssues(phase, [], [said]), []);
});

test('an événement is never reported as the wrong pole: nobody declares a truck', () => {
  const phase = montage({
    events: [{ key: 'camion', label: 'Camion', start: 26, end: 28, headcount: 2 }],
    assignments: [placedAt({ poleKey: '', eventKey: 'camion', start: 26, end: 28 })],
  });
  const issues = phaseIssues(phase, [orga({ montageFrom: 24, montagePoleKeys: ['bar'] })], []);
  assert.deepEqual(issues, []);
});

test('a clash names both of its boxes, so both of them can be drawn in red', () => {
  const phase = montage({
    assignments: [
      placedAt({ key: 'a1', start: 24, end: 30 }),
      placedAt({ key: 'a2', poleKey: 'scene', start: 28, end: 32 }),
    ],
  });
  const issues = phaseIssues(phase, [orga({ montageFrom: 24, montagePoleKeys: ['bar'] })], []);
  const clashes = issues.filter((i) => i.code === 'chevauchement');
  assert.deepEqual(clashes.map((i) => i.assignmentKey), ['a1', 'a2']);
});

// ---------------------------------------------------------------------------
// What has to be said out loud
// ---------------------------------------------------------------------------

test('an événement short of people says how many are missing, and a full one says none', () => {
  const phase = montage({
    events: [
      { key: 'camion', label: 'Déchargement camion', start: 26, end: 28, headcount: 4 },
      { key: 'bar', label: 'Montage du bar', start: 30, end: 34, headcount: 0 },
    ],
    assignments: [
      placedAt({ key: 'a1', poleKey: '', eventKey: 'camion' }),
      placedAt({ key: 'a2', personKey: 'o2', poleKey: '', eventKey: 'camion' }),
    ],
  });

  const fills = eventFills(phase);
  assert.deepEqual(fills.map((f) => [f.event.key, f.taken, f.missing]), [
    ['camion', 2, 2],
    // Headcount zero asks for nobody in particular and is never reported short.
    ['bar', 0, 0],
  ]);
});

test('the same person twice in one événement counts once', () => {
  const phase = montage({
    events: [{ key: 'camion', label: 'Camion', start: 26, end: 28, headcount: 2 }],
    assignments: [
      placedAt({ key: 'a1', poleKey: '', eventKey: 'camion' }),
      placedAt({ key: 'a2', poleKey: '', eventKey: 'camion', start: 28, end: 30 }),
    ],
  });
  assert.equal(eventFills(phase)[0]!.taken, 1);
});

test('two decisions overlapping for one person are reported, never silently merged', () => {
  const phase = montage({
    assignments: [
      placedAt({ key: 'a1', start: 24, end: 30 }),
      placedAt({ key: 'a2', poleKey: 'scene', start: 28, end: 32 }),
    ],
  });
  const clashes = phaseClashes(phase);
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0]!.personKey, 'o1');
  assert.deepEqual([clashes[0]!.first.key, clashes[0]!.second.key], ['a1', 'a2']);
  // And both are still there: reporting is not deleting.
  assert.equal(phase.assignments.length, 2);
});

test('two people in the same pole at the same time are not a clash', () => {
  const phase = montage({
    assignments: [placedAt({ key: 'a1' }), placedAt({ key: 'a2', personKey: 'o2' })],
  });
  assert.deepEqual(phaseClashes(phase), []);
});

test('a phase nobody configured is off, has Général, and draws nobody', () => {
  const fresh = defaultPhase('demontage', '2027-03-13T12:00:00+01:00');
  assert.equal(fresh.enabled, false);
  assert.deepEqual(fresh.poles.map((p) => p.key), [GENERAL_POLE_KEY]);
  assert.deepEqual(phasePeople(fresh, [orga({ demontageUntil: 10 })], []).length, 1);
  assert.deepEqual(phasePeople(fresh, [], [benevole()]), []);
});

// ---------------------------------------------------------------------------
// One edge of each phase is the event's, since 2026-09-13
// ---------------------------------------------------------------------------

const EVENT_START = '2027-03-13T12:00:00+01:00';
const at = (iso: string): number => new Date(iso).getTime();

test('a phase nobody configured sits on the two days before the event, or the two after it', () => {
  assert.equal(at(defaultPhaseStart('montage', EVENT_START, 18)), at('2027-03-11T12:00:00+01:00'));
  assert.equal(at(defaultPhaseStart('demontage', EVENT_START, 18)), at('2027-03-14T06:00:00+01:00'));
  assert.equal(defaultPhase('montage', EVENT_START).lengthHours, 48);
});

test('a montage keeps its start and takes its length from the event start', () => {
  const phase = { ...defaultPhase('montage', '2027-03-10T08:00:00+01:00'), lengthHours: 10, volunteersFrom: 24, volunteersUntil: 30 };
  const aligned = alignPhase(phase, EVENT_START, 18);
  assert.equal(aligned.startISO, phase.startISO, 'le début est au régisseur');
  assert.equal(aligned.lengthHours, 76, "la fin est le début de l'événement");
  assert.equal(aligned.volunteersFrom, 24, "l'ouverture aux bénévoles reste");
  assert.equal(aligned.volunteersUntil, 76, "et court toujours jusqu'à la fin");
});

test('a montage starting after the event is put back to the two days before it', () => {
  const phase = defaultPhase('montage', '2027-03-20T08:00:00+01:00');
  const aligned = alignPhase(phase, EVENT_START, 18);
  assert.equal(at(aligned.startISO), at('2027-03-11T12:00:00+01:00'));
  assert.equal(aligned.lengthHours, 48);
});

test('a démontage keeps its length and takes its start from the event end', () => {
  const phase = { ...defaultPhase('demontage', '2027-03-01T00:00:00+01:00'), lengthHours: 30, volunteersFrom: 5, volunteersUntil: 20 };
  const aligned = alignPhase(phase, EVENT_START, 18);
  assert.equal(at(aligned.startISO), at('2027-03-14T06:00:00+01:00'));
  assert.equal(aligned.lengthHours, 30);
  assert.equal(aligned.volunteersFrom, 0, 'les bénévoles peuvent toujours venir dès le début');
  assert.equal(aligned.volunteersUntil, 20);
});

test('aligning a phase already in place hands back the same object', () => {
  const phase = alignPhase(defaultPhase('demontage', '2027-03-01T00:00:00+01:00'), EVENT_START, 18);
  assert.equal(alignPhase(phase, EVENT_START, 18), phase);
  const montageInPlace = alignPhase(defaultPhase('montage', '2027-03-11T12:00:00+01:00'), EVENT_START, 18);
  assert.equal(alignPhase(montageInPlace, EVENT_START, 18), montageInPlace);
});

test('a phase pole asking for a competence says so on the box of whoever lacks it', async () => {
  const { phaseIssues, defaultPhase } = await import('./phase.js');
  const base = defaultPhase('montage', '2027-03-11T08:00:00+01:00');
  const phase = {
    ...base,
    enabled: true,
    poles: [...base.poles, { key: 'engins', name: 'Engins', requiredSkills: ['caces'] }],
    assignments: [{ key: 'a1', personKind: 'orga' as const, personKey: 'o1', poleKey: 'engins', eventKey: '', start: 1, end: 3 }],
  };
  const orga = (skills: string[]) => [{
    key: 'o1', firstName: 'O', lastName: 'Un', email: '', phone: '', accessCode: '', diet: '', allergies: '', note: '',
    montageFrom: 0, demontageUntil: null, montagePoleKeys: [], demontagePoleKeys: [], skills,
  }];
  const tags = [{ key: 'caces', label: 'CACES' }];
  assert.ok(phaseIssues(phase, orga([]), [], tags).some((i) => i.code === 'competence-manquante' && i.message.includes('CACES')));
  assert.ok(!phaseIssues(phase, orga(['caces']), [], tags).some((i) => i.code === 'competence-manquante'));
});
