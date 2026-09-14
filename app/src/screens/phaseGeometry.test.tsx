/**
 * The geometry the montage grid actually renders, in pixels.
 *
 * WHY THIS EXISTS. The first version of this grid was a table of half-days, and it read badly in
 * ways no markup assertion caught: a pole was far taller than its contents, an événement filled
 * the height of the screen, and a phase with no événement at all left a large empty band under
 * the hours. Those are all numbers in a style attribute, so they are checked as numbers.
 *
 * Everything here is read off the rendered HTML rather than recomputed, so a change to the
 * component that breaks the reading breaks the test.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';

import { PlanIndex, defaultPhase, validate, type Organiser, type Phase, type Plan } from '../engine.ts';
import { PlanContext, type PlanContextValue } from '../store/store.tsx';
import { placeDeclared } from '../store/phaseEdits.ts';
import { EVENT_GEOMETRY, PhaseGrid, eventBlockHeight } from './PhaseGrid.tsx';
import { emptyPlan } from '../engine.ts';

const noop = () => {};

const orga = (key: string, from: number | null, poles: string[] = []): Organiser => ({
  key,
  firstName: key,
  lastName: 'Orga',
  email: '',
  phone: '',
  accessCode: '',
  diet: '',
  allergies: '',
  note: '',
  montageFrom: from,
  demontageUntil: null,
  montagePoleKeys: poles,
  demontagePoleKeys: [],
});

const montage = (over: Partial<Phase> = {}): Phase => ({
  ...defaultPhase('montage', '2027-03-10T08:00:00+01:00'),
  enabled: true,
  lengthHours: 40,
  poles: [
    { key: 'general', name: 'Général' },
    { key: 'son', name: 'Technique Son' },
  ],
  ...over,
});

function planWith(phase: Phase, organisers: Organiser[]): Plan {
  return {
    ...emptyPlan({
      name: 'test',
      startISO: '2027-03-13T12:00:00+01:00',
      lengthHours: 18,
      address: '',
      sheetUrl: '',
      rules: {
        maxConsecutiveHours: 4,
        maxBlocks: 2,
        minBreakHours: 2,
        minHoursPerPerson: 4,
      },
      slots: [],
      preferenceSlots: [],
      poles: [],
      shifts: [],
      artists: [],
      volunteers: [],
    }),
    organisers,
    montage: phase,
  };
}

/**
 * The plan with everybody's declaration written out, which is what the régisseur's button does.
 *
 * A declaration draws nothing on its own since 2026-09-11: it asks for boxes, and the boxes are
 * rows of the plan like any others. Every geometry test below therefore places them first.
 */
const placed = (plan: Plan): Plan => placeDeclared(plan, 'montage');

/** The same render, without placing anybody: what the grid draws from the plan as given. */
function renderRaw(plan: Plan): string {
  return render(plan);
}

function render(plan: Plan): string {
  const value: PlanContextValue = {
    id: 'test',
    plan,
    past: [],
    future: [],
    lastLabel: null,
    baseVersion: 0,
    savedAt: null,
    dirty: false,
    saving: false,
    conflict: null,
    outdated: null,
    error: null,
    saveError: null,
    index: new PlanIndex(plan),
    report: validate(plan),
    canUndo: false,
    canRedo: false,
    apply: noop,
    edit: noop,
    undo: noop,
    redo: noop,
    open: noop,
    reset: noop,
    retrySave: noop,
    close: noop,
    acceptTheirs: noop,
    keepMine: noop,
    restore: async () => {},
    checkpoint: async () => 1,
    historyChanged: noop,
    historyRevision: 0,
  };
  return renderToStaticMarkup(
    <PlanContext.Provider value={value}>
      <PhaseGrid id="montage" />
    </PlanContext.Provider>,
  );
}

/**
 * The height of each lane track, in the order they are drawn.
 *
 * Read off the track and off nothing else: the bars carry a height too, and counting those would
 * make the answer depend on how many people are on the grid rather than on how tall a lane is.
 */
const heights = (html: string): number[] =>
  [...html.matchAll(/class="lane-track[^>]*height:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));

/**
 * Every bar, as [left, width, top].
 *
 * The `px` is optional in the pattern because React writes a bare `0` for zero: a bar at the very
 * start of the axis is `left:0`, not `left:0px`.
 */
const NUMBER = String.raw`(\d+(?:\.\d+)?)(?:px)?`;
const BAR = new RegExp(
  String.raw`class="phase-bar[^"]*"[^>]*style="left:${NUMBER};width:${NUMBER};top:${NUMBER}`,
  'g',
);

const bars = (html: string): Array<[number, number, number]> =>
  [...html.matchAll(BAR)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);

test('a declaration draws nothing until it is placed', () => {
  const html = renderRaw(planWith(montage(), [orga('a', 0)]));
  // Two poles, one empty row each: the orga said they are there and nothing has been written.
  assert.deepEqual(heights(html), [30, 30]);
  assert.equal(bars(html).length, 0);
});

test('an empty pole is one row tall, not a band of empty screen', () => {
  const html = render(placed(planWith(montage(), [])));
  // Two poles, one row each: 1 * (22 + 2) + 6.
  assert.deepEqual(heights(html), [30, 30]);
});

test('a pole grows one row per person who is there at the same time, and no more', () => {
  const html = render(
    placed(
      planWith(montage(), [
        // Three orgas on the Technique Son pole, all there from the start: three rows.
        orga('a', 0, ['son']),
        orga('b', 2, ['son']),
        orga('c', 4, ['son']),
      ]),
    ),
  );
  // Général keeps its single empty row; the pole with three overlapping people is three rows.
  assert.deepEqual(heights(html), [30, 3 * 24 + 6]);
});

test('people who follow one another share a row rather than stacking', () => {
  const phase = montage({
    assignments: [
      { key: 'a1', personKind: 'orga', personKey: 'a', poleKey: 'son', eventKey: '', start: 0, end: 4 },
      { key: 'a2', personKind: 'orga', personKey: 'b', poleKey: 'son', eventKey: '', start: 4, end: 8 },
    ],
  });
  // Neither of them declared a pole, so what is left of their presence falls into Général.
  const html = render(placed(planWith(phase, [orga('a', 0), orga('b', 4)])));
  // The two decisions follow one another and share one row; the remainders overlap in Général,
  // so that lane is the taller one.
  const [general, son] = heights(html);
  assert.equal(son, 30);
  assert.ok(general !== undefined && general > son);
});

test('the événements share one lane, as tall as the fullest of them and no taller', () => {
  const phase = montage({
    events: [{ key: 'camion', label: 'Camion', start: 2, end: 4, headcount: 4 }],
  });
  const html = render(placed(planWith(phase, [])));
  /*
   * The block, then the lane's own padding, then the two poles at one row each. The lane used to
   * be the height of the screen, and before that every événement had a lane of its own.
   *
   * THE BLOCK IS MEASURED THE WAY THE STYLESHEET LAYS IT OUT, and it was not until 2026-09-12:
   * two borders, the 17 px lid, the slots' 2 px of padding top and bottom, four places of 22 px
   * and the three 2 px gaps between them. The old figure was three pixels short, `overflow:
   * hidden` swallowed the difference, and the last place of every événement was drawn with its
   * bottom sliced off.
   */
  const block = 2 + 17 + 2 * 2 + 4 * 22 + 3 * 2;
  assert.deepEqual(heights(html), [block + 6, 30, 30]);
  assert.equal((html.match(/class="lane is-events"/g) ?? []).length, 1);
});

test('no événement means no lane at all', () => {
  const html = render(placed(planWith(montage(), [])));
  assert.equal(html.includes('is-events'), false);
  assert.deepEqual(heights(html), [30, 30]);
});

test('an événement short of people draws a place to fill for each one missing', () => {
  const phase = montage({
    events: [{ key: 'camion', label: 'Camion', start: 2, end: 4, headcount: 3 }],
    assignments: [
      { key: 'a1', personKind: 'orga', personKey: 'a', poleKey: '', eventKey: 'camion', start: 2, end: 4 },
    ],
  });
  const html = render(placed(planWith(phase, [orga('a', 0)])));
  assert.equal((html.match(/class="box is-empty is-mini"/g) ?? []).length, 2);
  assert.ok(html.includes('phase-event-title'), 'le titre est sur le bloc');
  assert.equal(html.includes('is-illegal'), false, "une présence déclarée ne rougit rien");
});

test('somebody in an événement on a day they said they were away turns red there too', () => {
  /*
   * 2026-09-12. An événement was the one place on a phase where nothing ever turned red, and it
   * is the place it matters most: it is filled from whoever is around, so "was this person even
   * there" is a question nobody asks. The orga below arrives at hour 30 and is written into a
   * truck at hour 2.
   */
  const phase = montage({
    events: [{ key: 'camion', label: 'Camion', start: 2, end: 4, headcount: 1 }],
    assignments: [
      { key: 'a1', personKind: 'orga', personKey: 'a', poleKey: '', eventKey: 'camion', start: 2, end: 4 },
    ],
  });
  const html = render(placed(planWith(phase, [orga('a', 30)])));

  assert.ok(
    /class="box is-mini[^"]* is-illegal"/.test(html),
    "la case de l'événement porte le rouge",
  );
});

test('a bar is placed and sized by its own hours, and cut in two by the night', () => {
  // Present from hour 2 to the end of the phase, which is two days.
  const html = render(placed(planWith(montage(), [orga('a', 2)])));
  const drawn = bars(html);

  // At the default zoom, 20 px an hour.
  assert.equal(drawn.length, 2);
  // First day: from hour 2 to hour 16, so 40 px in and 14 h wide.
  assert.deepEqual(drawn[0]!.slice(0, 2), [40, 14 * 20 - 2]);
  // Second day: at the start of its own column, past the first day and the gap.
  assert.equal(drawn[1]![0], 16 * 20 + 14);
  assert.equal(drawn[1]![1], 16 * 20 - 2);
});

test('a day of presence with no pole is a bar across the whole day, in Général', () => {
  const html = render(placed(planWith(montage(), [orga('a', 0)])));
  const drawn = bars(html);
  assert.equal(drawn[0]![0], 0);
  assert.equal(drawn[0]![1], 16 * 20 - 2, 'toute la journée travaillée');
});

// ---------------------------------------------------------------------------
// The stylesheet and the arithmetic, checked against one another
// ---------------------------------------------------------------------------

/**
 * The declarations of one CSS rule, as text.
 *
 * A five-line parser rather than a CSS library, because what is being read here is five numbers
 * out of five rules this repository wrote itself. It matches the selector at the start of a line,
 * which is how every rule in `styles.css` is written.
 */
function cssRule(selector: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const sheet = readFileSync(join(here, '..', 'styles.css'), 'utf8');
  const at = sheet.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `règle introuvable dans styles.css: ${selector}`);
  const close = sheet.indexOf('}', at);
  assert.ok(close > at, `règle non fermée: ${selector}`);
  return sheet.slice(at, close);
}

/**
 * The first pixel value of one property inside one rule.
 *
 * Matched on a whole trimmed line rather than with a regular expression over the block, so that
 * `height` can never be read out of `line-height` and `border` never out of `border-bottom`.
 */
function cssPx(selector: string, property: string): number {
  const line = cssRule(selector)
    .split('\n')
    .map((row) => row.trim())
    .find((row) => row.startsWith(`${property}:`));
  assert.ok(line, `propriété ${property} absente de ${selector}`);
  const px = /(-?\d+(?:\.\d+)?)px/.exec(line);
  assert.ok(px, `${property} de ${selector} n'est pas en pixels: ${line}`);
  return Number(px[1]);
}

/*
 * WHY THIS TEST EXISTS, and it is the only one in this file that reads no HTML.
 *
 * A block is positioned absolutely, so its height is computed in TypeScript while everything
 * inside it is laid out by the stylesheet. The two drifted twice, and both times every test here
 * stayed green because they all measure the same arithmetic the component does: the second time,
 * `.box.is-mini` declared `height: 22px` and never overrode the `flex: 0 0 24px` it inherits
 * from `.box`, which is what a COLUMN flex box actually reads, so every place was two pixels
 * taller than counted and `overflow: hidden` ate the last one.
 */
test('the block arithmetic and the stylesheet still agree, figure by figure', () => {
  assert.equal(cssPx('.phase-event-title', 'height'), EVENT_GEOMETRY.titleH);
  assert.equal(cssPx('.phase-event-slots', 'padding'), EVENT_GEOMETRY.slotPad);
  assert.equal(cssPx('.phase-event-slots', 'gap'), EVENT_GEOMETRY.rowGap);
  assert.equal(cssPx('.phase-event-block', 'border') * 2, EVENT_GEOMETRY.border);

  // The height of a place inside a column is its flex basis, NOT its `height`. Both are asserted:
  // the basis because it is what the browser lays out, the height because a reader of the
  // stylesheet has to find the same number twice rather than two that disagree.
  assert.equal(cssPx('.box.is-mini', 'flex'), EVENT_GEOMETRY.rowH, 'la base flex fait la hauteur');
  assert.equal(cssPx('.box.is-mini', 'height'), EVENT_GEOMETRY.rowH);
});

test('a block is exactly as tall as what the stylesheet puts inside it', () => {
  for (const places of [1, 2, 6]) {
    const inside =
      EVENT_GEOMETRY.border +
      cssPx('.phase-event-title', 'height') +
      2 * cssPx('.phase-event-slots', 'padding') +
      places * cssPx('.box.is-mini', 'flex') +
      (places - 1) * cssPx('.phase-event-slots', 'gap');
    assert.equal(eventBlockHeight(places), inside, `${places} place(s)`);
  }
});

/*
 * L'orga en faute. Sa règle arrive après `.box.is-illegal` dans la feuille de style, à
 * spécificité égale, donc elle gagnait: fond blanc, texte noir, et le rouge seulement au survol.
 */
test("les couleurs d'une case d'orga cèdent à un état qui porte son propre fond", () => {
  const rule = cssRule('.box.is-orga-box');
  assert.ok(!rule.includes('background'), 'le fond ne se pose plus sans condition');
  assert.ok(!rule.includes('font-style'), "et l'italique a disparu des noms");

  const guarded = cssRule('.box.is-orga-box:not(.is-illegal):not(.is-picked)');
  assert.ok(guarded.includes('background'), 'il se pose sous condition');
});
