/**
 * La billetterie: one line per person, the door's figures read off the catering, the default
 * ticket and bracelet, and the incohérences the régisseur asked to be shown.
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
  type BraceletType,
  type Organiser,
  type TicketType,
  type TicketingSettings,
  type Volunteer,
} from './model.js';
import { DEFAULT_CONSTRAINTS } from './constraints.js';
import { PlanIndex, type Plan } from './plan.js';
import { defaultPhase } from './phase.js';
import {
  defaultBracelet,
  defaultTicketType,
  setTicketingChoice,
  ticketingCsv,
  ticketingReport,
} from './ticketing.js';

const START = '2027-03-13T12:00:00+01:00';

const TICKETS: TicketType[] = [
  { key: 'loto', label: 'Loto seulement', start: 0, end: 6 },
  { key: 'full', label: 'Pass complet', start: 0, end: 18 },
  { key: 'soiree', label: 'Soirée', start: 8, end: 18 },
];

const BRACELETS: BraceletType[] = [
  { key: 'basique', label: 'Bracelet basique', defaultFor: ['benevole'] },
  { key: 'backstage', label: 'Bracelet backstage', defaultFor: ['artiste', 'invite-artiste', 'orga'] },
  { key: 'all', label: 'Bracelet all inclusive', defaultFor: ['responsable'] },
];

const volunteer = (key: string, firstName: string, lastName: string): Volunteer => ({
  key, firstName, lastName, nickname: '', email: '', phone: '06 00 00 00 00', accessCode: '',
  diet: '', allergies: '', requestedHours: 8, preferredSlotId: null, refusedSlotIds: [],
  availabilityNote: '', refusedPoleKeys: [], choices: [],
  artistKeys: [], buddyRawNames: [], manualFields: [], needsReview: false, reviewReasons: [],
  montage: absentFromPhase(), demontage: absentFromPhase(),
});

const orga = (key: string, firstName: string, lastName: string): Organiser => ({
  key, firstName, lastName, email: '', phone: '07 00 00 00 00', accessCode: '', diet: '',
  allergies: '', note: '', montageFrom: null, demontageUntil: null, montagePoleKeys: [],
  demontagePoleKeys: [],
});

function makePlan(ticketing: Partial<TicketingSettings> = {}): Plan {
  return {
    name: 'billetterie',
    startISO: START,
    lengthHours: 18,
    address: '',
    sheetUrl: '',
    rules: DEFAULT_RULES,
    slots: DEFAULT_SLOTS,
    preferenceSlots: DEFAULT_PREFERENCE_SLOTS,
    poles: [{ key: 'bar', name: 'Bar', parentKey: null, path: 'Bar', allowAllDebutants: true, minExperienced: 0, defaultHeadcount: 1 }],
    shifts: [],
    artists: [
      makeArtist({
        key: 'doline',
        name: 'Doline',
        start: 8,
        end: 9.5,
        members: [
          makeArtistMember({ key: 'd-1', firstName: 'Lou', lastName: 'Marin', guests: [
            { key: 'd-1-g1', firstName: 'Noa', lastName: 'Marin' },
            { key: 'd-1-g2', firstName: 'Zoé', lastName: 'Marin' },
          ] }),
          makeArtistMember({ key: 'd-2', linkedKind: 'orga', linkedKey: 'cam' }),
        ],
        extraGuests: [{ key: 'd-g1', firstName: 'Ismaël', lastName: 'Dray' }],
      }),
    ],
    organisers: [orga('cam', 'Camille', 'Dubois'), orga('sam', 'Sam', 'Aubert')],
    leaderRoles: [{ key: 'r1', organiserKey: 'sam', poleKey: 'bar', start: 0, end: 4 }],
    volunteers: [volunteer('v1', 'Anne', 'Zed'), volunteer('v2', 'Bob', 'Aubert')],
    buddies: [],
    assignments: [],
    reserve: [],
    organiserShifts: [],
    montage: defaultPhase('montage', '2027-03-11T12:00:00+01:00'),
    demontage: defaultPhase('demontage', '2027-03-14T06:00:00+01:00'),
    catering: { ...DEFAULT_CATERING, rules: { ...DEFAULT_CATERING.rules, enabled: true } },
    ticketing: { ...DEFAULT_TICKETING, ticketTypes: TICKETS, bracelets: BRACELETS, ...ticketing },
    travel: DEFAULT_TRAVEL_RATES,
    poleChoicesRanked: true,
    volume: { scope: 'event', dayStartHour: 12, options: [4, 6, 8] },
    formMapping: { columns: {}, answers: {} },
    dismissedBuddies: [],
    constraints: DEFAULT_CONSTRAINTS,
  };
}

test('the default ticket is the one opening the most of the event, the bracelet follows the statuses in priority', () => {
  assert.equal(defaultTicketType(TICKETS)?.key, 'full');
  assert.equal(defaultTicketType([]), null);
  assert.equal(defaultBracelet(BRACELETS, ['benevole'])?.key, 'basique');
  assert.equal(defaultBracelet(BRACELETS, ['orga', 'responsable'])?.key, 'all');
  assert.equal(defaultBracelet(BRACELETS, ['orga', 'artiste'])?.key, 'backstage', 'the artist first');
  assert.equal(defaultBracelet(BRACELETS, ['prestataire']), null);
});

test('everybody the tool knows is one line, sorted by name then first name, with every status', () => {
  const plan = makePlan();
  const report = ticketingReport(plan, new PlanIndex(plan));
  const names = report.rows.map((r) => `${r.lastName} ${r.firstName}`);
  assert.deepEqual(names, [
    'Aubert Bob',
    'Aubert Sam',
    'Dray Ismaël',
    'Dubois Camille',
    'Marin Lou',
    'Marin Noa',
    'Marin Zoé',
    'Zed Anne',
  ]);
  const camille = report.rows.find((r) => r.key === 'cam')!;
  assert.deepEqual(camille.statuses.map((s) => s.label), ['Orga', 'Artiste: Doline']);
  assert.equal(camille.kind, 'orga', 'the member row is folded into the orga');
  assert.ok(!report.rows.some((r) => r.key === 'd-2'));
  const sam = report.rows.find((r) => r.key === 'sam')!;
  assert.deepEqual(sam.statuses.map((s) => s.status), ['orga', 'responsable']);
  assert.equal(sam.braceletKey, 'all');
  const noa = report.rows.find((r) => r.key === 'd-1-g1')!;
  assert.deepEqual(noa.statuses.map((s) => s.label), ['Invité de Doline']);
  assert.equal(noa.braceletKey, 'backstage');
  assert.equal(noa.ticketTypeKey, 'full');
  assert.equal(noa.drinks, 0);
  assert.deepEqual(report.byStatus, { orga: 2, responsable: 1, artiste: 2, benevole: 2, 'invite-artiste': 3 });
});

test("the tickets are the catering's figures, and a member with more guests than allowed is flagged", () => {
  const plan = makePlan({ guestsPerArtist: 1 });
  const report = ticketingReport(plan, new PlanIndex(plan));
  const lou = report.rows.find((r) => r.key === 'd-1')!;
  assert.equal(lou.drinks, DEFAULT_CATERING.rules.artistDrinks);
  assert.equal(lou.meals, 1, 'the soir the set falls in');
  assert.deepEqual(lou.issues, ['2 invités pour 1 prévu par artiste']);
});

test('a meal outside the ticket is an incohérence, reported and never refused', () => {
  const plan = makePlan({
    guestsPerArtist: 2,
    choices: [{ personKind: 'artiste', personKey: 'd-1', ticketTypeKey: 'loto', braceletKey: null, drinkTickets: null, note: '' }],
  });
  const report = ticketingReport(plan, new PlanIndex(plan));
  const lou = report.rows.find((r) => r.key === 'd-1')!;
  assert.equal(lou.ticketTypeKey, 'loto');
  assert.equal(lou.ticketByHand, true);
  assert.equal(lou.meals, 1, 'still counted');
  assert.deepEqual(lou.issues, ['repas sam. 13/03 soir hors du ticket « Loto seulement » (12h à 18h)']);
});

test('a choice equal to the default is not stored, and a row with nothing chosen disappears', () => {
  const plan = makePlan();
  const defaults = { ticketTypeKey: 'full', braceletKey: 'basique' };
  let choices = setTicketingChoice(plan, 'benevole', 'v1', { braceletKey: 'backstage' }, defaults);
  assert.deepEqual(choices, [{ personKind: 'benevole', personKey: 'v1', ticketTypeKey: null, braceletKey: 'backstage', drinkTickets: null, note: '' }]);
  const next = { ...plan, ticketing: { ...plan.ticketing, choices } };
  choices = setTicketingChoice(next, 'benevole', 'v1', { braceletKey: 'basique' }, defaults);
  assert.deepEqual(choices, []);
  choices = setTicketingChoice(next, 'benevole', 'v1', { ticketTypeKey: 'soiree' }, defaults);
  assert.deepEqual(choices, [{ personKind: 'benevole', personKey: 'v1', ticketTypeKey: 'soiree', braceletKey: 'backstage', drinkTickets: null, note: '' }]);
});

test('a drink figure and a note are decisions too: kept while they differ from the default, gone otherwise', () => {
  const plan = makePlan();
  const defaults = { ticketTypeKey: 'full', braceletKey: 'basique', drinkTickets: 2 };
  let choices = setTicketingChoice(plan, 'benevole', 'v1', { drinkTickets: 5, note: '  passe par la scène ' }, defaults);
  assert.deepEqual(choices, [{ personKind: 'benevole', personKey: 'v1', ticketTypeKey: null, braceletKey: null, drinkTickets: 5, note: 'passe par la scène' }]);
  const next = { ...plan, ticketing: { ...plan.ticketing, choices } };
  const row = ticketingReport(next, new PlanIndex(next)).rows.find((r) => r.key === 'v1')!;
  assert.equal(row.drinks, 5);
  assert.equal(row.drinksByHand, true);
  assert.equal(row.note, 'passe par la scène');
  choices = setTicketingChoice(next, 'benevole', 'v1', { drinkTickets: 2, note: '' }, defaults);
  assert.deepEqual(choices, [], 'the computed figure typed back is no decision');
});

test('the reserve is on the door CSV only when the event says so, and in the report either way', () => {
  const off: Plan = { ...makePlan(), reserve: ['v2'] };
  assert.ok(ticketingReport(off, new PlanIndex(off)).rows.some((r) => r.key === 'v2'), 'still a row of the report');
  const without = ticketingCsv(off, new PlanIndex(off));
  assert.ok(!without.includes('Aubert,Bob'), 'off by default: not on the door list');
  assert.ok(without.includes('Zed'), 'a bénévole not in reserve stays');

  const on: Plan = { ...makePlan({ reserveOnDoorList: true }), reserve: ['v2'] };
  assert.ok(ticketingCsv(on, new PlanIndex(on)).includes('Aubert,Bob'));
});

test('an extra person is a line with what was typed for them, and the CSV carries phones only when asked', () => {
  const plan = makePlan({
    extras: [{ key: 'x1', firstName: 'Pat', lastName: 'Lumière', status: 'prestataire', phone: '06 99', drinkTickets: 4, mealTickets: 2 }],
  });
  const report = ticketingReport(plan, new PlanIndex(plan));
  const pat = report.rows.find((r) => r.key === 'x1')!;
  assert.deepEqual(pat.statuses.map((s) => s.label), ['Prestataire']);
  assert.equal(pat.drinks, 4);
  assert.equal(pat.meals, 2);
  assert.equal(pat.braceletKey, null, 'no bracelet names a prestataire');

  const without = ticketingCsv(plan, new PlanIndex(plan), false);
  assert.ok(!without.includes('06 99'));
  assert.ok(without.includes('Lumière'), 'the row is there');
  const withPhones = ticketingCsv(plan, new PlanIndex(plan), true);
  assert.ok(withPhones.includes('06 99'));
  assert.ok(withPhones.split('\n')[0]!.includes('Téléphone'));
});
