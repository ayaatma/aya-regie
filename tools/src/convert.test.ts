/**
 * Bénévole ↔ orga: every reference follows the person, what cannot follow is listed, nothing is
 * lost in silence, and the round trip is possible.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CATERING,
  DEFAULT_RULES,
  DEFAULT_PREFERENCE_SLOTS,
  DEFAULT_SLOTS,
  DEFAULT_TICKETING,
  DEFAULT_TRAVEL_RATES,
  absentFromPhase,
  makeArtist,
  makeArtistMember,
  type Organiser,
  type Volunteer,
} from './model.js';
import { DEFAULT_CONSTRAINTS } from './constraints.js';
import { PlanIndex, type Plan } from './plan.js';
import { defaultPhase } from './phase.js';
import { convertPerson } from './convert.js';
import { validate } from './validate.js';
import { ticketingReport } from './ticketing.js';
import { cateringReport } from './catering.js';

const volunteer = (key: string, firstName: string, lastName: string, over: Partial<Volunteer> = {}): Volunteer => ({
  key, firstName, lastName, nickname: '', email: '', phone: '06 00 00 00 00', accessCode: `CODE${key}`,
  diet: 'Végétarien', allergies: '', requestedHours: 6, preferredSlotId: null, refusedSlotIds: [],
  availabilityNote: '', refusedPoleKeys: [], choices: [],
  artistKeys: [], buddyRawNames: [], manualFields: [], needsReview: false, reviewReasons: [],
  montage: absentFromPhase(), demontage: absentFromPhase(),
  ...over,
});

const orga = (key: string, firstName: string, lastName: string, over: Partial<Organiser> = {}): Organiser => ({
  key, firstName, lastName, email: '', phone: '07 00 00 00 00', accessCode: `ORGA${key}`, diet: '',
  allergies: 'Arachide', note: '', montageFrom: null, demontageUntil: null, montagePoleKeys: [],
  demontagePoleKeys: [],
  ...over,
});

function makePlan(): Plan {
  const montage = { ...defaultPhase('montage', '2027-03-11T12:00:00+01:00'), enabled: true, volunteersAllowed: true };
  return {
    name: 'conversion',
    startISO: '2027-03-13T12:00:00+01:00',
    lengthHours: 18,
    address: '',
    sheetUrl: '',
    rules: DEFAULT_RULES,
    slots: DEFAULT_SLOTS,
    preferenceSlots: DEFAULT_PREFERENCE_SLOTS,
    poles: [{ key: 'bar', name: 'Bar', parentKey: null, path: 'Bar', allowAllDebutants: true, minExperienced: 0, defaultHeadcount: 2 }],
    shifts: [
      { key: 'bar@1', poleKey: 'bar', start: 0, end: 2, headcount: 2 },
      { key: 'bar@2', poleKey: 'bar', start: 2, end: 4, headcount: 2 },
    ],
    artists: [
      makeArtist({
        key: 'doline',
        name: 'Doline',
        start: 8,
        end: 9.5,
        members: [makeArtistMember({ key: 'd-1', linkedKind: 'benevole', linkedKey: 'mail:anne@example.org' })],
      }),
    ],
    organisers: [orga('resp-sam', 'Sam', 'Aubert', { email: 'sam@example.org', montageFrom: 4, note: 'Arrive tard' })],
    leaderRoles: [{ key: 'r1', organiserKey: 'resp-sam', poleKey: 'bar', start: 0, end: 4 }],
    volunteers: [
      volunteer('mail:anne@example.org', 'Anne', 'Zed', {
        email: 'anne@example.org',
        nickname: 'Nano',
        availabilityNote: 'pas après 2h',
        choices: [{ poleKey: 'bar', raw: 'Bar', level: 'expert' }],
        montage: { present: true, note: 'jeudi aprem', windows: [{ start: 6, end: 30 }] },
      }),
      volunteer('nom:bob-aubert', 'Bob', 'Aubert'),
    ],
    buddies: [{ fromKey: 'mail:anne@example.org', toKey: 'nom:bob-aubert' }],
    dismissedBuddies: [],
    assignments: [
      { volunteerKey: 'mail:anne@example.org', shiftKey: 'bar@1', locked: false, source: 'solver' },
      { volunteerKey: 'nom:bob-aubert', shiftKey: 'bar@1', locked: false, source: 'solver' },
    ],
    reserve: [],
    organiserShifts: [{ key: 'resp-sam-bar@2', organiserKey: 'resp-sam', shiftKey: 'bar@2' }],
    montage: {
      ...montage,
      assignments: [
        { key: 'm1', personKind: 'benevole', personKey: 'mail:anne@example.org', poleKey: 'general', eventKey: '', start: 6, end: 10 },
        { key: 'm2', personKind: 'orga', personKey: 'resp-sam', poleKey: 'general', eventKey: '', start: 4, end: 8 },
      ],
    },
    demontage: defaultPhase('demontage', '2027-03-14T06:00:00+01:00'),
    catering: {
      ...DEFAULT_CATERING,
      choices: [
        { personKind: 'benevole', personKey: 'mail:anne@example.org', serviceKey: 's1', takes: true },
        { personKind: 'orga', personKey: 'resp-sam', serviceKey: 's1', takes: false },
      ],
    },
    ticketing: {
      ...DEFAULT_TICKETING,
      choices: [
        { personKind: 'benevole', personKey: 'mail:anne@example.org', ticketTypeKey: null, braceletKey: null, drinkTickets: 5, note: 'VIP' },
      ],
    },
    travel: DEFAULT_TRAVEL_RATES,
    poleChoicesRanked: true,
    volume: { scope: 'event', dayStartHour: 12, options: [4, 6, 8] },
    formMapping: { columns: {}, answers: {} },
    constraints: DEFAULT_CONSTRAINTS,
  };
}

test('a bénévole becomes an orga: placements, meals, door choices and act links follow the new key', () => {
  const plan = makePlan();
  const result = convertPerson(plan, 'benevole', 'mail:anne@example.org');
  assert.equal(result.blocked, null);
  assert.equal(result.toKind, 'orga');
  assert.equal(result.newKey, 'resp-anne-zed');

  const next = result.plan;
  assert.ok(!next.volunteers.some((v) => v.key === 'mail:anne@example.org'));
  const anne = next.organisers.find((o) => o.key === 'resp-anne-zed')!;
  assert.equal(anne.email, 'anne@example.org');
  assert.equal(anne.diet, 'Végétarien');
  assert.equal(anne.accessCode, '', 'a credential is never carried across');
  assert.equal(anne.montageFrom, 6);
  assert.match(anne.note, /Surnom: Nano/);
  assert.match(anne.note, /Contrainte horaire: pas après 2h/);
  assert.match(anne.note, /Pôles demandés: Bar/);

  assert.deepEqual(
    next.organiserShifts.filter((s) => s.organiserKey === 'resp-anne-zed').map((s) => s.shiftKey),
    ['bar@1'],
  );
  assert.ok(!next.assignments.some((a) => a.volunteerKey === 'mail:anne@example.org'));
  assert.equal(next.assignments.length, 1, "Bob's own place is untouched");
  assert.equal(next.montage.assignments.find((a) => a.key === 'm1')!.personKind, 'orga');
  assert.equal(next.montage.assignments.find((a) => a.key === 'm1')!.personKey, 'resp-anne-zed');
  assert.equal(next.catering.choices.find((c) => c.serviceKey === 's1' && c.personKey === 'resp-anne-zed')!.personKind, 'orga');
  assert.equal(next.ticketing.choices[0]!.personKey, 'resp-anne-zed');
  assert.equal(next.ticketing.choices[0]!.note, 'VIP');
  assert.equal(next.artists[0]!.members[0]!.linkedKind, 'orga');
  assert.equal(next.buddies.length, 0);

  assert.ok(result.lost.some((l) => l.includes('Binôme retiré: Bob Aubert')));
  assert.ok(result.lost.some((l) => l.includes('code')));
  assert.ok(result.carried.some((l) => l.includes("1 créneau de l'exploit")));

  // The door still sees one row for her, with the same remark, and the plan still validates.
  const row = ticketingReport(next, new PlanIndex(next)).rows.find((r) => r.key === 'resp-anne-zed')!;
  assert.equal(row.kind, 'orga');
  assert.equal(row.note, 'VIP');
  assert.equal(row.drinks, 5);
  assert.equal(validate(next).summary.tier1Count, validate(plan).summary.tier1Count);
});

test('an orga becomes a bénévole: locked places, a new code, the review queue, and the roles listed as lost', () => {
  const plan = makePlan();
  const result = convertPerson(plan, 'orga', 'resp-sam');
  assert.equal(result.blocked, null);
  assert.equal(result.newKey, 'mail:sam@example.org', 'the key the form import would give');

  const next = result.plan;
  const sam = next.volunteers.find((v) => v.key === 'mail:sam@example.org')!;
  assert.ok(!next.organisers.some((o) => o.key === 'resp-sam'));
  assert.equal(sam.accessCode.length, 8);
  assert.notEqual(sam.accessCode, 'ORGAresp-sam');
  assert.equal(sam.allergies, 'Arachide');
  assert.equal(sam.requestedHours, 4, 'the smallest option covering the 2 h already held');
  assert.equal(sam.needsReview, true);
  assert.equal(sam.enteredByHand, true);
  assert.deepEqual(sam.montage.windows, [{ start: 4, end: plan.montage.lengthHours }]);

  assert.deepEqual(
    next.assignments.filter((a) => a.volunteerKey === sam.key),
    [{ volunteerKey: sam.key, shiftKey: 'bar@2', locked: true, source: 'manual' }],
  );
  assert.equal(next.organiserShifts.length, 0);
  assert.equal(next.leaderRoles.length, 0);
  assert.equal(next.montage.assignments.find((a) => a.key === 'm2')!.personKind, 'benevole');
  assert.equal(next.catering.choices.find((c) => c.personKey === sam.key)!.takes, false);

  assert.ok(result.lost.some((l) => l.includes('responsable du pôle: Bar')));
  assert.ok(result.lost.some((l) => l.includes('« Arrive tard »')));
});

test('the round trip brings a bénévole back under the identity the import knows', () => {
  const plan = makePlan();
  const there = convertPerson(plan, 'benevole', 'mail:anne@example.org');
  const back = convertPerson(there.plan, 'orga', there.newKey);
  assert.equal(back.newKey, 'mail:anne@example.org');
  assert.equal(back.plan.assignments.find((a) => a.volunteerKey === back.newKey)!.shiftKey, 'bar@1');
  assert.equal(back.plan.artists[0]!.members[0]!.linkedKey, 'mail:anne@example.org');
  assert.equal(back.plan.ticketing.choices[0]!.personKind, 'benevole');
});

test('a conversion that would make two fiches for one person is refused, plan untouched', () => {
  const plan = makePlan();
  const withTwin: Plan = {
    ...plan,
    volunteers: [...plan.volunteers, volunteer('mail:sam@example.org', 'Sam', 'Aubert', { email: 'SAM@example.org' })],
  };
  const result = convertPerson(withTwin, 'orga', 'resp-sam');
  assert.ok(result.blocked !== null && result.blocked.includes('déjà bénévole'));
  assert.equal(result.plan, withTwin);

  assert.ok(convertPerson(plan, 'benevole', 'personne').blocked !== null);
});

test('the proposal says what the catering will hand the person afterwards, in its own figures', () => {
  const base = makePlan();
  const plan: Plan = { ...base, catering: { ...base.catering, rules: { ...base.catering.rules, enabled: true } } };
  for (const [kind, key] of [['orga', 'resp-sam'], ['benevole', 'mail:anne@example.org']] as const) {
    const result = convertPerson(plan, kind, key);
    const figures = (p: Plan, k: string, pk: string) => {
      const row = cateringReport(p, new PlanIndex(p)).people.find((x) => x.kind === k && x.key === pk);
      return [row?.serviceKeys.length ?? 0, row?.drinks ?? 0];
    };
    const [m0, d0] = figures(plan, kind, key);
    const [m1, d1] = figures(result.plan, result.toKind, result.newKey);
    const line = result.lost.find((l) => l.startsWith('Selon les règles du catering'));
    if (m0 === m1 && d0 === d1) assert.equal(line, undefined);
    else assert.equal(line?.includes(`repas ${m0} → ${m1}, tickets boisson ${d0} → ${d1}`), true);
  }
  // Off, nothing to say.
  assert.ok(!convertPerson(base, 'orga', 'resp-sam').lost.some((l) => l.startsWith('Selon les règles du catering')));
});
