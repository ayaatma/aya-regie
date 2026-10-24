/**
 * The words said while a créneau, a band or a box is being stretched (2026-10-24).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dragReadoutText } from './DragReadout.tsx';

test('a stretch reads start, end and length, past midnight included', () => {
  assert.equal(dragReadoutText('2027-03-13T12:00:00', 2, 4.5), '14h → 16h30 · 2h30');
  assert.equal(dragReadoutText('2027-03-13T12:00:00', 11, 13), '23h → 1h · 2h');
});
