/**
 * The billetterie's edits: the configuration in Réglages and one person's choice, against the
 * one rule that makes them different: a choice equal to the
 * default is not stored.
 *
 *   npm test    (in app/)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_GUEST_TYPES, PlanIndex, ticketingCsv, ticketingReport, type Plan } from '../engine.ts';
import { normalisePlan } from '../persistence/normalise.ts';
import { addArtist } from './setupEdits.ts';
import { addArtistMember, addGuest, deleteArtistMember, deleteGuest, setGuest } from './artistEdits.ts';
import {
  addBracelet,
  addExtraPerson,
  addGuestType,
  deleteGuestType,
  guestTypeHolders,
  setGuestType,
  addTicketType,
  chooseForPerson,
  clearChoices,
  deleteBracelet,
  deleteExtraPerson,
  deleteTicketType,
  setBraceletDefault,
  setExtraPerson,
  setGuestsPerArtist,
  setTicketType,
} from './ticketingEdits.ts';

const here = dirname(fileURLToPath(import.meta.url));

const plan: Plan = normalisePlan(
  JSON.parse(readFileSync(join(here, '..', '..', 'public', 'fixtures', 'balanced.json'), 'utf8')),
);

test('a plan from before the billetterie opens with an empty one, and a stored one comes back whole', () => {
  assert.deepEqual(plan.ticketing, {
    guestsPerArtist: 1,
    reserveOnDoorList: false,
    ticketTypes: [],
    bracelets: [],
    guestTypes: DEFAULT_GUEST_TYPES,
    extras: [],
    choices: [],
  });
  const read = normalisePlan({
    ...plan,
    ticketing: {
      guestsPerArtist: 2,
      ticketTypes: [{ key: 'full', label: 'Pass', start: 0, end: 18 }],
      bracelets: [{ key: 'b', label: 'Basique', defaultFor: ['benevole', 'nope'] }],
      extras: [{ key: 'x1', firstName: 'Pat', lastName: 'L', status: 'prestataire', phone: '', drinkTickets: 2, mealTickets: 1 }],
      choices: [
        { personKind: 'benevole', personKey: 'v', ticketTypeKey: 'full', braceletKey: null },
        { personKind: 'benevole', personKey: 'w', ticketTypeKey: null, braceletKey: null },
        { personKind: 'benevole', personKey: 'x', note: '  vient tard ' },
      ],
    },
  });
  assert.equal(read.ticketing.guestsPerArtist, 2);
  // Kept since 2026-10-22: a guest type's key is a status, and the list of them is the event's.
  assert.deepEqual(read.ticketing.bracelets[0]!.defaultFor, ['benevole', 'nope']);
  assert.equal(read.ticketing.ticketTypes[0]!.bracelet, '', 'no wristband before 2026-10-22');
  assert.deepEqual(read.ticketing.choices[0]!.braceletKeys, null);
  assert.equal(read.ticketing.extras[0]!.status, 'prestataire');
  assert.equal(read.ticketing.choices.length, 2, 'a choice deciding nothing is not kept; a note is a decision');
  assert.equal(read.ticketing.choices[1]!.note, 'vient tard');
});

test('a new ticket type opens the whole event, and its key survives a rename', () => {
  let next = addTicketType(plan, 'Soirée');
  const type = next.ticketing.ticketTypes[0]!;
  assert.equal(type.key, 'soiree');
  assert.deepEqual([type.start, type.end], [0, plan.lengthHours]);
  next = setTicketType(next, 'soiree', { label: 'Soirée seulement', start: 8 });
  assert.equal(next.ticketing.ticketTypes[0]!.key, 'soiree');
  assert.equal(next.ticketing.ticketTypes[0]!.label, 'Soirée seulement');
  assert.equal(next.ticketing.ticketTypes[0]!.start, 8);
  assert.equal(addTicketType(next, 'Soirée').ticketing.ticketTypes[1]!.key, 'soiree-2');
});

test('choosing for a person stores the difference and nothing else, and a deleted type sends them back', () => {
  let next = addTicketType(addTicketType(plan, 'Pass complet'), 'Loto');
  next = setTicketType(next, 'loto', { start: 0, end: 8 });
  const v = plan.volunteers[0]!.key;
  const report = ticketingReport(next, new PlanIndex(next));
  const row = report.rows.find((r) => r.kind === 'benevole' && r.key === v)!;
  assert.equal(row.ticketTypeKey, 'pass-complet', 'the widest is the default');
  const defaults = { ticketTypeKey: 'pass-complet', braceletKeys: [] };

  next = chooseForPerson(next, 'benevole', v, { ticketTypeKey: 'loto' }, defaults);
  assert.deepEqual(next.ticketing.choices, [{ personKind: 'benevole', personKey: v, ticketTypeKey: 'loto', braceletKeys: null, drinkTickets: null, note: '' }]);
  assert.equal(chooseForPerson(next, 'benevole', v, { ticketTypeKey: 'pass-complet' }, defaults).ticketing.choices.length, 0);

  const gone = deleteTicketType(next, 'loto');
  assert.equal(gone.ticketing.choices.length, 0, 'nothing left to choose');
  assert.equal(clearChoices(next, 'benevole', v).ticketing.choices.length, 0);
});

test('a bracelet chosen by hand goes with the bracelet when it is deleted', () => {
  let next = addBracelet(plan, 'Backstage');
  next = chooseForPerson(next, 'orga', 'o1', { braceletKeys: ['backstage'] }, { ticketTypeKey: null, braceletKeys: [] });
  assert.equal(next.ticketing.choices.length, 1);
  assert.deepEqual(deleteBracelet(next, 'backstage').ticketing.choices[0]?.braceletKeys, [], 'la liste reste un choix, sans lui');
});

test('an extra person is typed in place, and leaves with their choices', () => {
  let next = addExtraPerson(addBracelet(plan, 'Basique'), 'prestataire');
  const key = next.ticketing.extras[0]!.key;
  next = setExtraPerson(next, key, { firstName: 'Pat', drinkTickets: 3, mealTickets: Number.NaN });
  assert.equal(next.ticketing.extras[0]!.firstName, 'Pat');
  assert.equal(next.ticketing.extras[0]!.drinkTickets, 3);
  assert.equal(next.ticketing.extras[0]!.mealTickets, 0, 'a NaN is ignored');
  next = chooseForPerson(next, 'extra', key, { braceletKeys: ['basique'] }, { ticketTypeKey: null, braceletKeys: [] });
  const report = ticketingReport(next, new PlanIndex(next));
  assert.ok(report.rows.some((r) => r.kind === 'extra' && r.key === key && r.braceletKeys.includes('basique')));
  const gone = deleteExtraPerson(next, key);
  assert.equal(gone.ticketing.extras.length, 0);
  assert.equal(gone.ticketing.choices.length, 0);
});

test("a guest is named, keyed apart from every other act's, and leaves with the member", () => {
  let next = addArtistMember(addArtist(plan, 'Trio'), 'trio');
  const member = next.artists.find((a) => a.key === 'trio')!.members[0]!;
  next = addGuest(next, 'trio', member.key);
  next = addGuest(next, 'trio', null);
  const act = next.artists.find((a) => a.key === 'trio')!;
  assert.equal(act.members[0]!.guests.length, 1);
  assert.equal(act.extraGuests.length, 1);
  assert.notEqual(act.members[0]!.guests[0]!.key, act.extraGuests[0]!.key);

  const g = act.members[0]!.guests[0]!.key;
  next = setGuest(next, 'trio', g, { firstName: 'Noa', lastName: 'Marin' });
  assert.equal(next.artists.find((a) => a.key === 'trio')!.members[0]!.guests[0]!.lastName, 'Marin');
  next = chooseForPerson(next, 'invite', g, { ticketTypeKey: 'x' }, { ticketTypeKey: null, braceletKeys: [] });
  assert.equal(next.ticketing.choices.length, 1);

  const report = ticketingReport(next, new PlanIndex(next));
  assert.ok(report.rows.some((r) => r.kind === 'invite' && r.key === g && r.statuses[0]!.label === 'Invité de Trio'));

  assert.equal(deleteGuest(next, 'trio', g).ticketing.choices.length, 0);
  const withoutMember = deleteArtistMember(next, 'trio', member.key);
  assert.equal(withoutMember.ticketing.choices.length, 0, "the member's guests' choices go with the member");
  assert.equal(setGuestsPerArtist(plan, 2.4).ticketing.guestsPerArtist, 2);
});

test('a guest type gives a new guest its tickets, a change of type follows unless typed by hand, and a type in use stays', () => {
  let next = setGuestType(plan, 'partenaire', { drinkTickets: 2, mealTickets: 1 });
  next = setGuestType(next, 'prestataire', { drinkTickets: 4, mealTickets: 2 });
  next = addExtraPerson(next, 'partenaire');
  const key = next.ticketing.extras[0]!.key;
  assert.deepEqual([next.ticketing.extras[0]!.drinkTickets, next.ticketing.extras[0]!.mealTickets], [2, 1]);

  next = setExtraPerson(next, key, { status: 'prestataire' });
  assert.deepEqual([next.ticketing.extras[0]!.drinkTickets, next.ticketing.extras[0]!.mealTickets], [4, 2], 'les chiffres du nouveau type');

  next = setExtraPerson(next, key, { drinkTickets: 7 });
  next = setExtraPerson(next, key, { status: 'partenaire' });
  assert.equal(next.ticketing.extras[0]!.drinkTickets, 7, 'un chiffre tapé à la main reste');
  assert.equal(next.ticketing.extras[0]!.mealTickets, 1);

  assert.equal(guestTypeHolders(next, 'partenaire'), 1);
  assert.equal(deleteGuestType(next, 'partenaire'), next, 'refusé tant que quelqu’un est de ce type');
  const added = addGuestType(next, 'Élu·e');
  assert.equal(added.ticketing.guestTypes.at(-1)!.key, 'elu-e');
  assert.equal(deleteGuestType(added, 'elu-e').ticketing.guestTypes.length, next.ticketing.guestTypes.length);
});

test('a status may be on several bracelets, and a person holds all of them', () => {
  let next = addBracelet(addBracelet(plan, 'Prix bar'), 'Backstage');
  next = setBraceletDefault(next, 'prix-bar', 'partenaire', true);
  next = setBraceletDefault(next, 'backstage', 'partenaire', true);
  assert.deepEqual(next.ticketing.bracelets.map((b) => b.defaultFor), [['partenaire'], ['partenaire']], 'le second ne décoche plus le premier');
  next = addExtraPerson(next, 'partenaire');
  const row = ticketingReport(next, new PlanIndex(next)).rows.find((r) => r.kind === 'extra')!;
  assert.deepEqual(row.braceletKeys, ['prix-bar', 'backstage']);
  assert.ok(ticketingCsv(next, new PlanIndex(next)).includes('Prix bar + Backstage'), 'une seule colonne, les deux');
});
