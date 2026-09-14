/**
 * Renders the montage grid into a standalone HTML file, so it can be LOOKED AT.
 *
 *   npx tsx src/screens/phasePreview.tsx     (in app/)
 *
 * WHY THIS EXISTS. The tests check the markup and the geometry in pixels, which is what catches
 * a lane that is too tall or a bar on the wrong day. What they cannot catch is whether the thing
 * reads: whether the columns look like days, whether an événement title is legible, whether the
 * names fit in a bar. The application itself needs a login and a database, so this writes the
 * same component, with the real stylesheet, into a file anybody can open.
 *
 * It is a development tool. Nothing imports it, and it writes outside the source tree.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';

import {
  PlanIndex,
  defaultPhase,
  emptyPlan,
  validate,
  type Organiser,
  type Phase,
  type Plan,
} from '../engine.ts';
import { PlanContext, type PlanContextValue } from '../store/store.tsx';
import { PhaseGrid } from './PhaseGrid.tsx';
import { InfoPanel } from '../components/InfoPanel.tsx';
import { placeDeclared } from '../store/phaseEdits.ts';

const here = dirname(fileURLToPath(import.meta.url));
const noop = () => {};

const orga = (
  key: string,
  first: string,
  last: string,
  from: number | null,
  poles: string[] = [],
): Organiser => ({
  key,
  firstName: first,
  lastName: last,
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

/** A montage of three days, four poles, two événements and eight orgas. */
const phase: Phase = {
  ...defaultPhase('montage', '2027-03-10T08:00:00+01:00'),
  enabled: true,
  lengthHours: 64,
  poles: [
    { key: 'general', name: 'Général' },
    { key: 'son', name: 'Technique Son', colour: '#7b4dbd' },
    { key: 'scene', name: 'Scène', colour: '#2f8f5b' },
    { key: 'bar', name: 'Bar', colour: '#c2701c' },
  ],
  events: [
    { key: 'camion', label: 'Déchargement camion', start: 4, end: 7, headcount: 6 },
    { key: 'barres', label: 'Montage du bar', start: 30, end: 34, headcount: 3 },
  ],
  assignments: [
    { key: 'p1', personKind: 'orga', personKey: 'o1', poleKey: 'son', eventKey: '', start: 0, end: 12 },
    { key: 'p2', personKind: 'orga', personKey: 'o2', poleKey: 'son', eventKey: '', start: 4, end: 8 },
    { key: 'p3', personKind: 'orga', personKey: 'o3', poleKey: 'son', eventKey: '', start: 2, end: 14 },
    { key: 'p4', personKind: 'orga', personKey: 'o4', poleKey: 'scene', eventKey: '', start: 0, end: 16 },
    { key: 'p5', personKind: 'orga', personKey: 'o5', poleKey: '', eventKey: 'camion', start: 4, end: 7 },
    { key: 'p6', personKind: 'orga', personKey: 'o6', poleKey: '', eventKey: 'camion', start: 4, end: 7 },
    { key: 'p7', personKind: 'orga', personKey: 'o7', poleKey: 'bar', eventKey: '', start: 26, end: 40 },
  ],
};

const organisers = [
  orga('o1', 'Camille', 'Dubois', 0, ['son']),
  orga('o2', 'Dominique', 'Roy', 4),
  orga('o3', 'Sacha', 'Bernard', 2, ['son']),
  orga('o4', 'Alex', 'Perrin', 0, ['scene']),
  orga('o5', 'Noa', 'Lefèvre', 4),
  orga('o6', 'Charlie', 'Moreau', 4),
  orga('o7', 'Maxime', 'Girard', 24, ['bar']),
  orga('o8', 'Sam', 'Da Silva', 26),
];

const plan: Plan = {
  ...emptyPlan({
    name: 'Loto Tekno',
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

/*
 * Placed the way the régisseur's button places them, so the page shows what the grid really
 * looks like: boxes written from the declarations, plus the few decisions above.
 */
const shown = placeDeclared(plan, 'montage');

const context: PlanContextValue = {
  id: 'preview',
  plan: shown,
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
  index: new PlanIndex(shown),
  report: validate(shown),
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

const body = renderToStaticMarkup(
  <PlanContext.Provider value={context}>
    <PhaseGrid id="montage" switcher={<div className="phase-switch"><button>Montage</button><button aria-current="false">Exploit</button><button disabled>Démontage</button></div>} />
  </PlanContext.Provider>,
);

/*
 * The info pane with something in it, below the grid.
 *
 * The grid above draws the pane empty, because a selection is made by clicking and this page is
 * static markup. The pane is half of what the régisseur looks at, so the preview renders it a
 * second time on a box that exists, which is the only way to see whether a fiche READS.
 */
const panel = renderToStaticMarkup(
  <PlanContext.Provider value={context}>
    <InfoPanel
      selection={{ kind: 'case', phaseId: 'montage', assignmentKey: 'p1' }}
      onSelect={noop}
    />
  </PlanContext.Provider>,
);

const css = readFileSync(join(here, '..', 'styles.css'), 'utf8');
const out = join(here, '..', '..', '..', 'phase-preview.html');

writeFileSync(
  out,
  `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Aperçu montage</title><style>${css}</style></head>
<body class="app"><div class="app-body">${body}</div>
<div style="display:grid;grid-template-columns:var(--info-w);height:60vh;border-top:2px solid var(--line-strong)">${panel}</div></body>
</html>`,
  'utf8',
);

console.log(out);
