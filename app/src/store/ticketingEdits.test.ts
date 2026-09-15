/**
 * The billetterie's edits: the configuration in Réglages and one person's choice, against the
 * one rule that makes them different: a status goes to one bracelet, and a choice equal to the
 * default is not stored.
 *
 *   npm test    (in app/)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PlanIndex, ticketingReport, type Plan } from '../engine.ts';
import { normalisePlan } from '../persistence/normalise.ts';
import { addArtist } from './setupEdits.ts';
import { addArtistMember, addGuest, deleteArtistMember, deleteGuest, setGuest } from './artistEdits.ts';
import {
  addBracelet,
  addExtraPerson,
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
  assert.deepEqual(plan.ticketing, { guestsPerArtist: 1, reserveOnDoorList: false, ticketTypes: [], bracelets: [], extras: [], choices: [] });
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
  assert.deepEqual(read.ticketing.bracelets[0]!.defaultFor, ['benevole'], 'an unknown status is dropped');
  assert.equal(read.ticketing.extras[0]!.status, 'prestataire');
  assert.equal(read.ticketing.choices.length, 2, 'a choice deciding nothing is not kept; a note is a decision');
  assert.equal(read.ticketing.choices[1]!.note, 'vient tard');
});

test('a status goes to one bracelet: ticking it here unticks it there', () => {
  let next = addBracelet(addBracelet(plan, 'Basique'), 'Backstage');
  next = setBraceletDefault(next, 'basique', 'artiste', true);
  next = setBraceletDefault(next, 'backstage', 'artiste', true);
  const basique = next.ticketing.bracelets.find((b) => b.key === 'basique')!;
  const backstage = next.ticketing.bracelets.find((b) => b.key === 'backstage')!;
  assert.deepEqual(basique.defaultFor, []);
  assert.deepEqual(backstage.defaultFor, ['artiste']);
  next = setBraceletDefault(next, 'backstage', 'artiste', false);
  assert.deepEqual(next.ticketing.bracelets.find((b) => b.key === 'backstage')!.defaultFor, []);
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
  const defaults = { ticketTypeKey: 'pass-complet', braceletKey: null };

  next = chooseForPerson(next, 'benevole', v, { ticketTypeKey: 'loto' }, defaults);
  assert.deepEqual(next.ticketing.choices, [{ personKind: 'benevole', personKey: v, ticketTypeKey: 'loto', braceletKey: null, drinkTickets: null, note: '' }]);
  assert.equal(chooseForPerson(next, 'benevole', v, { ticketTypeKey: 'pass-complet' }, defaults).ticketing.choices.length, 0);

  const gone = deleteTicketType(next, 'loto');
  assert.equal(gone.ticketing.choices.length, 0, 'nothing left to choose');
  assert.equal(clearChoices(next, 'benevole', v).ticketing.choices.length, 0);
});

test('a bracelet chosen by hand goes with the bracelet when it is deleted', () => {
  let next = addBracelet(plan, 'Backstage');
  next = chooseForPerson(next, 'orga', 'o1', { braceletKey: 'backstage' }, { ticketTypeKey: null, braceletKey: null });
  assert.equal(next.ticketing.choices.length, 1);
  assert.equal(deleteBracelet(next, 'backstage').ticketing.choices.length, 0);
});

test('an extra person is typed in place, and leaves with their choices', () => {
  let next = addExtraPerson(addBracelet(plan, 'Basique'), 'prestataire');
  const key = next.ticketing.extras[0]!.key;
  next = setExtraPerson(next, key, { firstName: 'Pat', drinkTickets: 3, mealTickets: Number.NaN });
  assert.equal(next.ticketing.extras[0]!.firstName, 'Pat');
  assert.equal(next.ticketing.extras[0]!.drinkTickets, 3);
  assert.equal(next.ticketing.extras[0]!.mealTickets, 0, 'a NaN is ignored');
  next = chooseForPerson(next, 'extra', key, { braceletKey: 'basique' }, { ticketTypeKey: null, braceletKey: null });
  const report = ticketingReport(next, new PlanIndex(next));
  assert.ok(report.rows.some((r) => r.kind === 'extra' && r.key === key && r.braceletKey === 'basique'));
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
  next = chooseForPerson(next, 'invite', g, { ticketTypeKey: 'x' }, { ticketTypeKey: null, braceletKey: null });
  assert.equal(next.ticketing.choices.length, 1);

  const report = ticketingReport(next, new PlanIndex(next));
  assert.ok(report.rows.some((r) => r.kind === 'invite' && r.key === g && r.statuses[0]!.label === 'Invité de Trio'));

  assert.equal(deleteGuest(next, 'trio', g).ticketing.choices.length, 0);
  const withoutMember = deleteArtistMember(next, 'trio', member.key);
  assert.equal(withoutMember.ticketing.choices.length, 0, "the member's guests' choices go with the member");
  assert.equal(setGuestsPerArtist(plan, 2.4).ticketing.guestsPerArtist, 2);
});
