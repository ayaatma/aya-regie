/**
 * The arrow keys, tested as geometry.
 *
 * Two rows of a grid: the bar cut into three two-hour shifts, and the entrance into one long
 * one. Everything the régisseur will actually do with the keys is a walk over this shape.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { firstCursor, stepCursor, type NavLanes } from './gridNav.ts';

const lanes: NavLanes = [
  [
    { key: 'bar-1', start: 0, end: 2, count: 2 },
    { key: 'bar-2', start: 2, end: 4, count: 0 },
    { key: 'bar-3', start: 4, end: 6, count: 3 },
  ],
  [{ key: 'entree-1', start: 0, end: 6, count: 1 }],
];

test('the first arrow press lands on the first box there is', () => {
  assert.deepEqual(firstCursor(lanes), { shiftKey: 'bar-1', index: 0 });
  assert.deepEqual(stepCursor(lanes, null, 1, 0), { shiftKey: 'bar-1', index: 0 });
});

test('left and right follow time along the same pole, stepping over empty shifts', () => {
  // bar-2 has nobody in it: stopping there would be a key press that appears not to work.
  assert.deepEqual(stepCursor(lanes, { shiftKey: 'bar-1', index: 0 }, 1, 0), {
    shiftKey: 'bar-3',
    index: 0,
  });
  assert.deepEqual(stepCursor(lanes, { shiftKey: 'bar-3', index: 2 }, -1, 0), {
    shiftKey: 'bar-1',
    index: 1,
  });
});

test('the row is kept when the next shift is deep enough, and clamped when it is not', () => {
  assert.deepEqual(stepCursor(lanes, { shiftKey: 'bar-1', index: 1 }, 1, 0), {
    shiftKey: 'bar-3',
    index: 1,
  });
  // Coming back from a shift of three into a shift of two, the third row has nowhere to be.
  assert.deepEqual(stepCursor(lanes, { shiftKey: 'bar-3', index: 2 }, -1, 0), {
    shiftKey: 'bar-1',
    index: 1,
  });
});

test('nothing happens at the ends of a row', () => {
  assert.equal(stepCursor(lanes, { shiftKey: 'bar-1', index: 0 }, -1, 0), null);
  assert.equal(stepCursor(lanes, { shiftKey: 'bar-3', index: 0 }, 1, 0), null);
});

test('down walks the column, then falls into the row below at the same hour', () => {
  assert.deepEqual(stepCursor(lanes, { shiftKey: 'bar-1', index: 0 }, 0, 1), {
    shiftKey: 'bar-1',
    index: 1,
  });
  assert.deepEqual(stepCursor(lanes, { shiftKey: 'bar-1', index: 1 }, 0, 1), {
    shiftKey: 'entree-1',
    index: 0,
  });
  // And there is nothing under the last row.
  assert.equal(stepCursor(lanes, { shiftKey: 'entree-1', index: 0 }, 0, 1), null);
});

test('up comes back into the row above, at the hour it left from and at its last box', () => {
  assert.deepEqual(stepCursor(lanes, { shiftKey: 'entree-1', index: 0 }, 0, -1), {
    shiftKey: 'bar-1',
    index: 1,
  });
  assert.equal(stepCursor(lanes, { shiftKey: 'bar-1', index: 0 }, 0, -1), null);
});

test('a row with nobody on at that hour hands over its nearest shift instead', () => {
  const staggered: NavLanes = [
    [{ key: 'haut', start: 10, end: 12, count: 1 }],
    [
      { key: 'bas-tot', start: 0, end: 2, count: 1 },
      { key: 'bas-tard', start: 14, end: 16, count: 2 },
    ],
  ];
  assert.deepEqual(stepCursor(staggered, { shiftKey: 'haut', index: 0 }, 0, 1), {
    shiftKey: 'bas-tard',
    index: 0,
  });
});

test('a cursor on a shift that no longer exists is put back on the first box', () => {
  assert.deepEqual(stepCursor(lanes, { shiftKey: 'disparu', index: 4 }, 0, 1), {
    shiftKey: 'bar-1',
    index: 0,
  });
});

test('a grid with nobody placed anywhere has nowhere to put a cursor', () => {
  const empty: NavLanes = [[{ key: 'vide', start: 0, end: 2, count: 0 }]];
  assert.equal(firstCursor(empty), null);
  assert.equal(stepCursor(empty, null, 1, 0), null);
});
