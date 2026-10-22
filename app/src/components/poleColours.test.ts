/**
 * The colours of the montage and démontage poles, which were all grey until 2026-10-22.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pole } from '../engine.ts';
import { POLE_PALETTE, phasePoleColours, poleColours } from './poleColours.ts';

const pole = (key: string, name: string, colour?: string): Pole =>
  ({ key, name, parentKey: null, ...(colour ? { colour } : {}) }) as unknown as Pole;

test('a phase pole named like an exploit pole wears its colour, whatever the case, accents or emoji', () => {
  const exploit = [pole('bar', '🍻 Bar'), pole('secu', 'Sécurité')];
  const colours = phasePoleColours(exploit, [
    { id: 'montage', poles: [{ key: 'b', name: 'bar' }, { key: 's', name: 'securite' }] },
  ]);
  const expected = poleColours(exploit);
  assert.equal(colours.get('montage|b'), expected.get('bar'));
  assert.equal(colours.get('montage|s'), expected.get('secu'));
});

test('a pole found only in the phases gets a colour of its own, the same in both phases, and a hand pick wins', () => {
  const colours = phasePoleColours([pole('bar', 'Bar')], [
    { id: 'montage', poles: [{ key: 'deco', name: 'Déco' }, { key: 'son', name: 'Son' }] },
    { id: 'demontage', poles: [{ key: 'deco2', name: 'deco' }, { key: 'x', name: 'Lumière', colour: '#123456' }] },
  ]);
  assert.ok(POLE_PALETTE.includes(colours.get('montage|deco')!));
  assert.notEqual(colours.get('montage|deco'), colours.get('montage|son'), 'deux pôles, deux couleurs');
  assert.notEqual(colours.get('montage|deco'), poleColours([pole('bar', 'Bar')]).get('bar'), 'pas celle du bar');
  assert.equal(colours.get('demontage|deco2'), colours.get('montage|deco'), 'le même nom, la même couleur');
  assert.equal(colours.get('demontage|x'), '#123456');
});
