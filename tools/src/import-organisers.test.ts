/**
 * The pole organisers' import.
 *
 * The headers below are a guess at a form that does not exist yet, so these tests are not proof
 * that the real file will bind. What they do prove is everything that is not the wording: that a
 * missing name column stops the import loudly rather than producing empty people, that a
 * re-import never invalidates a code already sent out or orphans the poles somebody runs, and
 * that a organiser's code is sized for what it actually opens.
 *
 * When the real form arrives, add its true headers to `REAL_HEADERS` below and the binding test
 * becomes proof rather than a rehearsal.
 *
 *   npm test    (in tools/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Organiser } from './model.js';
import { ORGANISER_CODE_LENGTH, VOLUNTEER_CODE_LENGTH } from './import.js';
import { bindOrganiserColumns, importOrganisers, organiserIdentity } from './import-organisers.js';

/** Google Forms exports the question as the header, punctuation, accents and all. */
const HEADERS = [
  'Horodateur',
  'Nom',
  'Prénom',
  'Adresse e-mail',
  'Numéro de téléphone',
  'Ton régime alimentaire ',
  'As-tu une allergie dont il serait préférable que nous soyons informés ? ',
  'Une remarque à nous transmettre ?',
];

const csv = (rows: string[][]): string =>
  [HEADERS, ...rows]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');

const ROW = {
  camille: [
    '13/09/2026 10:00:00', 'Dubois', 'Camille', 'camille@example.org', '06 01 02 03 04',
    'Végétarien', 'Fruits à coque', 'Disponible tout le week-end',
  ],
  dominique: [
    '13/09/2026 11:00:00', 'Roy', 'Dominique', 'dominique@example.org', '06 05 06 07 08',
    'Sans restriction', 'Non', '',
  ],
};

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

test('every column of the expected form binds, and to the right field', () => {
  const { map, missing } = bindOrganiserColumns(HEADERS);
  assert.deepEqual(missing, []);
  assert.equal(map.lastName, 1);
  assert.equal(map.firstName, 2);
  assert.equal(map.email, 3);
  assert.equal(map.phone, 4);
  assert.equal(map.diet, 5);
  assert.equal(map.allergies, 6);
  assert.equal(map.note, 7);
});

test('allergies and diet do not steal each other, whichever order they come in', () => {
  // The two questions share vocabulary in some wordings ("régime ou allergie"), and a wrong
  // binding is worse than a missing one: it puts an allergy in the field a caterer reads as a
  // preference.
  const { map } = bindOrganiserColumns([
    'Nom', 'Prénom', 'Allergies éventuelles', 'Régime alimentaire',
  ]);
  assert.equal(map.allergies, 2);
  assert.equal(map.diet, 3);
});

test('a missing name column stops the import instead of importing nobodies', () => {
  const result = importOrganisers('Prénom,Adresse e-mail\nCamille,c@example.org');
  assert.equal(result.organisers.length, 0);
  assert.ok(result.issues.some((i) => i.severity === 'error' && i.code === 'colonne-manquante'));
});

test('an empty file says so rather than throwing', () => {
  const result = importOrganisers('');
  assert.deepEqual(result.organisers, []);
  assert.equal(result.issues[0]!.code, 'fichier-vide');
});

// ---------------------------------------------------------------------------
// What comes out
// ---------------------------------------------------------------------------

test('a row becomes a organiser with their answers and a code', () => {
  const { organisers, created, updated } = importOrganisers(csv([ROW.camille]));

  assert.equal(created, 1);
  assert.equal(updated, 0);
  const person = organisers[0]!;
  assert.equal(person.firstName, 'Camille');
  assert.equal(person.lastName, 'Dubois');
  assert.equal(person.email, 'camille@example.org');
  assert.equal(person.phone, '06 01 02 03 04');
  assert.equal(person.diet, 'Végétarien');
  assert.equal(person.allergies, 'Fruits à coque');
  assert.equal(person.note, 'Disponible tout le week-end');
});

test("a organiser's code is far longer than a volunteer's, because it opens far more", () => {
  const { organisers } = importOrganisers(csv([ROW.camille]));
  assert.equal(organisers[0]!.accessCode.length, ORGANISER_CODE_LENGTH);
  assert.ok(ORGANISER_CODE_LENGTH > VOLUNTEER_CODE_LENGTH);
  // The alphabet excludes the characters people misread aloud: no 0/O, no 1/I/L.
  assert.match(organisers[0]!.accessCode, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]+$/);
});

test('two organisers never share a code or a key', () => {
  const { organisers } = importOrganisers(csv([ROW.camille, ROW.dominique]));
  assert.equal(organisers.length, 2);
  assert.equal(new Set(organisers.map((l) => l.accessCode)).size, 2);
  assert.equal(new Set(organisers.map((l) => l.key)).size, 2);
});

test('the import brings people in and never a pole', () => {
  // Which poles somebody runs is the régisseur's decision, taken against the shape of the event
  // and changed long after the form closes. Nothing in this module knows poles exist.
  const result = importOrganisers(csv([ROW.camille]));
  assert.ok(!('leaderRoles' in result));
  assert.ok(!Object.keys(result.organisers[0]!).includes('poleKey'));
});

// ---------------------------------------------------------------------------
// Re-importing, which is what actually happens
// ---------------------------------------------------------------------------

const existingCamille: Organiser = {
  key: 'resp-camille-dubois',
  firstName: 'Camille',
  lastName: 'Dubois',
  email: 'camille@example.org',
  phone: '06 00 00 00 00',
  accessCode: 'DEJAENVOYE1234',
  montageFrom: null,
  demontageUntil: null,
  montagePoleKeys: [],
  demontagePoleKeys: [],
  diet: '',
  allergies: '',
  note: '',
};

test('a re-import keeps the key the poles point at, and the code already sent out', () => {
  const { organisers, created, updated } = importOrganisers(csv([ROW.camille]), {
    existing: [existingCamille],
  });

  assert.equal(organisers.length, 1, 'la même personne, pas une seconde');
  assert.equal(created, 0);
  assert.equal(updated, 1);
  assert.equal(organisers[0]!.key, 'resp-camille-dubois', 'ses pôles pointent sur cette clé');
  assert.equal(organisers[0]!.accessCode, 'DEJAENVOYE1234', 'son code a déjà été envoyé');
  assert.equal(organisers[0]!.phone, '06 01 02 03 04', 'ses réponses, elles, sont rafraîchies');
});

test('the address identifies the person, to the case', () => {
  const shouting = [...ROW.camille];
  shouting[3] = 'CAMILLE@EXAMPLE.ORG';
  const { organisers } = importOrganisers(csv([shouting]), { existing: [existingCamille] });
  assert.equal(organisers.length, 1);
});

test('somebody absent from the file is kept, not removed', () => {
  // A organiser who did not fill the form in again is not a organiser who resigned, and dropping them
  // would silently cut every pole they run. Removing somebody is a deliberate click elsewhere.
  const { organisers, created, updated } = importOrganisers(csv([ROW.dominique]), {
    existing: [existingCamille],
  });

  assert.equal(organisers.length, 2);
  assert.ok(organisers.some((l) => l.key === 'resp-camille-dubois'));
  assert.equal(created, 1);
  assert.equal(updated, 0);
});

test('a blank answer does not wipe what was already known', () => {
  const known: Organiser = { ...existingCamille, diet: 'Végétarien', phone: '06 00 00 00 00' };
  const silent = [...ROW.camille];
  silent[4] = '';
  silent[5] = '';

  const { organisers } = importOrganisers(csv([silent]), { existing: [known] });
  assert.equal(organisers[0]!.phone, '06 00 00 00 00');
  assert.equal(organisers[0]!.diet, 'Végétarien');
});

// ---------------------------------------------------------------------------
// What the régisseur is asked to look at
// ---------------------------------------------------------------------------

test('a row with no name is skipped and reported, and stops nothing else', () => {
  const blank = ['13/09/2026', '', '', '', '', '', '', ''];
  const { organisers, issues } = importOrganisers(csv([blank, ROW.camille]));

  assert.equal(organisers.length, 1);
  const issue = issues.find((i) => i.code === 'ligne-sans-nom')!;
  assert.equal(issue.severity, 'warning');
  assert.equal(issue.row, 1, 'la ligne est numérotée comme dans le tableur');
});

test('a organiser with no address is imported anyway, and flagged', () => {
  const anonymous = [...ROW.camille];
  anonymous[3] = '';
  const { organisers, issues } = importOrganisers(csv([anonymous]));

  assert.equal(organisers.length, 1, 'personne n\'est jamais perdu');
  assert.ok(issues.some((i) => i.code === 'sans-adresse' && i.person === 'Camille Dubois'));
});

test('the same person twice in one file is one person, and says so', () => {
  const later = [...ROW.camille];
  later[4] = '06 99 99 99 99';
  const { organisers, issues, created } = importOrganisers(csv([ROW.camille, later]));

  assert.equal(organisers.length, 1);
  assert.equal(created, 1, 'comptée une fois, pas deux');
  assert.equal(organisers[0]!.phone, '06 99 99 99 99', 'la dernière ligne fait foi');
  assert.ok(issues.some((i) => i.code === 'doublon-fichier'));
});

test('two people with the same name and no address stay two people', () => {
  // The opposite failure to the one above, and the more dangerous: merging real homonyms would
  // give one of them the other's poles and code.
  const first = ['', 'Martin', 'Claude', '', '06 01', '', '', ''];
  const second = ['', 'Martin', 'Claude', 'claude.martin@example.org', '06 02', '', '', ''];
  const { organisers } = importOrganisers(csv([first, second]));
  assert.equal(organisers.length, 2, 'une adresse et pas d\'adresse ne sont pas la même identité');
});

test('identity agrees with the rule the rest of the tool uses', () => {
  // Three places decide when two organiser records are one human: this, `volunteerIdentity`, and
  // `splitLegacyOrganisers` in the app. They must agree or a re-import duplicates somebody the
  // format conversion had merged.
  assert.equal(organiserIdentity('Camille', 'Dubois', 'C@X.FR'), 'mail:c@x.fr');
  assert.equal(organiserIdentity('Camille', 'Dubois', ''), 'nom:camille-dubois');
  assert.equal(
    organiserIdentity('Camille', 'Dubois', ' camille@x.fr '),
    organiserIdentity('camille', 'DUBOIS', 'camille@x.fr'),
  );
});
