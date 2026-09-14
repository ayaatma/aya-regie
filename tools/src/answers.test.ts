/**
 * Reading the two free-text answers, tested on the one thing that matters about a parser that
 * guesses: that it says so when it is guessing.
 *
 * A wrong reading is survivable, because a human reviews it. A wrong reading that comes back
 * confident is not, because nobody ever looks at it again. So every case below asserts the
 * confidence as well as the value.
 */

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { clockOffset, parseAvailabilityNote, parsePhaseAnswer, parsePoleAnswer } from './answers.js';
import { EVENT_LENGTH_HOURS, EVENT_START_ISO, buildPoles } from './event-config.js';
import { DEFAULT_SLOTS } from './model.js';

const read = (note: string) =>
  parseAvailabilityNote(note, DEFAULT_SLOTS, EVENT_START_ISO, EVENT_LENGTH_HOURS);

const { poles } = buildPoles();

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

test('an hour on the clock becomes an offset from the event start', () => {
  // The event runs midday to six in the morning: midday is zero, 2h is fourteen hours in, and
  // 9h in the morning is a time this night never reaches.
  strictEqual(clockOffset(EVENT_START_ISO, EVENT_LENGTH_HOURS, 12), 0);
  strictEqual(clockOffset(EVENT_START_ISO, EVENT_LENGTH_HOURS, 18), 6);
  strictEqual(clockOffset(EVENT_START_ISO, EVENT_LENGTH_HOURS, 0), 12);
  strictEqual(clockOffset(EVENT_START_ISO, EVENT_LENGTH_HOURS, 2), 14);
  strictEqual(clockOffset(EVENT_START_ISO, EVENT_LENGTH_HOURS, 9), null);
  strictEqual(clockOffset(EVENT_START_ISO, EVENT_LENGTH_HOURS, 18, 30), 6.5);
});

// ---------------------------------------------------------------------------
// The time constraint
// ---------------------------------------------------------------------------

test('no answer, and every way of saying "no constraint", refuse nothing', () => {
  for (const note of ['', '   ', 'Non', 'Aucune', 'Aucune contrainte', 'Rien', 'RAS', 'Tout me va']) {
    const reading = read(note);
    deepStrictEqual(reading.value, [], `"${note}"`);
    strictEqual(reading.confident, true, `"${note}" ne doit soulever aucun doute`);
  }
});

test('an interval said negatively is the tranche it names, and nothing else', () => {
  for (const note of [
    'Je ne suis pas disponible de 18h à 0h',
    'Pas dispo entre 18h et 0h, désolé',
    'impossible de 18h a minuit',
  ]) {
    // "minuit" and "midi" are hours too: written as words is how people write them.
    const reading = read(note);
    deepStrictEqual(reading.value, ['18h-00h'], `"${note}"`);
    strictEqual(reading.confident, true, `"${note}" tombe pile sur une tranche`);
  }
});

test('"pas avant 18h" refuses the afternoon and stays confident', () => {
  const reading = read('Je ne peux pas avant 18h, je travaille');
  deepStrictEqual(reading.value, ['12h-18h']);
  strictEqual(reading.confident, true);
});

test('a constraint that cuts a tranche in half refuses it whole, and says so', () => {
  // The plan is slot-granular, so there is nothing finer to store. Refusing too much is a pair
  // of hands the régisseur can give back in one click; refusing too little is somebody placed at
  // an hour they said they could not come. The reason names the tranche.
  const reading = read('Je ne peux pas avant 15h');
  deepStrictEqual(reading.value, ['12h-18h']);
  strictEqual(reading.confident, false);
  strictEqual(reading.reason?.includes('12h'), true, 'la raison doit nommer la tranche');
});

test('leaving early is read as a constraint even with no negative word in the sentence', () => {
  const reading = read('Je pars à 0h');
  deepStrictEqual(reading.value, ['00h-06h']);
  strictEqual(reading.confident, true);
});

test('two refusals in one sentence are both kept', () => {
  const reading = read('pas de 12h à 18h et pas de 0h à 6h');
  deepStrictEqual(reading.value, ['12h-18h', '00h-06h']);
});

test('a sentence with no hour in it is never guessed at', () => {
  const reading = read("Je dois m'organiser avec la nounou, je vous préviens dès que je sais");
  deepStrictEqual(reading.value, [], 'aucune tranche ne doit être inventée');
  strictEqual(reading.confident, false);
  strictEqual(reading.reason?.includes('nounou'), true, 'la phrase doit être citée telle quelle');
});

// ---------------------------------------------------------------------------
// The pole answers
// ---------------------------------------------------------------------------

test('a pole answered from the list resolves with no doubt', () => {
  const leaf = poles.find((p) => p.name === 'Service')!;
  for (const answer of [leaf.path, leaf.name]) {
    const reading = parsePoleAnswer(answer, poles);
    strictEqual(reading.value, leaf.key, answer);
    strictEqual(reading.confident, true, answer);
  }
});

test('an "Autre" answer naming one pole in a sentence resolves, but never confidently', () => {
  const reading = parsePoleAnswer("Je préférerais la Plonge si c'est possible", poles);
  strictEqual(reading.value, poles.find((p) => p.name === 'Plonge')!.key);
  strictEqual(reading.confident, false, 'lire une phrase reste une interprétation');
});

test('an "Autre" answer naming no pole resolves to nothing and is flagged', () => {
  const reading = parsePoleAnswer("Autre : je voudrais m'occuper du feu d'artifice", poles);
  strictEqual(reading.value, '');
  strictEqual(reading.confident, false);
  strictEqual(reading.reason?.includes('feu'), true, "la réponse doit être citée telle quelle");
});

test('an answer naming two poles is left for a human rather than resolved to the first', () => {
  const reading = parsePoleAnswer('plutôt Plonge ou Service', poles);
  strictEqual(reading.value, '', 'choisir à leur place est exactement la faute à ne pas commettre');
  strictEqual(reading.confident, false);
});

test('"peu importe" is an answer, and it names no pole', () => {
  const reading = parsePoleAnswer('Peu importe', poles);
  strictEqual(reading.value, '');
  strictEqual(reading.confident, true);
});

// ---------------------------------------------------------------------------
// The montage / démontage question, which the real form asks once for both
// ---------------------------------------------------------------------------

test('a bare yes is a yes for both phases, a bare no is a no for both', () => {
  for (const which of ['montage', 'demontage'] as const) {
    strictEqual(parsePhaseAnswer('Oui', which).value, true);
    strictEqual(parsePhaseAnswer('Non', which).value, false);
    strictEqual(parsePhaseAnswer('', which).value, false);
    strictEqual(parsePhaseAnswer('Oui', which).confident, true);
  }
});

test('an answer that names one phase is a no about the other, with no doubt attached', () => {
  const montage = parsePhaseAnswer('Oui, pour le montage', 'montage');
  strictEqual(montage.value, true);
  strictEqual(montage.confident, true);
  strictEqual(parsePhaseAnswer('Oui, pour le montage', 'demontage').value, false);
});

test('"démontage" never reads as "montage", although it contains the word', () => {
  strictEqual(parsePhaseAnswer('Oui, pour le démontage', 'montage').value, false);
  strictEqual(parsePhaseAnswer('Oui, pour le démontage', 'demontage').value, true);
  strictEqual(parsePhaseAnswer('Dispo pour le démontage le lendemain', 'montage').value, false);
});

test('a sentence naming one phase and refusing the other is read as it is written', () => {
  const said = 'Je peux venir aider au montage, pas au démontage';
  strictEqual(parsePhaseAnswer(said, 'montage').value, true);
  strictEqual(parsePhaseAnswer(said, 'demontage').value, false);
});

test('a sentence naming neither phase is still read, and flagged', () => {
  const reading = parsePhaseAnswer('faut voir avec mon boulot', 'montage');
  strictEqual(reading.value, true);
  strictEqual(reading.confident, false);
});
