/**
 * The phase edits, tested on the promise the whole project makes: nothing is silently dropped
 * or moved.
 *
 * The one that matters most here is `assignWindow`. Dropping somebody on Friday afternoon has to
 * take Friday afternoon away from wherever they were, and leave their morning and their evening
 * exactly as they were. Getting that wrong either shows one person in two places, or quietly
 * deletes half a day somebody had been given.
 *
 *   npm test    (in app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GENERAL_POLE_KEY,
  defaultPhase,
  emptyPlan,
  type Organiser,
  type Phase,
  type Plan,
} from '../engine.ts';
import {
  addPhaseEvent,
  addPhasePole,
  assignWindow,
  copyMontagePoles,
  deletePhaseEvent,
  deletePhasePole,
  movePhasePole,
  phaseEventRemoval,
  phasePoleRemoval,
  placePerson,
  removePhaseAssignment,
  declaredToPlace,
  placeDeclared,
  setOrganiserPhase,
  setPhase,
  setVolunteerPhase,
} from './phaseEdits.ts';

const orga = (key: string, over: Partial<Organiser> = {}): Organiser => ({
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

const montage = (over: Partial<Phase> = {}): Phase => ({
  ...defaultPhase('montage', '2027-03-10T08:00:00+01:00'),
  enabled: true,
  lengthHours: 40,
  poles: [
    { key: GENERAL_POLE_KEY, name: 'Général' },
    { key: 'scene', name: 'Scène' },
    { key: 'bar', name: 'Bar' },
  ],
  ...over,
});

const base = (over: Partial<Plan> = {}): Plan => ({
  ...emptyPlan({
    name: 'test',
    startISO: '2027-03-13T12:00:00+01:00',
    lengthHours: 18,
    address: '',
    sheetUrl: '',
    rules: {
      maxConsecutiveHours: 4,
      maxBlocks: 2,
      minBreakHours: 2,
      minHoursPerPerson: 4,
    },
    slots: [],
    preferenceSlots: [],
    poles: [],
    shifts: [],
    artists: [],
    volunteers: [],
  }),
  organisers: [orga('o1', { montageFrom: 0 })],
  montage: montage(),
  ...over,
});

const boxes = (plan: Plan) =>
  [...plan.montage.assignments]
    .sort((a, b) => a.start - b.start)
    .map((a) => [a.poleKey || a.eventKey, a.start, a.end]);

const me = { kind: 'orga' as const, key: 'o1' };

// ---------------------------------------------------------------------------
// Placing
// ---------------------------------------------------------------------------

test('placing somebody writes one decision and nothing else', () => {
  const after = assignWindow(base(), 'montage', me, { kind: 'pole', poleKey: 'scene' }, 0, 5);
  assert.deepEqual(boxes(after), [['scene', 0, 5]]);
});

test('two touching half-days in the same pole become one box', () => {
  let plan = assignWindow(base(), 'montage', me, { kind: 'pole', poleKey: 'scene' }, 0, 5);
  plan = assignWindow(plan, 'montage', me, { kind: 'pole', poleKey: 'scene' }, 5, 16);
  assert.deepEqual(boxes(plan), [['scene', 0, 16]]);
});

test('placing somebody elsewhere takes that window away from where they were, and only that', () => {
  let plan = assignWindow(base(), 'montage', me, { kind: 'pole', poleKey: 'scene' }, 0, 16);
  plan = assignWindow(plan, 'montage', me, { kind: 'pole', poleKey: 'bar' }, 5, 10);

  // The morning and the evening stay on the scène; the middle moved to the bar.
  assert.deepEqual(boxes(plan), [
    ['scene', 0, 5],
    ['bar', 5, 10],
    ['scene', 10, 16],
  ]);
});

test('an événement takes the window too, from any pole', () => {
  const plan = base({
    montage: montage({
      events: [{ key: 'camion', label: 'Camion', start: 2, end: 4, headcount: 3 }],
    }),
  });
  let after = assignWindow(plan, 'montage', me, { kind: 'pole', poleKey: 'scene' }, 0, 16);
  after = assignWindow(after, 'montage', me, { kind: 'event', eventKey: 'camion' }, 2, 4);

  assert.deepEqual(boxes(after), [
    ['scene', 0, 2],
    ['camion', 2, 4],
    ['scene', 4, 16],
  ]);
});

test('clearing a window leaves no decision at all, and never removes the person', () => {
  let plan = assignWindow(base(), 'montage', me, { kind: 'pole', poleKey: 'scene' }, 0, 16);
  plan = assignWindow(plan, 'montage', me, null, 0, 16);

  assert.deepEqual(boxes(plan), []);
  // They are still on the montage: their arrival is a fact about them, not about a box.
  assert.equal(plan.organisers[0]!.montageFrom, 0);
});

test('a placement of no length is refused rather than stored', () => {
  const after = assignWindow(base(), 'montage', me, { kind: 'pole', poleKey: 'scene' }, 5, 5);
  assert.deepEqual(boxes(after), []);
});

test('removing one decision leaves the others alone', () => {
  let plan = placePerson(base(), 'montage', me, { kind: 'pole', poleKey: 'scene' }, 0, 4);
  plan = placePerson(plan, 'montage', me, { kind: 'pole', poleKey: 'bar' }, 8, 12);
  const first = plan.montage.assignments[0]!.key;

  const after = removePhaseAssignment(plan, 'montage', first);
  assert.deepEqual(boxes(after), [['bar', 8, 12]]);
});

// ---------------------------------------------------------------------------
// Poles and événements
// ---------------------------------------------------------------------------

test('deleting a pole says what it costs first, then takes its placements with it', () => {
  const plan = assignWindow(base(), 'montage', me, { kind: 'pole', poleKey: 'scene' }, 0, 5);
  assert.deepEqual(phasePoleRemoval(plan, 'montage', 'scene'), {
    placements: 1,
    deletable: true,
  });

  const after = deletePhasePole(plan, 'montage', 'scene');
  assert.deepEqual(boxes(after), []);
  assert.deepEqual(after.montage.poles.map((p) => p.key), [GENERAL_POLE_KEY, 'bar']);
});

test('deleting a pole clears it from the orgas who declared it, rather than leaving a dangling key', () => {
  const plan = base({ organisers: [orga('o1', { montageFrom: 0, montagePoleKeys: ['scene'] })] });
  const after = deletePhasePole(plan, 'montage', 'scene');
  assert.deepEqual(after.organisers[0]!.montagePoleKeys, []);
});

test('Général can never be deleted, and never leaves the first row', () => {
  const plan = base();
  assert.equal(phasePoleRemoval(plan, 'montage', GENERAL_POLE_KEY).deletable, false);
  assert.deepEqual(deletePhasePole(plan, 'montage', GENERAL_POLE_KEY), plan);
  assert.deepEqual(
    movePhasePole(plan, 'montage', 'scene', -1).montage.poles.map((p) => p.key),
    [GENERAL_POLE_KEY, 'scene', 'bar'],
  );
});

test('reordering swaps two neighbours and nothing else', () => {
  const after = movePhasePole(base(), 'montage', 'scene', 1);
  assert.deepEqual(after.montage.poles.map((p) => p.key), [GENERAL_POLE_KEY, 'bar', 'scene']);
});

test('adding a pole keys it off its name, twice over if need be', () => {
  let plan = addPhasePole(base(), 'montage', 'Bar');
  plan = addPhasePole(plan, 'montage', 'Bar');
  assert.deepEqual(plan.montage.poles.map((p) => p.key), [
    GENERAL_POLE_KEY,
    'scene',
    'bar',
    'bar-2',
    'bar-3',
  ]);
});

test('the démontage can take the montage poles without losing what it already had', () => {
  const plan = {
    ...base(),
    demontage: {
      ...defaultPhase('demontage', '2027-03-14T08:00:00+01:00'),
      poles: [
        { key: GENERAL_POLE_KEY, name: 'Général' },
        { key: 'benne', name: 'Benne' },
      ],
    },
  };
  const after = copyMontagePoles(plan);
  assert.deepEqual(after.demontage.poles.map((p) => p.key), [
    GENERAL_POLE_KEY,
    'benne',
    'scene',
    'bar',
  ]);
});

test('an événement says how many placements would go with it', () => {
  let plan = addPhaseEvent(base(), 'montage', 'Déchargement camion', 2, 4, 6);
  const key = plan.montage.events[0]!.key;
  plan = assignWindow(plan, 'montage', me, { kind: 'event', eventKey: key }, 2, 4);

  assert.equal(phaseEventRemoval(plan, 'montage', key), 1);
  assert.deepEqual(boxes(deletePhaseEvent(plan, 'montage', key)), []);
});

test('an événement with no name or no length is not created', () => {
  assert.equal(addPhaseEvent(base(), 'montage', '  ', 2, 4, 2).montage.events.length, 0);
  assert.equal(addPhaseEvent(base(), 'montage', 'Camion', 4, 4, 2).montage.events.length, 0);
});

// ---------------------------------------------------------------------------
// What people declared
// ---------------------------------------------------------------------------

test('an orga arrival and pole are set per phase, and the other phase is untouched', () => {
  const after = setOrganiserPhase(base(), 'o1', 'demontage', { at: 6, poleKeys: ['benne'] });
  assert.equal(after.organisers[0]!.demontageUntil, 6);
  assert.deepEqual(after.organisers[0]!.demontagePoleKeys, ['benne']);
  assert.equal(after.organisers[0]!.montageFrom, 0);
});

test("correcting a bénévole's phase answer marks it, and never rewrites what they wrote", () => {
  const plan = base({
    volunteers: [
      {
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
        montage: { present: true, note: 'je peux venir vendredi', windows: [] },
        demontage: { present: false, note: '', windows: [] },
      },
    ],
  });

  const after = setVolunteerPhase(plan, 'v1', 'montage', {
    present: true,
    windows: [{ start: 24, end: 40 }],
  });

  assert.deepEqual(after.volunteers[0]!.montage.windows, [{ start: 24, end: 40 }]);
  assert.equal(after.volunteers[0]!.montage.note, 'je peux venir vendredi');
  assert.ok(after.volunteers[0]!.manualFields.includes('montage'));
});

test('shortening a phase deletes nothing: what falls past the end is still there', () => {
  const plan = assignWindow(base(), 'montage', me, { kind: 'pole', poleKey: 'scene' }, 24, 40);
  const after = setPhase(plan, 'montage', { lengthHours: 16 });
  assert.deepEqual(boxes(after), [['scene', 24, 40]]);
});

/*
 * The start of a phase, and the hour this project lost to it.
 *
 * Réglages builds the field's value as a wall clock with no zone, `2027-03-10T08:00`. `new Date()`
 * reads that in the régisseur's own zone, so the screen was right; Postgres reads a naked wall
 * clock in the SESSION's zone, which on Supabase is UTC, so 08:00 Paris was saved as 08:00 UTC and
 * came back as 09:00 Paris. The phase moved an hour forward under boxes that did not move with it,
 * every box ended up past the end of its worked day, and the montage turned red with "jusqu'à 1h".
 */
test('the start of a phase is stored as a real instant, not as a wall clock with no zone', () => {
  const after = setPhase(base(), 'montage', { startISO: '2027-03-10T08:00' });
  const stored = after.montage.startISO;

  assert.ok(/(Z|[+-]\d{2}:\d{2})$/.test(stored), `un décalage explicite: ${stored}`);
  // And it still means the same moment as what was typed, read locally.
  assert.equal(new Date(stored).getTime(), new Date('2027-03-10T08:00').getTime());
});

test('a start that cannot be read is left exactly as it was typed, never zeroed', () => {
  const after = setPhase(base(), 'montage', { startISO: 'pas une date' });
  assert.equal(after.montage.startISO, 'pas une date');
});

// ---------------------------------------------------------------------------
// A declaration writes boxes
// ---------------------------------------------------------------------------

test('placing the declarations writes one box per worked day, in the declared pole', () => {
  const plan = base({ organisers: [orga('o1', { montageFrom: 0, montagePoleKeys: ['scene'] })] });
  const after = placeDeclared(plan, 'montage');

  // The phase runs 08:00 Wednesday to midnight Thursday with the nights off: two days.
  assert.deepEqual(boxes(after), [
    ['scene', 0, 16],
    ['scene', 24, 40],
  ]);
});

test('placing them twice writes nothing the second time', () => {
  const plan = placeDeclared(base(), 'montage');
  assert.equal(declaredToPlace(plan, 'montage'), 0);
  assert.deepEqual(boxes(placeDeclared(plan, 'montage')), boxes(plan));
});

test('placing never touches a box that is already there, however it was arranged', () => {
  // The régisseur has trimmed the first day and moved it to the bar.
  const arranged = placePerson(base(), 'montage', me, { kind: 'pole', poleKey: 'bar' }, 8, 12);
  const after = placeDeclared(arranged, 'montage');

  assert.deepEqual(boxes(after), [
    ['bar', 8, 12],
    // Only the day nobody had touched is written.
    [GENERAL_POLE_KEY, 24, 40],
  ]);
});

test('an arrival that moves rebuilds that person’s boxes and nobody else’s', () => {
  const two = base({
    organisers: [orga('o1', { montageFrom: 0 }), orga('o2', { montageFrom: 0 })],
  });
  const placed = placeDeclared(two, 'montage');
  const moved = setOrganiserPhase(placed, 'o1', 'montage', { at: 24 });

  const mine = moved.montage.assignments.filter((a) => a.personKey === 'o1');
  const theirs = moved.montage.assignments.filter((a) => a.personKey === 'o2');
  assert.deepEqual(mine.map((a) => [a.start, a.end]), [[24, 40]], 'un seul jour, le nouveau');
  assert.equal(theirs.length, 2, "l'autre orga n'a pas bougé");
});

test('a pole declared later leaves the boxes where the régisseur put them', () => {
  const placed = placeDeclared(base(), 'montage');
  const before = boxes(placed);
  const after = setOrganiserPhase(placed, 'o1', 'montage', { poleKeys: ['scene'] });

  assert.deepEqual(boxes(after), before, 'rien de replacé');
  assert.deepEqual(after.organisers[0]!.montagePoleKeys, ['scene'], 'la réponse est enregistrée');
});

test('an orga who says they are not coming loses their boxes, and keeps their événements', () => {
  const plan = placeDeclared(base(), 'montage');
  const withEvent = placePerson(
    { ...plan, montage: { ...plan.montage, events: [{ key: 'camion', label: 'Camion', start: 2, end: 4, headcount: 2 }] } },
    'montage',
    me,
    { kind: 'event', eventKey: 'camion' },
    2,
    4,
  );

  const gone = setOrganiserPhase(withEvent, 'o1', 'montage', { at: null });
  assert.deepEqual(
    gone.montage.assignments.map((a) => [a.poleKey, a.eventKey]),
    [['', 'camion']],
  );
});
