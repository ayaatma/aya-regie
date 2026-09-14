/**
 * Walking a phase grid with the arrows, as geometry.
 *
 * The interesting half is vertical: rows are packed, so two boxes on neighbouring rows rarely
 * start at the same hour and "down" has to mean the nearest box in time rather than the same
 * index one row lower.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { firstBox, stepBox, type NavRows } from './phaseNav.ts';

const box = (key: string, start: number, end: number) => ({ key, start, end });

/*
 *  row 0   [a 0-4]        [b 10-14]
 *  row 1        (vide)
 *  row 2      [c 2-6]  [d 8-9]
 */
const ROWS: NavRows = [
  [box('a', 0, 4), box('b', 10, 14)],
  [],
  [box('c', 2, 6), box('d', 8, 9)],
];

test('the first press with nothing selected lands on the first box there is', () => {
  assert.equal(firstBox(ROWS), 'a');
  assert.equal(stepBox(ROWS, null, 1, 0), 'a');
  assert.equal(stepBox(ROWS, null, 0, -1), 'a');
});

test('an empty grid has nowhere to go', () => {
  assert.equal(firstBox([]), null);
  assert.equal(firstBox([[], []]), null);
  assert.equal(stepBox([[], []], null, 1, 0), null);
});

test('left and right walk the row in clock order and stop at its ends', () => {
  assert.equal(stepBox(ROWS, 'a', 1, 0), 'b');
  assert.equal(stepBox(ROWS, 'b', -1, 0), 'a');
  assert.equal(stepBox(ROWS, 'b', 1, 0), null, 'rien après la dernière case de la ligne');
  assert.equal(stepBox(ROWS, 'a', -1, 0), null);
});

test('down lands on the box nearest in time, not on the same index', () => {
  // 'a' starts at 0. On row 2, 'c' starts at 2 and 'd' at 8: c is nearer.
  assert.equal(stepBox(ROWS, 'a', 0, 1), 'c');
  // 'b' starts at 10. 'd' ends at 9, so it is one hour away; 'c' is four away.
  assert.equal(stepBox(ROWS, 'b', 0, 1), 'd');
});

test('a box the cursor is already over wins, whatever else is on the row', () => {
  const rows: NavRows = [[box('haut', 5, 6)], [box('large', 0, 20), box('proche', 4, 4.5)]];
  // 'proche' starts nearer to 5 than 'large' does, but 5 falls INSIDE 'large': the eye drops onto
  // the box under the cursor rather than onto the one whose left edge is closest.
  assert.equal(stepBox(rows, 'haut', 0, 1), 'large');
});

test('up and down step over an empty row rather than stopping on it', () => {
  assert.equal(stepBox(ROWS, 'c', 0, -1), 'a', 'la ligne 1 est vide et ne retient pas le curseur');
  assert.equal(stepBox(ROWS, 'a', 0, 1), 'c');
});

test('there is nothing above the first row or below the last', () => {
  assert.equal(stepBox(ROWS, 'a', 0, -1), null);
  assert.equal(stepBox(ROWS, 'c', 0, 1), null);
});

test('a cursor on a box that is gone falls back to the first, rather than nowhere', () => {
  // What happens when the box under it was deleted, or the day filter moved out from under it.
  assert.equal(stepBox(ROWS, 'disparue', 1, 0), 'a');
  assert.equal(stepBox(ROWS, 'disparue', 0, 1), 'a');
});
