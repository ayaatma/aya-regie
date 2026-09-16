/**
 * The zoom: the slider's own mapping, and the arithmetic that makes a grid fill the screen.
 *
 * Both are pure and both are easy to get wrong by one term, which on screen looks like "the grid
 * is nearly the right size" rather than like a bug. See `ZoomSlider` and `fitZoom`.
 *
 *   npm test    (in app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EXPLOIT_ZOOM, PHASE_ZOOM, fitZoom } from './layout.ts';
import { fromPosition, toPosition } from './ZoomSlider.tsx';
import { wheelZoom } from './useWheelZoom.ts';

test('the two ends of the track are the two bounds, and the middle is the geometric mean', () => {
  const { min, max } = PHASE_ZOOM;
  assert.equal(fromPosition(0, min, max), min);
  assert.equal(fromPosition(1000, min, max), max);
  // Logarithmic, so halfway along is the geometric mean and not the arithmetic one: that is what
  // makes every millimetre of travel the same proportional change.
  assert.ok(Math.abs(fromPosition(500, min, max) - Math.sqrt(min * max)) < 1e-9);
});

test('a value and its position on the track say the same thing in both directions', () => {
  const { min, max } = EXPLOIT_ZOOM;
  for (const value of [min, 24, 60, 137, max]) {
    const back = fromPosition(toPosition(value, min, max), min, max);
    assert.ok(Math.abs(back - value) / value < 0.005, `${value} -> ${back}`);
  }
});

test('a value outside the bounds lands on the nearest end rather than off the track', () => {
  const { min, max } = EXPLOIT_ZOOM;
  assert.equal(toPosition(min / 10, min, max), 0);
  assert.equal(toPosition(max * 10, min, max), 1000);
});

test('fitting gives the hours exactly the room left after the gaps', () => {
  // 16 worked hours, one night's gap of 14 px, in a track 1014 px wide: 1000 px for 16 hours.
  assert.equal(fitZoom(16, 1014, PHASE_ZOOM, 14), 1000 / 16);
  // No gaps on the exploit: eighteen hours in 1080 px.
  assert.equal(fitZoom(18, 1080, EXPLOIT_ZOOM), 60);
});

test('fitting never leaves the bounds, and answers the fallback when there is nothing to fit', () => {
  // A five-day montage on a narrow window would want half a pixel an hour.
  assert.equal(fitZoom(120, 300, PHASE_ZOOM), PHASE_ZOOM.min);
  // One filtered hour on a wide screen would want a metre.
  assert.equal(fitZoom(1, 1200, PHASE_ZOOM), PHASE_ZOOM.max);
  // Measured before the browser laid anything out, or a day the phase does not have.
  assert.equal(fitZoom(0, 1200, PHASE_ZOOM), PHASE_ZOOM.fallback);
  assert.equal(fitZoom(16, 0, PHASE_ZOOM), PHASE_ZOOM.fallback);
});

test('the wheel zooms in on a push away, out on a pull, and never past the bounds', () => {
  assert.ok(wheelZoom(76, -100, EXPLOIT_ZOOM) > 76);
  assert.ok(wheelZoom(76, 100, EXPLOIT_ZOOM) < 76);
  // One notch out then one notch in is back where it started.
  assert.ok(Math.abs(wheelZoom(wheelZoom(76, 100, EXPLOIT_ZOOM), -100, EXPLOIT_ZOOM) - 76) < 1e-9);
  assert.equal(wheelZoom(EXPLOIT_ZOOM.max, -5000, EXPLOIT_ZOOM), EXPLOIT_ZOOM.max);
  assert.equal(wheelZoom(EXPLOIT_ZOOM.min, 5000, EXPLOIT_ZOOM), EXPLOIT_ZOOM.min);
});
