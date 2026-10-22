/**
 * La validation des inscriptions: who can be validated, under which message, and what a message
 * becomes once filled for one person.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_TICKETING, makeArtist, makeArtistMember } from './model.js';
import type { Plan } from './plan.js';
import {
  DEFAULT_MAIL_TEMPLATES,
  isMailAddress,
  registrantOf,
  registrants,
  renderMail,
  setRegistrationStatus,
  withMailTemplate,
} from './registration.js';

/** Only what the module reads: it never touches a créneau. */
const plan = {
  name: 'Loto Test',
  startISO: '2027-03-13T12:00:00+01:00',
  address: 'Salle des fêtes, Lyon',
  mailTemplates: {},
  volunteers: [{ key: 'v1', firstName: 'Léa', lastName: 'Martin', email: 'lea@example.org', accessCode: 'ABCD1234', status: 'valide' }],
  organisers: [
    { key: 'o1', firstName: 'Sam', lastName: 'Roux', email: 'sam@example.org', accessCode: 'ORGA-0001' },
    { key: 'o2', firstName: 'Noa', lastName: 'Petit', email: '', accessCode: '' },
  ],
  leaderRoles: [{ key: 'r1', organiserKey: 'o1', poleKey: 'bar', start: null, end: null }],
  artists: [makeArtist({ key: 'a1', name: 'Les Tests', start: 6, end: 7, members: [makeArtistMember({ key: 'm1', firstName: 'Kim', email: 'kim@example.org' })] })],
  ticketing: { ...DEFAULT_TICKETING, extras: [{ key: 'x1', firstName: 'Pat', lastName: 'Son', status: 'prestataire', phone: '', drinkTickets: 0, mealTickets: 0 }] },
} as unknown as Plan;

test('everybody but the guests can be validated, and an orga holding a pole is a responsable', () => {
  const all = registrants(plan);
  assert.deepEqual(all.map((r) => `${r.kind}:${r.key}:${r.audience}:${r.status}`), [
    'benevole:v1:benevole:valide',
    'orga:o1:responsable:candidature',
    'orga:o2:orga:candidature',
    'artiste:m1:artiste:candidature',
    'extra:x1:prestataire:candidature',
  ]);
  assert.equal(registrantOf(plan, 'artiste', 'm1')?.actName, 'Les Tests');
  assert.equal(registrantOf(plan, 'extra', 'x1')?.email, '');
});

test('a status is set on the right person of the right kind, and on nobody else', () => {
  let next = setRegistrationStatus(plan, 'orga', 'o2', 'valide');
  next = setRegistrationStatus(next, 'artiste', 'm1', 'annule');
  next = setRegistrationStatus(next, 'extra', 'x1', 'valide');
  next = setRegistrationStatus(next, 'benevole', 'v1', 'candidature');
  assert.deepEqual(registrants(next).map((r) => r.status), ['candidature', 'candidature', 'valide', 'annule', 'valide']);
  // The extra's own `status` still says what they are.
  assert.equal(next.ticketing.extras[0]?.status, 'prestataire');
});

test('a message is filled for the person, and an orga is sent the orgas’ door', () => {
  const lea = renderMail(plan, registrantOf(plan, 'benevole', 'v1')!, 'https://planning.example.org/');
  assert.equal(lea.to, 'lea@example.org');
  assert.equal(lea.subject, 'Loto Test : ton inscription bénévole est validée');
  assert.match(lea.body, /^Bonjour Léa,/);
  assert.match(lea.body, /samedi 13 mars 2027/);
  assert.match(lea.body, /ici : https:\/\/planning\.example\.org\/\?code=ABCD1234\n/);
  assert.match(lea.body, /ton code d'accès, si on te le demande : ABCD1234/);
  assert.deepEqual(lea.empty, []);

  const sam = renderMail(plan, registrantOf(plan, 'orga', 'o1')!, 'https://planning.example.org');
  assert.match(sam.subject, /responsable de pôle/);
  assert.match(sam.body, /https:\/\/planning\.example\.org\/\?responsable/);

  const kim = renderMail(plan, registrantOf(plan, 'artiste', 'm1')!, 'https://planning.example.org');
  assert.match(kim.body, /venue de Les Tests à Loto Test, le samedi 13 mars 2027, Salle des fêtes, Lyon/);
});

test('a blank with nothing to put in it is reported, and an unknown one is left alone', () => {
  const custom = withMailTemplate({}, 'orga', { subject: 'Salut {prenom}', body: 'Code {code}, {inconnu}' });
  const noa = renderMail({ ...plan, mailTemplates: custom }, registrantOf(plan, 'orga', 'o2')!, '');
  assert.equal(noa.body, 'Code , {inconnu}');
  assert.deepEqual(noa.empty, ['{code}']);
});

test('a template equal to the default is not stored', () => {
  assert.deepEqual(withMailTemplate({}, 'artiste', DEFAULT_MAIL_TEMPLATES.artiste), {});
  const stored = withMailTemplate({}, 'artiste', { subject: 'x', body: 'y' });
  assert.deepEqual(stored, { artiste: { subject: 'x', body: 'y' } });
  assert.deepEqual(withMailTemplate(stored, 'artiste', null), {});
});

test('a mail address is refused when it is obviously not one', () => {
  assert.equal(isMailAddress(' lea@example.org '), true);
  assert.equal(isMailAddress('lea@example'), false);
  assert.equal(isMailAddress('lea example.org'), false);
  assert.equal(isMailAddress(''), false);
});
