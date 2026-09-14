/**
 * Keeping one person on one row across a pole's whole lane.
 *
 *   npm test    (in app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { laneRows, type LaneShift } from './laneRows.ts';

const shift = (key: string, start: number, headcount: number, assignees: string[]): LaneShift => ({
  key,
  start,
  headcount,
  assignees,
});

test('somebody working two créneaux in a row keeps the same line', () => {
  const rows = laneRows([
    shift('s1', 0, 3, ['marie', 'jean', 'sofia']),
    // Marie stays on, the other two are relieved. Without this, Marie would be drawn on the
    // first row of one and the last row of the other.
    shift('s2', 2, 3, ['pierre', 'lea', 'marie']),
  ]);

  assert.deepEqual(rows.get('s1'), ['marie', 'jean', 'sofia']);
  assert.equal(rows.get('s2')![0], 'marie');
});

test('a place nobody holds stays empty rather than sliding everybody up', () => {
  const rows = laneRows([
    shift('s1', 0, 3, ['marie', 'jean', 'sofia']),
    shift('s2', 2, 3, ['sofia']),
  ]);

  // Sofia keeps the third row; the two above her are places to fill, and the créneau still
  // draws three of them because it asks for three.
  assert.deepEqual(rows.get('s2'), [null, null, 'sofia']);
});

test('a créneau always draws at least what it asks for', () => {
  const rows = laneRows([shift('s1', 0, 4, ['marie'])]);
  assert.deepEqual(rows.get('s1'), ['marie', null, null, null]);
});

test('a créneau over its headcount draws everybody, and hides none of them', () => {
  const rows = laneRows([shift('s1', 0, 1, ['marie', 'jean', 'sofia'])]);
  assert.deepEqual(rows.get('s1'), ['marie', 'jean', 'sofia']);
});

test('two people who both want the same row are separated, the newcomer moving', () => {
  const rows = laneRows([
    shift('s1', 0, 2, ['marie', 'jean']),
    shift('s2', 2, 2, ['jean', 'marie']),
    // Marie leaves, Sofia arrives and takes the row Marie was on.
    shift('s3', 4, 2, ['jean', 'sofia']),
  ]);

  assert.deepEqual(rows.get('s2'), ['marie', 'jean'], 'chacun garde sa ligne');
  assert.deepEqual(rows.get('s3'), ['sofia', 'jean']);
});

test('a lane with no créneau at all answers nothing rather than throwing', () => {
  assert.equal(laneRows([]).size, 0);
});

test('the créneaux are walked in clock order, whatever order they arrive in', () => {
  const rows = laneRows([
    shift('late', 4, 2, ['marie']),
    shift('early', 0, 2, ['jean', 'marie']),
  ]);
  // Marie was on row 1 of the earlier créneau, so she keeps row 1 in the later one, which has
  // the room for it. The list arrived the other way round and it changes nothing.
  assert.deepEqual(rows.get('early'), ['jean', 'marie']);
  assert.deepEqual(rows.get('late'), [null, 'marie']);
});

test('a shorter créneau never grows a row to keep somebody aligned', () => {
  const rows = laneRows([
    shift('s1', 0, 3, ['marie', 'jean', 'sofia']),
    // Sofia was on the third row; this créneau only has one place, so she moves up rather than
    // making it draw a third row nobody asked for.
    shift('s2', 2, 1, ['sofia']),
  ]);

  assert.deepEqual(rows.get('s2'), ['sofia']);
});

test('the number of places drawn is what the créneau asks for, or how many stand in it', () => {
  const rows = laneRows([
    shift('s1', 0, 2, ['marie', 'jean']),
    shift('s2', 2, 2, ['jean']),
    shift('s3', 4, 2, ['marie', 'jean', 'sofia']),
  ]);

  assert.equal(rows.get('s1')!.length, 2);
  assert.equal(rows.get('s2')!.length, 2);
  assert.equal(rows.get('s3')!.length, 3, 'trois personnes pour deux places: trois cases');
});
