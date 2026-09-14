/**
 * The 24 h field's arithmetic, which is the half of it that can be wrong silently.
 *
 * A misread hour here does not look like a bug: it looks like a créneau that quietly starts an
 * hour later than the régisseur typed. So the parser's refusals matter as much as its successes,
 * and the offset it computes is checked against a real event, one that starts at midday and ends
 * at six the next morning.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clockOf, dayShift, fmtClock, hoursOf, parseClock, slideEnd } from './clock.ts';

/** The real event: 13 March 2027, midday to six. Local time, as the whole tool is. */
const start = new Date(2027, 2, 13, 12, 0, 0, 0).toISOString();

test('the field takes an hour written any of the ways somebody types it', () => {
  for (const text of ['21h30', '21:30', '21.30', '21 h 30', '2130', '21H30']) {
    assert.deepEqual(parseClock(text), { hour: 21, minute: 30 }, text);
  }
  for (const text of ['21', '21h', '21:', '21h00']) {
    assert.deepEqual(parseClock(text), { hour: 21, minute: 0 }, text);
  }
  assert.deepEqual(parseClock('930'), { hour: 9, minute: 30 }, 'trois chiffres');
  assert.deepEqual(parseClock('9h05'), { hour: 9, minute: 5 });
  assert.deepEqual(parseClock('24h'), { hour: 0, minute: 0 }, 'minuit écrit comme une fin');
});

test('a typo comes back as nothing rather than as the nearest hour that parses', () => {
  for (const text of ['', '25h', '21h61', 'minuit', '21h30h', '12 PM', '-1']) {
    assert.equal(parseClock(text), null, text);
  }
});

test('an hour is read as the moment it lands on inside the event', () => {
  assert.equal(hoursOf(start, { hour: 12, minute: 0 }, { maxHours: 18 }), 0, 'le début');
  assert.equal(hoursOf(start, { hour: 21, minute: 30 }, { maxHours: 18 }), 9.5);
  // Two in the morning is the fourteenth hour, not something in the past.
  assert.equal(hoursOf(start, { hour: 2, minute: 0 }, { maxHours: 18 }), 14);
  assert.equal(hoursOf(start, { hour: 6, minute: 0 }, { maxHours: 18 }), 18, 'la fin');
});

test('an hour outside the event is kept rather than refused', () => {
  // A set that runs past the end is a real thing to describe, and nothing here rewrites it.
  assert.equal(hoursOf(start, { hour: 8, minute: 0 }, { maxHours: 18 }), 20);
});

test('correcting a typo moves the nearest reading, not a whole day', () => {
  // 13h05 retyped as 13h is five minutes earlier. Without the tie-break it could be tomorrow.
  assert.equal(hoursOf(start, { hour: 13, minute: 0 }, { near: 1.0833, maxHours: 30 }), 1);
  assert.equal(hoursOf(start, { hour: 13, minute: 0 }, { near: 25, maxHours: 30 }), 25);
});

test('what goes in comes back out', () => {
  for (const hours of [0, 0.25, 9.5, 14, 18]) {
    const back = hoursOf(start, clockOf(start, hours), { near: hours, maxHours: 18 });
    assert.equal(back, hours, `${hours} h`);
  }
});

test('moving the start of a window moves its end by the same amount', () => {
  // A set of 21h30 to 23h00 pushed back to 22h00 is still an hour and a half.
  assert.equal(slideEnd(9.5, 11, 10), 11.5);
  assert.equal(slideEnd(9.5, 11, 8), 9.5, 'et en arrière aussi');
  assert.equal(slideEnd(0, 2, 0), 2, 'immobile, immobile');

  // Nothing is clamped: a window pushed past the end of the event goes there and is shown as a
  // problem, rather than being quietly held back.
  assert.equal(slideEnd(16, 18, 17), 19);
});

test('the hour is written padded, and the day after the start is marked', () => {
  assert.equal(fmtClock({ hour: 2, minute: 0 }), '02h00');
  assert.equal(fmtClock({ hour: 21, minute: 5 }), '21h05');
  assert.equal(dayShift(start, 9.5), 0, 'avant minuit');
  assert.equal(dayShift(start, 14), 1, 'après minuit');
});
