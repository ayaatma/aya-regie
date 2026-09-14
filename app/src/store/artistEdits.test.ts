/**
 * The acts' files: the edits below the act, and what a plan from before the files reads as.
 *
 * Two things are pinned here. A member's key is unique across EVERY act, because a meal choice
 * names a member by key alone. And removing a member or an act takes the plates the régisseur
 * ticked for them along, because nothing can ever carry that key again.
 *
 *   npm test    (in app/)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeArtist, type Plan } from '../engine.ts';
import { normalisePlan } from '../persistence/normalise.ts';
import { addArtist, setArtist } from './setupEdits.ts';
import { setCateringRules, setMeal } from './cateringEdits.ts';
import {
  addArtistMember,
  addCarTrip,
  deleteArtistMember,
  deleteCarTrip,
  linkArtistMember,
  removeArtist,
  setArtistMember,
  setCarTrip,
} from './artistEdits.ts';

const here = dirname(fileURLToPath(import.meta.url));

const plan: Plan = normalisePlan(
  JSON.parse(readFileSync(join(here, '..', '..', 'public', 'fixtures', 'balanced.json'), 'utf8')),
);

test('a plan written before the files reads every act with the defaults of an empty fiche', () => {
  // The shape every plan carried until 2026-09-13: four fields and nothing else.
  const read = normalisePlan({
    ...plan,
    artists: [{ key: 'old', name: 'Old', start: 1, end: 2.5 }],
  });
  const first = read.artists[0]!;
  assert.equal(first.name, 'Old');
  assert.equal(first.size, 1);
  assert.equal(first.changeoverBefore, 0);
  assert.equal(first.soundcheckNeeded, false);
  assert.equal(first.soundcheckStart, 1, 'the set, until told otherwise');
  assert.deepEqual(first.members, []);
  assert.deepEqual(first.carTrips, []);
  assert.equal(first.trainTickets, 0);
});

test('a member whose ticket figure is null stays null: it follows the setting', () => {
  const read = normalisePlan({
    ...plan,
    artists: [
      makeArtist({
        key: 'a',
        name: 'A',
        start: 1,
        end: 2,
        members: [
          { key: 'a-m1', firstName: 'Lou', lastName: '', role: 'technicien', diet: '', allergies: '', drinkTickets: null, payment: 'facture', guests: [], linkedKind: null, linkedKey: '' },
          { key: '', firstName: 'Nobody', lastName: '', role: 'musicien', diet: '', allergies: '', drinkTickets: 3, payment: 'cash', guests: [], linkedKind: null, linkedKey: '' },
        ],
      }),
    ],
    catering: {
      ...plan.catering,
      choices: [{ personKind: 'artiste', personKey: 'a-m1', serviceKey: '2027-03-13|soir', takes: false }],
    },
  });
  const members = read.artists[0]!.members;
  assert.equal(members.length, 1, 'a member with no key is dropped: nothing could point at it');
  assert.equal(members[0]!.drinkTickets, null);
  assert.equal(members[0]!.role, 'technicien');
  assert.equal(members[0]!.payment, 'facture');
  assert.equal(read.catering.choices[0]!.personKind, 'artiste');
});

test('a new member gets a key no other act uses, so a ticked plate can never point at two people', () => {
  let next = addArtist(plan, 'Un');
  next = addArtist(next, 'Deux');
  const [un, deux] = next.artists.slice(-2).map((a) => a.key);
  next = addArtistMember(next, un!);
  next = addArtistMember(next, un!);
  next = addArtistMember(next, deux!);
  const keys = next.artists.flatMap((a) => a.members.map((m) => m.key));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(next.artists.find((a) => a.key === un)!.members.length, 2);
});

test('editing a member changes that field and nothing else, and ignores a number that is not one', () => {
  let next = addArtistMember(addArtist(plan, 'Trio'), 'trio');
  const key = next.artists.find((a) => a.key === 'trio')!.members[0]!.key;
  next = setArtistMember(next, 'trio', key, { firstName: 'Lou', drinkTickets: 4 });
  next = setArtistMember(next, 'trio', key, { drinkTickets: Number.NaN });
  const member = next.artists.find((a) => a.key === 'trio')!.members[0]!;
  assert.equal(member.firstName, 'Lou');
  assert.equal(member.drinkTickets, 4);
  assert.equal(member.role, 'musicien');
});

test('removing a member takes the plates ticked for them along', () => {
  let next = setCateringRules(addArtistMember(addArtist(plan, 'Trio'), 'trio'), { enabled: true });
  const key = next.artists.find((a) => a.key === 'trio')!.members[0]!.key;
  next = setMeal(next, 'artiste', key, '2027-03-13|midi', true, false);
  assert.equal(next.catering.choices.filter((c) => c.personKey === key).length, 1);

  const gone = deleteArtistMember(next, 'trio', key);
  assert.equal(gone.artists.find((a) => a.key === 'trio')!.members.length, 0);
  assert.equal(gone.catering.choices.filter((c) => c.personKey === key).length, 0);
  // Somebody else's choice is untouched.
  const other = setMeal(next, 'benevole', plan.volunteers[0]!.key, '2027-03-13|midi', true, false);
  const kept = deleteArtistMember(other, 'trio', key);
  assert.equal(kept.catering.choices.filter((c) => c.personKind === 'benevole').length, 1);
});

test('removing an act takes its members and their plates along, and the volunteers keep their answer', () => {
  let next = setCateringRules(addArtistMember(addArtist(plan, 'Trio'), 'trio'), { enabled: true });
  const key = next.artists.find((a) => a.key === 'trio')!.members[0]!.key;
  next = setMeal(next, 'artiste', key, '2027-03-13|midi', true, false);
  const named = plan.artists[0]!.key;
  const before = next.volunteers.filter((v) => v.artistKeys.includes(named)).length;
  assert.ok(before > 0, 'somebody named the first act');

  const gone = removeArtist(removeArtist(next, 'trio'), named);
  assert.ok(!gone.artists.some((a) => a.key === 'trio' || a.key === named));
  assert.equal(gone.catering.choices.filter((c) => c.personKey === key).length, 0);
  assert.equal(gone.volunteers.filter((v) => v.artistKeys.includes(named)).length, before);
});

test('a trajet starts nowhere and ends at the venue, and every field of it edits by key', () => {
  let next = addCarTrip(addArtist(plan, 'Trio'), 'trio');
  const trip = next.artists.find((a) => a.key === 'trio')!.carTrips[0]!;
  assert.equal(trip.toVenue, true);
  assert.equal(trip.fromVenue, false);
  next = setCarTrip(next, 'trio', trip.key, { fromAddress: 'Lyon', fuel: 'diesel', tolls: false });
  const edited = next.artists.find((a) => a.key === 'trio')!.carTrips[0]!;
  assert.equal(edited.fromAddress, 'Lyon');
  assert.equal(edited.fuel, 'diesel');
  assert.equal(edited.tolls, false);
  assert.equal(deleteCarTrip(next, 'trio', trip.key).artists.find((a) => a.key === 'trio')!.carTrips.length, 0);
});

test('setArtist reaches every field of the fiche and leaves a NaN where it found a number', () => {
  const key = plan.artists[0]!.key;
  const next = setArtist(plan, key, { patchSize: 8, soundcheckNeeded: true, soundcheckStart: -20, changeoverBefore: Number.NaN });
  const artist = next.artists.find((a) => a.key === key)!;
  assert.equal(artist.patchSize, 8);
  assert.equal(artist.soundcheckNeeded, true);
  assert.equal(artist.soundcheckStart, -20);
  assert.equal(artist.changeoverBefore, 0);
});


test('linking a member to a bénévole copies their name once, into empty fields only, and unlinking keeps it', () => {
  const who = plan.volunteers[0]!;
  let next = addArtistMember(addArtist(plan, 'Trio'), 'trio');
  const key = next.artists.find((a) => a.key === 'trio')!.members[0]!.key;
  next = setArtistMember(next, 'trio', key, { firstName: 'Lou' });
  next = linkArtistMember(next, 'trio', key, 'benevole', who.key);
  const linked = next.artists.find((a) => a.key === 'trio')!.members[0]!;
  assert.equal(linked.linkedKind, 'benevole');
  assert.equal(linked.linkedKey, who.key);
  assert.equal(linked.firstName, 'Lou', 'what was typed stays');
  assert.equal(linked.lastName, who.lastName, 'what was empty is filled from the person');

  const unlinked = linkArtistMember(next, 'trio', key, null, '').artists.find((a) => a.key === 'trio')!.members[0]!;
  assert.equal(unlinked.linkedKind, null);
  assert.equal(unlinked.lastName, who.lastName, 'a copy, so it stays');

  // Linking to somebody the plan does not hold changes nothing.
  assert.equal(linkArtistMember(next, 'trio', key, 'orga', 'nobody'), next);
});

test('a link half written in storage reads as no link, and the cumul setting reads as a boolean', () => {
  const read = normalisePlan({
    ...plan,
    artists: [makeArtist({ key: 'a', name: 'A', start: 1, end: 2, members: [
      { ...plan.artists[0]!, key: 'm1', linkedKind: 'orga', linkedKey: '' } as never,
      { key: 'm2', linkedKind: 'benevole', linkedKey: plan.volunteers[0]!.key } as never,
    ] })],
    catering: { ...plan.catering, rules: { ...plan.catering.rules, artistDrinksCumulative: 'yes' as never } },
  });
  const [m1, m2] = read.artists[0]!.members;
  assert.equal(m1!.linkedKind, null);
  assert.equal(m2!.linkedKind, 'benevole');
  assert.equal(m2!.linkedKey, plan.volunteers[0]!.key);
  assert.equal(read.catering.rules.artistDrinksCumulative, false);
});
