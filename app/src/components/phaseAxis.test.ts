/**
 * The geometry of a phase's axis: days laid end to end, nights left out.
 *
 * This is where a bar could silently land on the wrong day, so it is tested on its own rather
 * than through a screen. The montage below runs from 08:00 on Wednesday to midnight on Thursday
 * with nobody working between midnight and 08:00, which is two worked stretches of sixteen
 * hours, and hours 16 to 24 exist on no axis at all.
 *
 *   npm test    (in app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultPhase, type Phase } from '../engine.ts';
import {
  anchorAt,
  axisSpan,
  buildPhaseAxis,
  hourOn,
  hoursAt,
  packRows,
  piecesOf,
  segmentAt,
  trimTo,
  xOfAnchor,
  DAY_GAP,
  type PhaseSegment,
} from './phaseAxis.ts';

const PX = 10;

const montage = (over: Partial<Phase> = {}): Phase => ({
  ...defaultPhase('montage', '2027-03-10T08:00:00+01:00'),
  enabled: true,
  lengthHours: 40,
  ...over,
});

const axis = buildPhaseAxis(montage(), PX);

test('the axis holds one stretch per worked day, and the nights are not on it', () => {
  assert.deepEqual(
    axis.segments.map((s) => [s.start, s.end]),
    [
      [0, 16],
      [24, 40],
    ],
  );
  assert.equal(axis.width, 16 * PX + DAY_GAP + 16 * PX);
});

test('the second day starts after the gap, so the night is a separation and not a stretch', () => {
  assert.equal(axis.segments[1]!.x, 16 * PX + DAY_GAP);
});

test('a window inside one day is one bar', () => {
  const pieces = piecesOf(axis, { start: 2, end: 6 });
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0]!.x, 2 * PX);
  assert.equal(pieces[0]!.width, 4 * PX);
});

test('a window spanning the night is two bars, one per day, and never one long one', () => {
  const pieces = piecesOf(axis, { start: 10, end: 30 });
  assert.deepEqual(
    pieces.map((p) => [p.start, p.end]),
    [
      [10, 16],
      [24, 30],
    ],
  );
  // The second bar starts at the second day's own left edge, not at hour 24 of a single ruler.
  assert.equal(pieces[1]!.x, axis.segments[1]!.x);
});

test('a window entirely inside the night draws nothing, which is the truth about it', () => {
  assert.deepEqual(piecesOf(axis, { start: 17, end: 23 }), []);
});

test('a click reads back the hour it landed on', () => {
  assert.equal(hoursAt(axis, 2 * PX), 2);
  assert.equal(hoursAt(axis, axis.segments[1]!.x + 3 * PX), 27);
});

test('a click in the gap between two days is nobody: it is refused rather than rounded', () => {
  assert.equal(hoursAt(axis, 16 * PX + DAY_GAP / 2), null);
  assert.equal(segmentAt(axis, 16 * PX + DAY_GAP / 2), null);
});

test('a click gives back the whole worked stretch it fell in, which is what a day of presence is', () => {
  const segment = segmentAt(axis, axis.segments[1]!.x + 5 * PX);
  assert.deepEqual([segment?.start, segment?.end], [24, 40]);
});

test('a day cut in two by an unworked middle is two stretches with a gap between them', () => {
  // Nothing else is off here, so the nights ARE worked: what is taken out is 12h to 14h, and
  // the day boundary at midnight still separates two stretches, because a day is a day.
  const lunch = buildPhaseAxis(montage({ offStartHour: 12, offEndHour: 14 }), PX);
  assert.deepEqual(
    lunch.segments.map((s) => [s.start, s.end]),
    [
      [0, 4],
      [6, 16],
      [16, 28],
      [30, 40],
    ],
  );
  // The day heading spans both of its own stretches.
  assert.equal(lunch.days.length, 2);
  assert.equal(lunch.days[0]!.width, 4 * PX + DAY_GAP + 10 * PX);
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

test('two people at the same time take two rows, one after the other takes one', () => {
  const overlapping = [
    { start: 0, end: 12 },
    { start: 4, end: 8 },
  ];
  assert.deepEqual([...packRows(overlapping).values()].sort(), [0, 1]);

  const inTurn = [
    { start: 0, end: 4 },
    { start: 4, end: 8 },
  ];
  assert.deepEqual([...packRows(inTurn).values()], [0, 0]);
});

test('three overlapping windows take three rows, and a fourth reuses the first free one', () => {
  const rows = packRows([
    { start: 0, end: 10 },
    { start: 1, end: 9 },
    { start: 2, end: 8 },
    { start: 11, end: 12 },
  ]);
  assert.deepEqual([...rows.values()], [0, 1, 2, 0]);
});

// ---------------------------------------------------------------------------
// Trimming a box: the three ways it used to go wrong
// ---------------------------------------------------------------------------

test('pulling an edge past the end of a day means the end of that day, not its start', () => {
  const axis = buildPhaseAxis(montage(), PX);
  const [first, second] = axis.segments as [PhaseSegment, PhaseSegment];

  // Inside the day, the position is read straight off the axis and snapped to the quarter.
  assert.equal(hourOn(axis, first, first.x + 4 * PX, 0.25), 4);
  assert.equal(hourOn(axis, first, first.x + 4.1 * PX, 0.25), 4);
  assert.equal(hourOn(axis, first, first.x + 4.2 * PX, 0.25), 4.25);

  /*
   * Past either edge, and this is the regression. `hoursAt` answers null in the gap between two
   * days and the drag used to fall back to the START of the day: pulling the end of a box into
   * the night set its end to the morning, and the minimum length left a fifteen-minute box.
   */
  assert.equal(hoursAt(axis, first.x + first.width + DAY_GAP / 2), null, 'la nuit est un trou');
  assert.equal(hourOn(axis, first, first.x + first.width + 500, 0.25), first.end);
  assert.equal(hourOn(axis, first, first.x - 500, 0.25), first.start);
  assert.equal(hourOn(axis, second, second.x + second.width + 500, 0.25), second.end);
});

test('a trim keeps a quarter of an hour of the box on the day being dragged, and no more', () => {
  const axis = buildPhaseAxis(montage(), PX);
  const [first, second] = axis.segments as [PhaseSegment, PhaseSegment];

  // An ordinary trim: the other edge does not move. This is the "ça change l'horaire du début"
  // complaint, and it is the assertion that catches it coming back.
  const box = { start: 2, end: 10 };
  assert.deepEqual(trimTo(box, first, 'end', 6, 0.25), { start: 2, end: 6 });
  assert.deepEqual(trimTo(box, first, 'start', 4, 0.25), { start: 4, end: 10 });

  // Pulled past the other edge, the box stops at a quarter of an hour rather than turning inside
  // out or vanishing.
  assert.deepEqual(trimTo(box, first, 'end', 0, 0.25), { start: 2, end: 2.25 });
  assert.deepEqual(trimTo(box, first, 'start', 20, 0.25), { start: 9.75, end: 10 });

  /*
   * A box over two days, whose END is being dragged on the second one. The minimum is measured
   * from the start of THAT day, not from the box's own start the day before: a box ending at hour
   * 2.25 would draw nothing on the second day and take the grip off the screen with it.
   */
  const overnight = { start: 2, end: 30 };
  assert.deepEqual(trimTo(overnight, second, 'end', 0, 0.25), {
    start: 2,
    end: second.start + 0.25,
  });
});

/*
 * The day filter, added 2026-09-12 because a montage of several days is several screens wide.
 *
 * It narrows the axis rather than the grid, which is what makes one change enough: a day that is
 * not on the axis draws nothing through `piecesOf`, takes no drop through `segmentAt` and can hold
 * no dragged edge through `hourOn`. See `buildPhaseAxis`.
 */
test('one day asked for is one day on the axis, laid out from zero', () => {
  const second = buildPhaseAxis(montage(), PX, 1);

  assert.deepEqual(
    second.segments.map((s) => [s.start, s.end]),
    [[24, 40]],
    'seules les heures travaillées de ce jour-là',
  );
  assert.equal(second.segments[0]!.x, 0, 'le jour affiché commence à gauche de la piste');
  assert.equal(second.width, 16 * PX, 'et la piste ne fait plus que la largeur de ce jour');
  assert.deepEqual(
    second.days.map((d) => d.index),
    [1],
  );
});

test('a box on another day draws nothing at all while one day is shown', () => {
  const second = buildPhaseAxis(montage(), PX, 1);
  assert.equal(piecesOf(second, { start: 2, end: 6 }).length, 0, 'le premier jour est hors axe');
  assert.equal(piecesOf(second, { start: 26, end: 30 }).length, 1);
});

test('a day index the phase does not have leaves an empty axis, it does not fall back', () => {
  // The dates can move under a filter that was set before they did. Showing the whole phase
  // instead would look like the filter had been forgotten rather than emptied.
  const nowhere = buildPhaseAxis(montage(), PX, 9);
  assert.deepEqual(nowhere.segments, []);
  assert.equal(nowhere.width, 0);
});

test('the axis span is the worked hours and the room the nights take, filter included', () => {
  // The same arithmetic `buildPhaseAxis` lays out, which is the point: fitting the grid to the
  // screen and drawing it must never disagree about what is on screen.
  assert.deepEqual(axisSpan(montage(), null), { hours: 32, gaps: DAY_GAP });
  assert.deepEqual(axisSpan(montage(), 1), { hours: 16, gaps: 0 });
  assert.deepEqual(axisSpan(montage(), 9), { hours: 0, gaps: 0 });

  // And it agrees with the axis it describes, at any zoom.
  for (const day of [null, 0, 1]) {
    const span = axisSpan(montage(), day);
    assert.equal(buildPhaseAxis(montage(), PX, day).width, span.hours * PX + span.gaps);
  }
});

test('an anchor keeps its place in the day, and in the night, across a change of zoom', () => {
  const phase = montage();
  const narrow = buildPhaseAxis(phase, PX);
  const wide = buildPhaseAxis(phase, PX * 3);
  const second = narrow.segments[1]!;

  // Two hours into the second day lands two hours into the second day, at the new width.
  const inDay = anchorAt(narrow, second.x + 2 * PX);
  assert.equal(xOfAnchor(wide, inDay), wide.segments[1]!.x + 2 * PX * 3);

  // Five pixels into the night stays five pixels into the night: the gap does not grow.
  const first = narrow.segments[0]!;
  const inGap = anchorAt(narrow, first.x + first.width + 5);
  assert.equal(xOfAnchor(wide, inGap), wide.segments[0]!.x + wide.segments[0]!.width + 5);
});
