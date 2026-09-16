/**
 * The grids' « mode édition », tested as geometry: how far an edge may be pulled, and where a
 * click in the empty part of a lane creates a créneau.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { edgeLimits, ghostWindow, MIN_WINDOW_HOURS } from './EditModeButton.tsx';

const bar = [
  { key: 'a', start: 0, end: 2 },
  { key: 'b', start: 2, end: 4 },
  { key: 'c', start: 6, end: 8 },
];

test('pulling the end of a créneau glued to the next one moves both, each keeping a quarter of an hour', () => {
  const { min, max, glued } = edgeLimits(bar[0]!, bar, 'end', 0, 18);
  assert.equal(glued?.key, 'b', 'le créneau suivant commence où celui-ci finit: il suit');
  assert.equal(min, MIN_WINDOW_HOURS);
  assert.equal(max, 4 - MIN_WINDOW_HOURS, 'jusqu’à laisser 15 min au suivant');
});

test('pulling the start of the glued second créneau is the same boundary seen from the other side', () => {
  const { min, max, glued } = edgeLimits(bar[1]!, bar, 'start', 0, 18);
  assert.equal(glued?.key, 'a');
  assert.equal(min, MIN_WINDOW_HOURS);
  assert.equal(max, 4 - MIN_WINDOW_HOURS);
});

test('a créneau with a gap before the next stops at it, and nothing follows', () => {
  const { max, glued } = edgeLimits(bar[1]!, bar, 'end', 0, 18);
  assert.equal(glued, null);
  assert.equal(max, 6, 'le bord s’arrête au début du créneau suivant');
  assert.equal(edgeLimits(bar[2]!, bar, 'end', 0, 18).max, 18, 'le dernier va jusqu’à la fin de l’événement');
  assert.equal(edgeLimits(bar[0]!, bar, 'start', 0, 18).min, 0);
});

test('the créneau a click would create starts on the whole hour, after the previous one, and stops at the next', () => {
  // Pointer at 4h40, between 4h (end of b) and 6h (start of c), default length 2 h.
  assert.deepEqual(ghostWindow(bar, 4.66, 2, 0, 18), { start: 4, end: 6 });
  // Pointer at 5h20: the whole hour is 5h, and c at 6h cuts it to one hour.
  assert.deepEqual(ghostWindow(bar, 5.33, 2, 0, 18), { start: 5, end: 6 });
  // After the last créneau there is room for the full default length.
  assert.deepEqual(ghostWindow(bar, 9.5, 2, 0, 18), { start: 9, end: 11 });
  // And the end of the event cuts it.
  assert.deepEqual(ghostWindow(bar, 17.2, 2, 0, 18), { start: 17, end: 18 });
});

test('no créneau is offered over an existing one, nor in a gap under a quarter of an hour', () => {
  assert.equal(ghostWindow(bar, 1, 2, 0, 18), null, 'sur un créneau, rien');
  const tight = [
    { key: 'x', start: 0, end: 2.1 },
    { key: 'y', start: 2.25, end: 4 },
  ];
  assert.equal(ghostWindow(tight, 2.2, 2, 0, 18), null, '9 minutes ne font pas un créneau');
});
