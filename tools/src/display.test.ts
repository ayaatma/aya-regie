/**
 * The short labels, tested on the one thing they exist for: one label, one human.
 *
 * A grid box reading "Marie D." when there are two Marie D. is not a shortened name, it is a
 * wrong one, and the régisseur moving that box at two in the morning has no way to know which
 * person they just moved.
 */

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { shortNames, type DisplayPerson } from './display.js';

const person = (firstName: string, lastName: string, over: Partial<DisplayPerson> = {}):
  DisplayPerson => ({ firstName, lastName, nickname: '', email: '', ...over });

test('one initial is enough when nothing collides', () => {
  deepStrictEqual(
    shortNames([person('Marie', 'Dubois'), person('Paul', 'Durand')]),
    ['Marie D.', 'Paul D.'],
  );
});

test('two people sharing a first name and an initial both grow, as far as they must and no further', () => {
  deepStrictEqual(
    shortNames([person('Marie', 'Dubois'), person('Marie', 'Durand')]),
    ['Marie Dub.', 'Marie Dur.'],
  );
});

test('only the people who collide grow', () => {
  // Three Marie, two of whom share "Mar". The third is unique at one letter and stays there.
  deepStrictEqual(
    shortNames([
      person('Marie', 'Martin'),
      person('Marie', 'Marchand'),
      person('Marie', 'Dubois'),
    ]),
    ['Marie Mart.', 'Marie Marc.', 'Marie D.'],
  );
});

test('accents and case do not separate two people', () => {
  deepStrictEqual(
    shortNames([person('Chloé', 'Lévy'), person('Chloe', 'Leroy')]),
    ['Chloé Lév.', 'Chloe Ler.'],
  );
});

test('a surname that is entirely used loses the full stop', () => {
  // "Ma" can never be told apart from "Mander": one is a prefix of the other. Showing it whole
  // is the strongest thing that is true, and the dot would claim an abbreviation that is not one.
  deepStrictEqual(
    shortNames([person('Jean', 'Ma'), person('Jean', 'Mander')]),
    ['Jean Ma', 'Jean Man.'],
  );
});

test('two people the tool cannot tell apart both keep their whole name', () => {
  // Nothing is invented to separate them. An index number on a grid box would say something
  // about a person that is not true, and two identical labels at least show there are two.
  deepStrictEqual(
    shortNames([
      person('Jean', 'Martin', { email: 'jean1@example.org' }),
      person('Jean', 'Martin', { email: 'jean2@example.org' }),
    ]),
    ['Jean Martin', 'Jean Martin'],
  );
});

test('the nickname replaces the first name', () => {
  deepStrictEqual(
    shortNames([person('Jean-Baptiste', 'Perrin', { nickname: 'Titi' })]),
    ['Titi P.'],
  );
});

test('a nickname collides with a real first name like any other', () => {
  deepStrictEqual(
    shortNames([
      person('Jean-Baptiste', 'Duval', { nickname: 'Jean' }),
      person('Jean', 'Dupont'),
    ]),
    ['Jean Duv.', 'Jean Dup.'],
  );
});

test('the same person recorded twice does not push their own surname longer', () => {
  // A pole organiser who also signed up as a volunteer. Same address, so the identity rule folds
  // them into one, and "Marie D." stays "Marie D." for both rows.
  deepStrictEqual(
    shortNames([
      person('Marie', 'Dubois', { email: 'marie@example.org' }),
      person('Marie', 'Dubois', { email: 'Marie@Example.org' }),
    ]),
    ['Marie D.', 'Marie D.'],
  );
});

test('somebody with no surname is shown under what there is', () => {
  strictEqual(shortNames([person('Marie', '')])[0], 'Marie');
});
