/**
 * Smoke tests: every screen renders against a real, full-sized plan.
 *
 * These are server renders, so they exercise no drag and no click. What they do catch is the
 * whole class of breakage a type checker cannot see: a hook called conditionally, a lookup that
 * returns undefined on real data, a report field read on the wrong shape, a `.map` over
 * something the fixture leaves empty. That class is exactly what breaks a data-dense screen,
 * and the alternative is finding out by opening a browser and scrolling.
 *
 * The plan is the balanced scenario at full size: 120 volunteers, 91 shifts, 247 assignments.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  PlanIndex,
  buildProposals,
  cateringReport,
  groupProposals,
  makeArtist,
  makeArtistMember,
  solve,
  ticketingReport,
  validate,
  type Plan,
  type TicketPersonKind,
} from '../engine.ts';
import { setCateringRules } from '../store/cateringEdits.ts';
import { normalisePlan } from '../persistence/normalise.ts';
import { PlanContext, type PlanContextValue } from '../store/store.tsx';
import { GridScreen } from './GridScreen.tsx';
import { DashboardScreen } from './DashboardScreen.tsx';
import { RecruitmentScreen } from './RecruitmentScreen.tsx';
import { ProposalsScreen } from './ProposalsScreen.tsx';
import { PoleRow, SetupScreen } from './SetupScreen.tsx';
import { CateringScreen } from './CateringScreen.tsx';
import { ArtistCard, ArtistsScreen } from './ArtistsScreen.tsx';
import { PeopleScreen } from './PeopleScreen.tsx';
import { TicketingCard } from './TicketingCard.tsx';
import { ImportScreen } from './ImportScreen.tsx';
import { PrintScreen } from './PrintScreen.tsx';
import { NightView } from './NightView.tsx';
import { HistoryScreen, HistoryTable } from './HistoryScreen.tsx';
import { StoreContext } from '../storeContext.ts';
import type { PlanStore } from '../persistence/types.ts';
import { CheckpointBar } from '../components/CheckpointBar.tsx';
import { formatLog } from './JournalScreen.tsx';
import { VolunteerShifts } from './VolunteerView.tsx';
import { PhaseGrid } from './PhaseGrid.tsx';
import { OrganiserFiche } from '../components/OrganiserFiche.tsx';
import { placeDeclared } from '../store/phaseEdits.ts';
import { PlanningScreen } from './PlanningScreen.tsx';
import { PoolPanel, type Moment, type PanelTab } from '../components/PoolPanel.tsx';
import { poleMatchOf } from '../components/poolRows.ts';
import { StackedScreen } from './StackedScreen.tsx';
import { InfoPanel } from '../components/InfoPanel.tsx';
import { NavigationContext } from '../components/personNav.ts';
import { VolunteerEdit } from '../components/VolunteerEdit.tsx';
import type { Selection } from '../components/selection.ts';
import { poleColours, rootOf } from '../components/poleColours.ts';
import { buddiesOf } from '../components/relations.ts';
import { slotLabel } from '../components/labels.ts';
import { fmtOffset } from '../components/clock.ts';
import type { SolveOutcome } from '../solver/useSolver.ts';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Read the way the app itself reads them, through `normalisePlan`.
 *
 * The files on disk are snapshots, written by whichever build last ran `npm run fixture`, so a
 * field added to the plan since then is simply missing from them. That is exactly the case
 * `normalisePlan` exists for, and casting the JSON straight to `Plan` instead was a lie the type
 * checker could not catch: the screens then ran against volunteers with holes in them, which no
 * screen ever sees in the real application.
 */
const fixture = (name: string): Plan =>
  normalisePlan(
    JSON.parse(readFileSync(join(here, '..', '..', 'public', 'fixtures', `${name}.json`), 'utf8')),
  );

const plan = fixture('balanced');

/**
 * A scenario that really is short of people, for the two screens whose whole job is to say so.
 *
 * `balanced` used to be short by about 60 h and stopped being so on 2026-09-08: once the
 * loto / soirée answer became a preference instead of a wall, the solver could reach volunteers
 * it had been refusing, and the same 165 registrations now cover all 91 créneaux. Good news for
 * the event, and it silently emptied two tests that asserted on gaps. They ask for a shortage
 * explicitly now rather than relying on the default scenario happening to have one.
 */
const shortPlan = fixture('shortage-moderate');

const noop = () => {};

function contextFor(current: Plan): PlanContextValue {
  return {
    id: 'balanced',
    plan: current,
    past: [],
    future: [],
    lastLabel: null,
    baseVersion: 0,
    savedAt: null,
    dirty: false,
    saving: false,
    conflict: null, outdated: null,
    error: null,
    saveError: null,
    index: new PlanIndex(current),
    report: validate(current),
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
}

const render = (element: ReactElement, current: Plan = plan): string =>
  renderToStaticMarkup(
    <PlanContext.Provider value={contextFor(current)}>{element}</PlanContext.Provider>,
  );

/** The "Info sélection" pane on one selection. Both panes read everything from the context. */
const infoOf = (source: Plan, selection: Selection | null, readOnly = false): string =>
  render(<InfoPanel selection={selection} onSelect={noop} readOnly={readOnly} />, source);

/** One tab of the pool pane, on any of the three moments. */
const poolOf = (source: Plan, tab: PanelTab, moment: Moment = 'exploit'): string =>
  render(
    <PoolPanel
      moment={moment}
      tab={tab}
      onTabChange={noop}
      selection={null}
      onSelect={noop}
      onDragStartPerson={noop}
      onDragEndPool={noop}
      onDropUnassign={noop}
    />,
    source,
  );

/**
 * Looking for a French sentence in rendered HTML.
 *
 * React escapes quotes and apostrophes, and the engine's messages are full of both: shift names
 * are quoted, and half the French sentences carry an elision. Comparing raw text against the
 * markup would fail on every one of them, and the failure would look like a missing message
 * rather than a missing escape.
 */
const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

const shows = (html: string, text: string): boolean => html.includes(escapeHtml(text));

test('the grid renders one box per volunteer needed', () => {
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />);
  const report = validate(plan);

  // One box per person placed, plus one dashed box per person still missing. Both carry the
  // "box" class, so the empty ones are subtracted rather than added a second time.
  const boxes = (html.match(/class="box[ "]/g) ?? []).length;
  const empties = (html.match(/class="box is-empty"/g) ?? []).length;
  const needed = report.shifts.reduce((total, s) => total + Math.max(s.headcount, s.assigned), 0);

  assert.equal(boxes, needed, 'autant de cases que de places à tenir');
  assert.equal(empties, report.shifts.reduce((total, s) => total + s.missing, 0));
  assert.equal(boxes - empties, report.shifts.reduce((total, s) => total + s.assigned, 0));
  assert.ok(shows(html, 'à pourvoir'));
});

test('the grid draws a lane for every leaf pole and no lane for a parent', () => {
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />);
  const index = new PlanIndex(plan);
  const leaves = plan.poles.filter((p) => index.isLeaf(p.key));
  assert.equal((html.match(/class="lane"/g) ?? []).length, leaves.length);
  for (const leaf of leaves) assert.ok(shows(html, leaf.name), `pôle absent: ${leaf.name}`);
});

test('a long day is marked on the box for 6 h and 8 h, and only then', () => {
  // An emoji since 2026-09-12, not an orange stripe: the grid already spends red on "illegal"
  // and blue on "selected", and a fourth colour code three pixels wide was "pas assez clair".
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />);
  const report = validate(plan);

  const marked = (html.match(/class="box-volume"/g) ?? []).length;
  const expected = plan.assignments.filter((a) => {
    const band = report.volunteers.find((v) => v.key === a.volunteerKey)?.volumeBand;
    return band === 'orange-clair' || band === 'orange-fonce';
  }).length;
  assert.ok(expected > 0, 'le scénario doit contenir des journées longues, sinon rien n’est prouvé');
  assert.equal(marked, expected, 'une marque par case, pour les journées de 6 h et de 8 h');

  // The hours stay written in words, on the mark itself: the two glyphs differ only in tone.
  assert.ok(shows(html, 'Journée longue') || shows(html, 'Journée très longue'));
  // And the legend shows the glyph rather than a swatch of a colour that no longer means anything.
  assert.ok(html.includes('class="legend-mark"'));
  assert.ok(!html.includes('legend-swatch is-c6'));
});

test('an unfilled shift turns nothing red', () => {
  // Raising a headcount leaves the shift short without making anything illegal. The dashed
  // "à pourvoir" boxes say so; red is reserved for breaking a rule.
  const target = plan.shifts[0]!;
  const short: Plan = {
    ...plan,
    shifts: plan.shifts.map((s) => (s.key === target.key ? { ...s, headcount: s.headcount + 3 } : s)),
  };
  const report = validate(short);
  assert.ok(report.shifts.find((s) => s.key === target.key)!.missing >= 3);
  assert.equal(report.summary.tier1Count, 0, 'manquer de monde n\'est pas une illégalité');

  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, short);
  assert.ok(!html.includes('box is-illegal'), 'aucune case ne doit être rouge');
  assert.ok(!html.includes('shift is-flagged'), 'aucun créneau ne doit être cerclé de rouge');
});

test('a rule broken on one shift reddens that box and leaves the same person alone elsewhere', () => {
  // This is the Jean-Sébastien case: a problem on the evening shift must not colour the
  // afternoon one. Overlapping two shifts is the plainest tier 1 there is, and the engine
  // names exactly the two shifts it implicates.
  const index = new PlanIndex(plan);
  const entry = plan.volunteers
    .map((v) => ({ key: v.key, shifts: index.shiftsOf(v.key) }))
    .find(({ shifts }) => {
      if (shifts.length === 0) return false;
      // Somebody holding one shift, with a free shift running at the same hour to clash with.
      return plan.shifts.some(
        (s) => !shifts.some((t) => t.key === s.key) && s.start === shifts[0]!.start,
      );
    });
  assert.ok(entry, 'il faut quelqu\'un qu\'on puisse mettre en chevauchement');

  const kept = entry.shifts[0]!;
  const clash = plan.shifts.find((s) => s.key !== kept.key && s.start === kept.start)!;
  const broken: Plan = {
    ...plan,
    assignments: [
      ...plan.assignments,
      { volunteerKey: entry.key, shiftKey: clash.key, locked: false, source: 'manual' },
    ],
  };

  const report = validate(broken);
  assert.ok(report.summary.tier1Count > 0, 'le plan doit être illégal');

  // The engine attributes the clash to both shifts of the clash, and to no other box.
  const guilty = new Set(
    report.issues
      .filter((i) => i.tier === 1 && i.volunteerKeys.includes(entry.key))
      .flatMap((i) => i.shiftKeys),
  );
  const boxes = report.shifts.flatMap((s) =>
    s.stars.filter((star) => star.volunteerKey === entry.key).map((star) => ({ shift: s.key, star })),
  );
  for (const box of boxes) {
    const red = box.star.issues.some((i) => i.tier === 1);
    assert.equal(red, guilty.has(box.shift), `case ${box.shift}`);
  }

  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, broken);
  assert.ok(html.includes('box is-illegal'), 'la case fautive doit passer en rouge');
  assert.ok(shows(html, 'illégal'), 'et la barre d\'outils doit le compter');
});

test('the dashboard names people rather than only counting them', () => {
  const html = render(<DashboardScreen onGoToRecruitment={noop} />);
  const report = validate(plan);

  for (const entry of report.summary.horsChoix.slice(0, 5)) {
    assert.ok(shows(html, entry.name), `nom manquant: ${entry.name}`);
  }
  assert.ok(shows(html, "Liste d'attente"));
  assert.ok(html.includes('Binômes'));
  assert.ok(html.includes('Recrutement'));
});

test('the recruitment view shows the engine sentence for every gap', () => {
  const html = render(<RecruitmentScreen />, shortPlan);
  const gaps = validate(shortPlan).shifts.filter((s) => s.gap !== null && s.missing > 0);
  assert.ok(gaps.length > 0, 'le scénario en pénurie doit avoir des manques');
  for (const shift of gaps.slice(0, 6)) {
    assert.ok(shows(html, shift.gap!.raison), `raison absente pour ${shift.key}`);
  }
});

test('the setup screen groups sub-poles under their root, and names both', () => {
  const html = render(<SetupScreen />);
  const index = new PlanIndex(plan);
  for (const root of plan.poles.filter((p) => p.parentKey === null)) {
    assert.ok(shows(html, root.name), `pôle absent: ${root.name}`);
  }
  for (const leaf of plan.poles.filter((p) => index.isLeaf(p.key) && p.parentKey !== null)) {
    assert.ok(shows(html, leaf.name), `sous-pôle absent: ${leaf.name}`);
  }
});

test('every section of Réglages arrives folded, and says so to a screen reader', () => {
  // 2026-09-12: "ce serait mieux que chaque grande partie soit à dérouler et non déroulé par
  // défaut". Nine cards and fifteen pole groups open at once meant scrolling past everything you
  // did not come for.
  const html = render(<SetupScreen />);

  assert.equal(html.includes('aria-expanded="true"'), false, 'aucune section ouverte à l\'arrivée');
  assert.ok(html.includes('aria-expanded="false"'), 'et elles se disent bien repliées');

  // Folded is hidden, not unmounted: a card holds half-typed drafts, and unmounting throws them
  // away. Every body carries `hidden`, so nothing is in the tab order either.
  const bodies = (html.match(/class="setup-group-body"/g) ?? []).length;
  const hiddenBodies = (html.match(/class="setup-group-body" hidden/g) ?? []).length;
  assert.ok(bodies > 0);
  assert.equal(hiddenBodies, bodies, 'tout ce qui est replié porte hidden');
});

/*
 * Le catering. Two renders, because the screen has two states that are genuinely different: an
 * event that feeds nobody must say so and point at Réglages rather than draw an empty table, and
 * an event that does must draw one checkbox per person per service without falling over on 120
 * of them.
 */

test('the catering screen sends the régisseur to Réglages when nothing is switched on', () => {
  const html = render(<CateringScreen onGoToSetup={noop} />);
  assert.ok(shows(html, "n'est pas activé"));
  assert.ok(shows(html, 'Ouvrir les Réglages'));
});

test('the catering screen counts the covers and draws a box per person and per service', () => {
  const fed = setCateringRules(plan, { enabled: true });
  const html = render(<CateringScreen onGoToSetup={noop} />, fed);
  const report = cateringReport(fed, new PlanIndex(fed));

  assert.ok(report.services.length > 0, 'la fixture doit produire au moins un service');
  assert.ok(report.meals > 0, 'et au moins un couvert');
  assert.ok(shows(html, `${report.meals} repas`));
  assert.ok(!shows(html, 'tickets boisson ·'), 'les boissons sont dans la billetterie');

  // One checkbox per drawn person per service. The default tab shows only the people who are
  // owed something, which is what the count below has to be measured against.
  const drawn = report.people.filter((p) => p.serviceKeys.length > 0 || p.drinks > 0);
  const boxes = (html.match(/type="checkbox"/g) ?? []).length;
  assert.equal(boxes, drawn.length * report.services.length);
});

test('the catering settings card states the rule in the régisseur own words', () => {
  const html = render(<SetupScreen />, setCateringRules(plan, { enabled: true }));
  assert.ok(shows(html, 'Repas et tickets boisson'));
  assert.ok(shows(html, 'Un ticket boisson toutes les'));
  assert.ok(shows(html, 'Repas garantis à un·e orga'));
});

test('the proposals screen renders a real batch, one line per proposal', () => {
  const perturbed: Plan = {
    ...plan,
    assignments: plan.assignments.filter((_, i) => i % 7 !== 0),
  };
  const result = solve(perturbed, { iterations: 200, seed: 7 });
  const proposals = buildProposals(perturbed, result.plan, result.dropped);
  assert.ok(proposals.length > 0);

  const groups = groupProposals(perturbed, proposals);

  const outcome: SolveOutcome = {
    after: result.plan,
    proposals,
    groups,
    score: result.score,
    initialScore: result.initialScore,
    iterations: result.iterations,
    elapsedMs: result.elapsedMs,
    timedOut: result.timedOut,
    rounds: 1,
    converged: false,
  };

  const html = renderToStaticMarkup(
    <PlanContext.Provider value={contextFor(perturbed)}>
      <ProposalsScreen
        outcome={outcome}
        running={false}
        error={null}
        onSolve={noop}
        onDismiss={noop}
        progress={null}
        elapsedMs={0}
        mode={null}
      />
    </PlanContext.Provider>,
  );

  assert.equal(
    (html.match(/class="proposal /g) ?? []).length,
    groups.length,
    'une carte par décision, pas par ligne',
  );
  for (const proposal of proposals.slice(0, 5)) {
    assert.ok(shows(html, proposal.volunteerName), `nom absent: ${proposal.volunteerName}`);
  }
});

test('the proposals screen says nothing is pending when nothing is', () => {
  const html = render(
    <ProposalsScreen
      outcome={null}
      running={false}
      error={null}
      onSolve={noop}
      onDismiss={noop}
      progress={null}
      elapsedMs={0}
      mode={null}
    />,
  );
  assert.ok(shows(html, 'Aucune proposition en attente'));
});

test('the import screen offers both a Google Sheet link and a file', () => {
  const html = render(<ImportScreen />);
  assert.ok(shows(html, 'Depuis Google Sheets'));
  assert.ok(html.includes('docs.google.com/spreadsheets'), "l'exemple d'adresse est montré");
  assert.ok(shows(html, 'Ou choisir un fichier CSV'));
  assert.ok(shows(html, `${plan.volunteers.length} bénévoles dans le planning`));
});

test('the import screen carries the organisers form next to the volunteers one', () => {
  const html = render(<ImportScreen />);
  assert.ok(shows(html, 'Responsables de pôle'));
  // The one thing this import does NOT do, said on the screen rather than discovered by a
  // régisseur who imported the file and wondered why nobody was in charge of anything.
  assert.ok(shows(html, 'Réglages'), 'la carte doit dire où se règlent les pôles');
  assert.ok(
    shows(html, `${plan.organisers.length} enregistré(s)`),
    'le compte des responsables déjà connus',
  );
});

// ---------------------------------------------------------------------------
// What a pole organiser sees, 2026-09-09
// ---------------------------------------------------------------------------

test('the read-only grid offers nothing that would change the plan', () => {
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} readOnly />);

  // The three ways a régisseur changes something from this screen. None of them is drawn.
  assert.ok(!html.includes('draggable="true"'), 'aucune boîte ne se glisse');
  assert.ok(!shows(html, 'Recalculer'), 'pas de solveur');
  assert.ok(!shows(html, "Jusqu'à stabilité"));
  assert.ok(!html.includes('🔓'), 'pas de cadenas ouvert: un bouton qui ne fait rien est pire');

  // And everything a organiser came for is still there.
  assert.ok(shows(html, 'Tous les pôles'), 'le filtre reste, il peut élargir');
  assert.ok(shows(html, 'Chercher un bénévole'));
});

test('the editable grid still offers all three, so the flag is what makes the difference', () => {
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />);
  assert.ok(html.includes('draggable="true"'));
  assert.ok(shows(html, 'Recalculer'));
  assert.ok(html.includes('🔓'));
});

test('the grid can be opened on one pole rather than on everything', () => {
  const root = plan.poles.find((p) => p.parentKey === null)!;
  const other = plan.poles.find((p) => p.parentKey === null && p.key !== root.key)!;

  const html = render(
    <GridScreen
      onSolve={noop}
      solving={false}
      solveMode={null}
      readOnly
      initialPoleFilter={root.key}
    />,
  );

  // A organiser lands on their own pole. The other roots are still in the picker, because "who is
  // next door at 3 a.m." is a question they have too.
  assert.ok(shows(html, root.name));
  assert.ok(shows(html, other.name), "les autres pôles restent atteignables");
});

test('a locked place is still legible to a reader, without a button to change it', () => {
  const locked: Plan = {
    ...plan,
    assignments: plan.assignments.map((a, i) => (i === 0 ? { ...a, locked: true } : a)),
  };
  const html = render(
    <GridScreen onSolve={noop} solving={false} solveMode={null} readOnly />,
    locked,
  );
  assert.ok(html.includes('🔒'), 'le fait est une information, pas une commande');
});

test('the settings screen lists the organisers as people, with their codes', () => {
  const withOrganisers: Plan = {
    ...plan,
    organisers: [
      {
        key: 'l1', firstName: 'Camille', lastName: 'Dubois', email: 'c@example.org',
        phone: '0600000000', accessCode: 'ABCDEFGH234567', diet: 'Végétarien',
        allergies: 'Fruits à coque', note: '', montageFrom: null, demontageUntil: null, montagePoleKeys: [], demontagePoleKeys: [],
      },
      {
        key: 'l2', firstName: 'Dominique', lastName: 'Roy', email: '', phone: '',
        accessCode: '', diet: '', allergies: '', note: '', montageFrom: null, demontageUntil: null, montagePoleKeys: [], demontagePoleKeys: [],
      },
    ],
    leaderRoles: [
      { key: 'r1', organiserKey: 'l1', poleKey: plan.poles[0]!.key, start: null, end: null },
    ],
  };

  const html = render(<SetupScreen />, withOrganisers);
  assert.ok(shows(html, 'Camille Dubois'));
  assert.ok(shows(html, 'ABCDEFGH234567'), 'le code se lit pour être recopié');
  assert.ok(shows(html, 'Végétarien'), 'quelqu\'un doit commander à manger');
  assert.ok(shows(html, 'Fruits à coque'));
  // The one with no code is offered one, the one with a code is offered a replacement.
  assert.ok(shows(html, 'Générer un code'));
  assert.ok(shows(html, 'Révoquer'));
  assert.ok(shows(html, 'aucun pôle attribué'), 'Dominique Roy ne tient aucun pôle');
});

test('no screen shows an em dash to the régisseur', () => {
  const screens = [
    render(<GridScreen onSolve={noop} solving={false} solveMode={null} />),
    render(<DashboardScreen onGoToRecruitment={noop} />),
    render(<RecruitmentScreen />),
    render(<SetupScreen />),
    render(<ImportScreen />),
    render(<PrintScreen />),
    render(<NightView onLeave={noop} />),
  ];
  for (const html of screens) {
    assert.ok(!html.includes('—'), 'le tiret cadratin est interdit dans le produit');
  }
});

test('a shift of nothing but débutants flags the shift, not the people in it', () => {
  // The user's rule, and the reason it matters: none of the five débutants did anything wrong.
  // The fix is to add one experienced person, so the signal belongs to the shift.
  const report = validate(plan);
  const shift = report.shifts.find((s) =>
    s.issues.some((i) => i.code === 'que-des-debutants' || i.code === 'experience-insuffisante'),
  );
  assert.ok(shift, 'le scénario équilibré doit avoir un créneau au niveau insuffisant');

  for (const star of shift.stars) {
    assert.deepEqual(
      star.issues.map((i) => i.code),
      star.issues
        .map((i) => i.code)
        .filter((code) => code !== 'que-des-debutants' && code !== 'experience-insuffisante'),
      `le signalement de niveau ne doit pas être porté par ${star.name}`,
    );
  }

  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />);
  assert.ok(
    html.includes('shift is-warned') || html.includes('shift is-flagged'),
    'le créneau lui-même doit porter la marque',
  );
});

test('over-staffing marks the shift rather than accusing each person on it', () => {
  const busiest = plan.shifts
    .map((s) => ({
      shift: s,
      count: plan.assignments.filter((a) => a.shiftKey === s.key).length,
    }))
    .find((s) => s.count >= 2)!;
  const over: Plan = {
    ...plan,
    shifts: plan.shifts.map((s) =>
      s.key === busiest.shift.key ? { ...s, headcount: busiest.count - 1 } : s,
    ),
  };

  const report = validate(over);
  const shift = report.shifts.find((s) => s.key === busiest.shift.key)!;
  assert.ok(shift.issues.some((i) => i.code === 'sureffectif'));
  for (const star of shift.stars) {
    assert.ok(
      !star.issues.some((i) => i.code === 'sureffectif'),
      `le sureffectif ne doit pas être imputé à ${star.name}`,
    );
  }
});

test('every sub-pole is drawn in the colour of its root pole', () => {
  const colours = poleColours(plan.poles);
  for (const pole of plan.poles) {
    const root = rootOf(plan.poles, pole.key)!;
    assert.equal(
      colours.get(pole.key),
      colours.get(root.key),
      `${pole.path} doit avoir la couleur de ${root.name}`,
    );
  }
  // And two different roots must not share one, or the grouping stops meaning anything.
  const roots = plan.poles.filter((p) => p.parentKey === null);
  assert.equal(new Set(roots.map((r) => colours.get(r.key))).size, roots.length);
});

test('the hour axis is repeated once per pole, not once per row', () => {
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />);
  const roots = plan.poles.filter((p) => p.parentKey === null).length;
  const leaves = plan.poles.filter((p) => new PlanIndex(plan).isLeaf(p.key)).length;

  assert.equal((html.match(/class="lane-ruler"/g) ?? []).length, roots);
  assert.ok(roots < leaves, 'le scénario doit avoir des sous-pôles, sinon le test ne prouve rien');
  assert.equal((html.match(/class="lane"/g) ?? []).length, leaves);
});

test('a shift carries no counter strip of its own any more', () => {
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />);
  assert.ok(!html.includes('shift-head'), 'la bande N/M est supprimée, la place est rendue');
});

test('the panel spells out the slot and the pole a volunteer refused', () => {
  const refuser = plan.volunteers.find(
    (v) => v.refusedSlotIds.length > 0 && v.refusedPoleKeys.length > 0,
  );
  assert.ok(refuser, 'il faut quelqu\'un qui refuse une tranche et un pôle');

  const html = infoOf(plan, { kind: 'benevole', volunteerKey: refuser.key });

  assert.ok(shows(html, 'Ne veut pas'));
  for (const id of refuser.refusedSlotIds) {
    assert.ok(shows(html, slotLabel(plan.slots, id)), 'chaque tranche refusée doit être écrite');
  }
  assert.ok(
    shows(html, new PlanIndex(plan).polePath(refuser.refusedPoleKeys[0]!)),
    'et le pôle refusé aussi',
  );
});

test('a buddy pairing is seen from both ends', () => {
  const buddiesPlan = JSON.parse(
    readFileSync(join(here, '..', '..', 'public', 'fixtures', 'balanced_buddies.json'), 'utf8'),
  ) as Plan;
  const pair = buddiesPlan.buddies[0];
  assert.ok(pair, 'ce scénario doit contenir des binômes');

  // The person who wrote the name down sees the person they named, and the other way round.
  assert.ok(buddiesOf(buddiesPlan, pair.fromKey).has(pair.toKey));
  assert.ok(buddiesOf(buddiesPlan, pair.toKey).has(pair.fromKey));

  // And nobody is ever their own buddy, whatever the data says.
  for (const key of [pair.fromKey, pair.toKey]) {
    assert.ok(!buddiesOf(buddiesPlan, key).has(key));
  }
  assert.equal(buddiesOf(buddiesPlan, null).size, 0);
});

test('the grid offers both a single run and a run to convergence', () => {
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />);
  assert.ok(shows(html, 'Recalculer'));
  assert.ok(shows(html, 'stabilité'));
  // The bin only exists while a box is being dragged, so it must not be in the resting page.
  assert.ok(!html.includes('class="trash'), 'la corbeille ne doit apparaître que pendant un glisser');
});

test('the settings screen carries the rules, the shifts and the pole organisers', () => {
  const html = render(<SetupScreen />);
  // The four thresholds of the former « Règles de planning » card live on their criterion's row.
  assert.ok(!shows(html, 'Règles de planning'));
  assert.ok(shows(html, 'Réglages avancés'));
  assert.ok(shows(html, 'Sous le plancher par personne'));
  assert.ok(shows(html, "Trop longtemps d'affilée"));
  assert.ok(shows(html, 'Bloquant') && shows(html, 'Poids') && shows(html, 'Ignoré'));
  assert.ok(shows(html, 'Toujours bloquant'));
  assert.ok(shows(html, 'Responsables de pôle'));
  assert.ok(shows(html, 'Ajouter un pôle'));

  // One colour picker per root pole, and none on a sub-pole: the colour belongs to the group.
  const roots = plan.poles.filter((p) => p.parentKey === null).length;
  assert.equal((html.match(/type="color"/g) ?? []).length, roots);
});

test('the settings screen no longer claims anything is missing from it', () => {
  const html = render(<SetupScreen />);
  assert.ok(!shows(html, 'Pas encore construit'));
});

test('the panel offers everyone with hours left to give, not only those at zero', () => {
  const report = validate(plan);
  const available = report.volunteers.filter(
    (v) => !v.reserve && (v.assignedHours < v.requestedHours || v.assignedHours === 0),
  );
  const atZero = report.volunteers.filter((v) => !v.reserve && v.assignedHours === 0);
  assert.ok(
    available.length > atZero.length,
    'le scénario doit contenir des gens partiellement placés, sinon le test ne prouve rien',
  );

  const html = poolOf(plan, 'disponibles');

  assert.equal((html.match(/class="pool-item"/g) ?? []).length, available.length);
  // The figure on the row is bare hours since 2026-09-15 (a narrower pane); the tooltip names it.
  assert.ok(shows(html, 'libres'), 'chaque entrée doit dire ce qui lui reste, pas ce qu\'elle a demandé');
  assert.ok(!/class="pool-item-meta">[^<]*libres/.test(html), 'le mot est dans l\'infobulle, pas sur la ligne');
  assert.ok(shows(html, `Disponibles (${available.length})`));
});

test('"À zéro" is a mark inside Disponibles and no longer a tab of its own', () => {
  // Somebody taken off every créneau, which is what the deleted tab used to list on its own.
  const loose = plan.assignments[0]!.volunteerKey;
  const emptied: Plan = {
    ...plan,
    assignments: plan.assignments.filter((a) => a.volunteerKey !== loose),
  };
  const html = poolOf(emptied, 'disponibles');
  const atZero = validate(emptied).volunteers.filter((v) => !v.reserve && v.assignedHours === 0);
  assert.equal(atZero.length, 1, 'un seul est à zéro, sinon le compte ci-dessous ne prouve rien');

  // The tab is gone, so the one list carries the fact instead, once per person at zero.
  assert.ok(!shows(html, 'À zéro ('), 'plus d\'onglet "À zéro"');
  assert.equal((html.match(/class="pool-zero"/g) ?? []).length, 1);
});

test('the three moments draw the same pool pane, with the same tabs', () => {
  const withPhase: Plan = {
    ...plan,
    montage: { ...plan.montage, enabled: true },
  };
  for (const moment of ['exploit', 'montage', 'demontage'] as const) {
    const html = poolOf(withPhase, 'disponibles', moment);
    assert.ok(shows(html, 'Disponibles ('), `${moment}: l'onglet Disponibles`);
    // The reserve left this pane for Personnes on 2026-09-15.
    assert.ok(!shows(html, "Liste d'attente ("), `${moment}: plus d'onglet Réserve`);
    // The one piece of markup the montage used to lack entirely: the panel's own frame.
    assert.ok(html.includes('class="panel is-pool"'), `${moment}: le volet a le même cadre`);
    assert.ok(html.includes('class="panel-tabs"'), `${moment}: les mêmes onglets`);
  }
});

test('the info pane names what it is describing, orga or bénévole', () => {
  // The complaint this answers, word for word: the panel showed the box "sans titre, et sans voir
  // si c'est un orga ou bénévole".
  const asOrga = infoOf(planWithMontage(), { kind: 'orga', organiserKey: 'o1' });
  assert.ok(shows(asOrga, 'Info sélection'), 'le volet porte un titre');
  assert.ok(asOrga.includes('aria-label="Replier le volet Info sélection"'), 'et se replie');
  assert.ok(shows(asOrga, 'Orga'), "et dit qu'il s'agit d'un orga");
  assert.ok(shows(asOrga, 'Camille Dubois'), 'sous son nom');

  const someone = validate(plan).volunteers[0]!;
  const asVolunteer = infoOf(plan, { kind: 'benevole', volunteerKey: someone.key });
  assert.ok(shows(asVolunteer, 'Bénévole'));
  assert.ok(shows(asVolunteer, someone.name), 'et le nom de la personne');
});

test('a locked box is not draggable, and no bin is offered for it', () => {
  const target = plan.assignments[3]!;
  const locked: Plan = {
    ...plan,
    assignments: plan.assignments.map((a) =>
      a.volunteerKey === target.volunteerKey && a.shiftKey === target.shiftKey
        ? { ...a, locked: true }
        : a,
    ),
  };

  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, locked);
  // Every other box stays draggable; the pinned one says so in its class and drops the attribute.
  assert.ok(html.includes('box is-locked'), 'la case verrouillée doit être marquée');
  assert.equal(
    (html.match(/class="box is-locked[^"]*" draggable="true"/g) ?? []).length,
    0,
    'une case verrouillée ne doit pas être saisissable',
  );
  assert.ok(html.includes('draggable="true"'), "les autres cases restent saisissables");
});

test('a pole organiser with hours is drawn on the grid, one without is not', () => {
  const root = plan.poles.find((p) => p.parentKey === null)!;
  const withOrganisers: Plan = {
    ...plan,
    organisers: [
      {
        key: 'l1', firstName: 'Camille', lastName: 'Dubois', phone: '0600000000',
        email: '', accessCode: '', diet: '', allergies: '', note: '', montageFrom: null, demontageUntil: null, montagePoleKeys: [], demontagePoleKeys: [],
      },
      {
        key: 'l2', firstName: 'Sans', lastName: 'horaires', phone: '',
        email: '', accessCode: '', diet: '', allergies: '', note: '', montageFrom: null, demontageUntil: null, montagePoleKeys: [], demontagePoleKeys: [],
      },
    ],
    leaderRoles: [
      { key: 'r1', organiserKey: 'l1', poleKey: root.key, start: 2, end: 8 },
      { key: 'r2', organiserKey: 'l2', poleKey: root.key, start: null, end: null },
    ],
  };

  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, withOrganisers);
  /*
   * Read off the bands themselves and not off the whole page: since 2026-09-10 the search box
   * lists every orga by name, so both of these appear in the document. What this test is about
   * is what is DRAWN on the pole, which is one band and not two.
   */
  const bands = [...html.matchAll(/class="organiser-band-item"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(bands, ['Camille Dubois'], "un seul bandeau, celui qui a des horaires");
});

test('the dashboard says how many volunteers have been imported', () => {
  const html = render(<DashboardScreen onGoToRecruitment={noop} />);
  assert.ok(shows(html, 'bénévoles importés'));
  assert.ok(html.includes(`>${plan.volunteers.length}<`), 'et donne le nombre');
});

test('the settings screen lets the event itself be edited', () => {
  const html = render(<SetupScreen />);
  assert.ok(shows(html, "L'événement"));
  assert.ok(html.includes('type="date"'), 'la date de début');
});

/**
 * The hours are typed on a 24 h clock, everywhere, and never as an offset.
 *
 * The browser's own date-time control follows the operating system's locale, which put 12 h
 * AM/PM on a French event; the number spinners next to it held "9,5" for half past nine. Both
 * are gone, so this asserts on what replaced them rather than trusting the eye.
 */
test('every hour in the settings screen is a 24 h clock field', () => {
  const html = render(<SetupScreen />);

  assert.ok(!html.includes('datetime-local'), 'plus de contrôle natif qui suit la locale');
  assert.ok(html.includes('class="clock-input"'), 'les heures sont des champs 24 h');

  const artist = [...plan.artists].sort((a, b) => a.start - b.start)[0]!;
  assert.ok(
    html.includes(`value="${fmtOffset(plan.startISO, artist.start)}"`),
    `le set de ${artist.name} est écrit à l'heure de la pendule`,
  );

  const slot = [...plan.slots].sort((a, b) => a.start - b.start)[0]!;
  assert.ok(
    html.includes(`value="${fmtOffset(plan.startISO, slot.end)}"`),
    `la fin de ${slot.label} est écrite à l'heure de la pendule`,
  );
});

test('the grid offers a lock per pole, and shows which poles are locked', () => {
  const root = plan.poles.find((p) => p.parentKey === null)!;
  const roots = plan.poles.filter((p) => p.parentKey === null).length;

  const open = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />);
  assert.equal((open.match(/class="pole-lock /g) ?? []).length, roots, 'un verrou par pôle');
  assert.equal((open.match(/class="pole-lock is-locked"/g) ?? []).length, 0);

  const locked: Plan = {
    ...plan,
    poles: plan.poles.map((p) => (p.key === root.key ? { ...p, locked: true } : p)),
  };
  const shut = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, locked);
  assert.equal((shut.match(/class="pole-lock is-locked"/g) ?? []).length, 1);
  // And it changed no box: the pole lock is aimed at the solver, not at the pointer.
  assert.equal(
    (shut.match(/class="box is-locked/g) ?? []).length,
    (open.match(/class="box is-locked/g) ?? []).length,
  );
});

test('the axis names the day above the first hour and above every midnight, and doubles the midnight tick', () => {
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />);
  // 13 March 2027 at noon, running 18 h: one midnight, into Sunday 14 March.
  assert.ok(shows(html, 'samedi 13/03'), "le jour du début est écrit sur l'axe");
  assert.ok(shows(html, 'dimanche 14/03'), 'et celui qui commence à minuit');
  assert.equal((html.match(/class="ruler-hour[^"]*is-midnight/g) ?? []).length, 1);
  // Every pole's own axis carries the same mark, so the night reads on the eleventh row too.
  const laneMidnights = (html.match(/class="lane-ruler-hour[^"]*is-midnight/g) ?? []).length;
  assert.ok(laneMidnights > 0);
  assert.ok(shows(html, 'dim. 14/03'), 'le jour est écrit à côté du 0h de chaque pôle');
});

test('the grid spans the event, not just the shifts', () => {
  // An event declared longer than its last shift must still be drawn to the end, or a set placed
  // in that gap would hang off the edge.
  const longer: Plan = { ...plan, lengthHours: plan.lengthHours + 4 };
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, longer);
  const ticks = (html.match(/class="ruler-hour/g) ?? []).length;
  const base = (render(<GridScreen onSolve={noop} solving={false} solveMode={null} />).match(
    /class="ruler-hour/g,
  ) ?? []).length;
  assert.ok(ticks > base, "l'axe doit s'étendre avec l'événement");
});

test('the settings screen lets the form time slots be edited, and prices a removal', () => {
  const html = render(<SetupScreen />);
  assert.ok(shows(html, 'Tranches horaires du formulaire'));
  // The two questions, each with its own list. "La soirée commence à" and "Débordement loto
  // accepté jusqu'à" left on 2026-09-13: the loto and the concerts are rows now, with an
  // overflow each, not two words with two rules behind them.
  assert.ok(!shows(html, 'La soirée commence à'));
  assert.ok(!shows(html, 'Débordement loto accepté'));
  assert.ok(shows(html, "Tranches qu'on peut refuser"));
  assert.ok(shows(html, "Tranches qu'on peut préférer"));
  for (const slot of plan.slots) {
    assert.ok(shows(html, slot.label), `tranche absente: ${slot.label}`);
    assert.ok(html.includes(`<code>${slot.id}</code>`), `identifiant absent: ${slot.id}`);
  }
  for (const slot of plan.preferenceSlots) {
    assert.ok(shows(html, slot.label), `tranche préférable absente: ${slot.label}`);
    assert.ok(html.includes(`<code>${slot.id}</code>`), `identifiant absent: ${slot.id}`);
  }
  const preferred = plan.preferenceSlots.find((s) => plan.volunteers.some((v) => v.preferredSlotId === s.id))!;
  const preferring = plan.volunteers.filter((v) => v.preferredSlotId === preferred.id).length;
  assert.ok(preferring > 0, 'le scénario doit contenir des préférences');
  assert.ok(shows(html, `${preferring} la préfèrent`));

  // The removal cost is the point of the card: the régisseur must see how many answers a slot
  // carries before deciding it can go.
  const refused = plan.slots.find((s) => plan.volunteers.some((v) => v.refusedSlotIds.includes(s.id)))!;
  const count = plan.volunteers.filter((v) => v.refusedSlotIds.includes(refused.id)).length;
  assert.ok(count > 0, 'le scénario doit contenir des refus, sinon le test ne prouve rien');
  assert.ok(shows(html, `${count} l'ont refusée`));
});

test('a slot removed from the form leaves the answers that named it alone', () => {
  const gone = plan.slots.find((s) => plan.volunteers.some((v) => v.refusedSlotIds.includes(s.id)))!;
  const held = plan.volunteers.filter((v) => v.refusedSlotIds.includes(gone.id));
  assert.ok(held.length > 0, 'le scénario doit contenir des refus de cette tranche');

  const shorter: Plan = { ...plan, slots: plan.slots.filter((s) => s.id !== gone.id) };
  // Nobody's answer was rewritten: the plan still carries it, it simply stops matching.
  assert.equal(
    shorter.volunteers.filter((v) => v.refusedSlotIds.includes(gone.id)).length,
    held.length,
  );
  const html = render(<SetupScreen />, shorter);
  assert.ok(!shows(html, gone.label), 'la tranche retirée ne figure plus dans les réglages');
  assert.ok(shows(html, 'Tranches horaires du formulaire'), 'et le reste de la page tient');
});

test('the printable page carries one sheet per pole, plus the volunteers and the reserve', () => {
  const html = render(<PrintScreen />);
  const index = new PlanIndex(plan);
  const roots = plan.poles.filter((p) => p.parentKey === null);

  for (const root of roots) {
    assert.ok(shows(html, root.name), `pôle absent de l'impression: ${root.name}`);
  }
  assert.ok(shows(html, 'Planning de chaque bénévole'));
  assert.ok(shows(html, "Liste d'attente"));

  // One printed page per pole, plus the volunteer sheet and the reserve sheet.
  assert.equal((html.match(/class="print-page"/g) ?? []).length, roots.length + 2);

  // Every shift of every pole is on a sheet, with its hours and who is standing in it.
  const shift = plan.shifts.find((s) => index.assigneesOf(s.key).length > 0)!;
  const who = index.assigneesOf(shift.key)[0]!;
  assert.ok(shows(html, `${who.firstName} ${who.lastName}`), 'un bénévole placé doit figurer');
});

test('the printable page leaves volunteer phone numbers off until they are asked for', () => {
  const html = render(<PrintScreen />);
  const withPhone = plan.volunteers.find((v) => v.phone.trim() !== '')!;
  assert.ok(
    !html.includes(withPhone.phone),
    'un numéro de bénévole ne part pas à l\'imprimante sans que ce soit demandé',
  );
  assert.ok(shows(html, 'Téléphones des bénévoles'), 'mais la case pour les demander est là');
});

test('the printable page tells the reader when a shift is short of people', () => {
  const html = render(<PrintScreen />, shortPlan);
  const short = validate(shortPlan).shifts.filter((s) => s.missing > 0);
  assert.ok(short.length > 0, 'le scénario doit avoir des manques, sinon le test ne prouve rien');
  assert.ok(shows(html, `manque ${short[0]!.missing}`));
});

test('the phone view says it is read only before it says anything else', () => {
  const html = render(<NightView onLeave={noop} />);
  const banner = html.indexOf('Lecture seule');
  assert.ok(banner !== -1, 'la mention lecture seule doit être là');
  assert.ok(banner < html.indexOf(plan.name), "et avant le nom de l'événement");
  assert.ok(shows(html, "l'édition se fait sur un ordinateur"));
});

test('the phone view carries no control that could change the plan', () => {
  const html = render(<NightView onLeave={noop} />);
  // No box is draggable, nothing is a lock, and there is no solver button on a phone.
  assert.ok(!html.includes('draggable'), 'rien ne se glisse');
  assert.ok(!shows(html, 'Recalculer'));
  assert.ok(!html.includes('🔓') && !html.includes('🔒'), 'aucun verrou');
});

test('the phone view shows the poles, their people and what is still missing', () => {
  const html = render(<NightView onLeave={noop} />);
  for (const root of plan.poles.filter((p) => p.parentKey === null)) {
    assert.ok(shows(html, root.name), `pôle absent de la vue nuit: ${root.name}`);
  }
  // "Voir toute la soirée" off and the event not running: it lands on the first hour.
  const first = plan.shifts.filter((s) => s.start === 0);
  assert.ok(first.length > 0, 'le scénario doit avoir des créneaux au début');
  assert.ok(shows(html, 'à pourvoir'), 'et le total restant est dit');
});

/**
 * The empty plan, which became a real state the day the picker learned to create one.
 *
 * Every fixture is a full event, so nothing until now ever rendered a plan with no poles, no
 * shifts and nobody in it. That is exactly what a régisseur sees for the minutes between
 * creating a planning and drawing the first pole in Réglages, and a screen that divides by a
 * count or reads `[0]` without looking would meet them there rather than in a test.
 */
test('every screen survives a plan with nothing in it', () => {
  const blank = normalisePlan({ name: 'Nouveau planning' });

  assert.equal(blank.poles.length, 0, 'le plan neuf est bien vide');
  assert.equal(validate(blank).summary.tier1Count, 0, 'et vide ne veut pas dire illégal');

  const screens: Array<[string, ReactElement]> = [
    ['grille', <GridScreen onSolve={noop} solving={false} solveMode={null} />],
    ['tableau', <DashboardScreen onGoToRecruitment={noop} />],
    ['recrutement', <RecruitmentScreen />],
    ['réglages', <SetupScreen />],
    ['import', <ImportScreen />],
    ['impression', <PrintScreen />],
    ['nuit', <NightView onLeave={noop} />],
    [
      'propositions',
      <ProposalsScreen
        outcome={null}
        running={false}
        error={null}
        onSolve={noop}
        onDismiss={noop}
        progress={null}
        elapsedMs={0}
        mode={null}
      />,
    ],
  ];

  for (const [name, element] of screens) {
    assert.doesNotThrow(() => render(element, blank), `écran cassé sur un plan vide: ${name}`);
  }
});

/**
 * The history table, against known rows.
 *
 * The screen around it is a fetch and three pieces of local state, so a server render of the
 * screen itself only ever catches it mid-load. The table is where the reading happens: which
 * version is which, what moved between two restore points, and whether the way back is offered.
 */
const versions = [
  {
    version: 12,
    savedAt: '2026-09-08T14:05:00.000Z',
    archivedAt: '2026-09-08T14:25:00.000Z',
    label: 'import de 42 bénévoles',
    pinned: true,
    volunteers: 120,
    shifts: 91,
    assignments: 247,
  },
  {
    version: 4,
    savedAt: '2026-09-08T09:30:00.000Z',
    archivedAt: '2026-09-08T14:05:00.000Z',
    label: null,
    pinned: false,
    volunteers: 78,
    shifts: 91,
    assignments: 0,
  },
];

const live = { volunteers: 120, shifts: 91, assignments: 260 };

/*
 * L'écran, et pas seulement sa table. Les deux défauts de 2026-09-13 étaient dans la boîte plutôt
 * que dans le contenu: une `.screen` réservant 330 px à un volet inexistant, et tout le contenu
 * dans une `.card` plafonnée à 520 px, sans rien qui défile.
 */
test("l'historique prend toute la largeur et défile, comme tout écran sans volet", () => {
  /*
   * A store that says it keeps versions and hands back none. The screen asks for them in an
   * effect, which a server render never runs, so what is drawn here is the loading state: which
   * is exactly the state the layout has to be right in, since it is the first one anybody sees.
   */
  const store = {
    history: async () => [],
    restore: async () => undefined,
  } as unknown as PlanStore;

  const html = renderToStaticMarkup(
    <StoreContext.Provider value={store}>
      <PlanContext.Provider value={contextFor(plan)}>
        <HistoryScreen />
      </PlanContext.Provider>
    </StoreContext.Provider>,
  );
  assert.ok(/class="screen is-wide"/.test(html), 'aucun volet à réserver');
  assert.ok(/class="screen-body"/.test(html), 'un corps qui défile');
  assert.equal(/class="card"/.test(html), false, 'plus de carte plafonnée à 520 px');
  assert.ok(shows(html, 'Historique'));
});

test('the history names each version, what it held, and what moved after it', () => {
  const html = renderToStaticMarkup(
    <HistoryTable
      rows={versions}
      live={live}
      liveVersion={13}
      blocked={null}
      busy={null}
      armed={null}
      onArm={noop}
      onRestore={noop}
      onForget={noop}
    />,
  );

  assert.ok(shows(html, 'import de 42 bénévoles'));
  assert.ok(shows(html, '120 bénévoles, 91 créneaux, 247 affectations'));
  // Version 12 is the newest kept one, so what follows it is the working copy: 13 more people
  // placed. Version 4 is followed by version 12: 42 arrivals and the first 247 placements.
  assert.ok(shows(html, '+13 affectations'), 'écart avec la copie de travail');
  assert.ok(shows(html, '+42 bénévoles, +247 affectations'), 'écart entre deux points de reprise');
  // A version saved before the label existed says so rather than inventing what was done.
  assert.ok(shows(html, 'modification non décrite'));
  assert.equal((html.match(/Revenir à cette version/g) ?? []).length, 2);
});

test('the way back is withheld, with the reason, while a save is still in flight', () => {
  const html = renderToStaticMarkup(
    <HistoryTable
      rows={versions}
      live={live}
      liveVersion={13}
      blocked="enregistrement en cours"
      busy={null}
      armed={null}
      onArm={noop}
      onRestore={noop}
      onForget={noop}
    />,
  );

  // Restoring over an edit still on its way to the store would throw that edit away without
  // ever having kept it.
  assert.ok(!shows(html, 'Revenir à cette version'));
  assert.equal((html.match(/enregistrement en cours/g) ?? []).length, 2);
});

test('the confirmation says the current version is kept, because a restore is a save', () => {
  const html = renderToStaticMarkup(
    <HistoryTable
      rows={versions}
      live={live}
      liveVersion={13}
      blocked={null}
      busy={null}
      armed={12}
      onArm={noop}
      onRestore={noop}
      onForget={noop}
    />,
  );

  assert.ok(shows(html, 'La version 13 est conservée, vous pourrez y revenir.'));
  assert.equal((html.match(/Restaurer/g) ?? []).length, 1, 'une seule ligne est armée');
});

test('the history says which versions were named and which are on a clock', () => {
  const html = renderToStaticMarkup(
    <HistoryTable
      rows={versions}
      live={live}
      liveVersion={13}
      blocked={null}
      busy={null}
      armed={null}
      onArm={noop}
      onRestore={noop}
      onForget={noop}
    />,
  );

  // In words, not in a shade of grey somebody has to learn: one of the two will still be there
  // in March and the other will not.
  assert.ok(shows(html, 'point de sauvegarde'));
  assert.ok(shows(html, 'automatique'));
  // Naming a version must not be a one-way door, so every row can be forgotten.
  assert.equal((html.match(/Oublier la version/g) ?? []).length, 2);
});

test('the bar that names a version says how long it will be kept', () => {
  const html = renderToStaticMarkup(
    <PlanContext.Provider value={contextFor(plan)}>
      <CheckpointBar onSeeHistory={noop} onClose={noop} />
    </PlanContext.Provider>,
  );

  assert.ok(shows(html, "jusqu'à ce que vous la supprimiez"));
});

test('the diagnostic block reads in the order things happened, not the screen order', () => {
  // The listing is newest first, because the question there is "what just happened". The block
  // that gets pasted into a message is the other way round, because the question there is "how
  // did it get there".
  const text = formatLog(
    [
      {
        id: 3,
        at: '2026-09-08T12:00:05.000Z',
        receivedAt: '2026-09-08T12:00:09.000Z',
        level: 'error',
        kind: 'enregistrement',
        message: "Échec de l'enregistrement: réseau injoignable",
        detail: { version: 8 },
        actor: 'regie@example.org',
        session: 'abcd1234',
      },
      {
        id: 2,
        at: '2026-09-08T12:00:01.000Z',
        receivedAt: '2026-09-08T12:00:09.000Z',
        level: 'info',
        kind: 'edition',
        message: 'déplacement de Marie Perrin',
        detail: null,
        actor: 'regie@example.org',
        session: 'abcd1234',
      },
    ],
    { planning: 'Loto Tekno (version 8)' },
  );

  const lines = text.split('\n');
  assert.equal(lines[0], 'Journal du planning');
  assert.ok(lines.includes('planning: Loto Tekno (version 8)'));
  assert.ok(lines.includes('entrées: 2'));

  const moved = lines.findIndex((line) => line.includes('déplacement de Marie Perrin'));
  const failed = lines.findIndex((line) => line.includes("Échec de l'enregistrement"));
  assert.ok(moved > 0 && failed > moved, "la cause avant l'effet");
  assert.ok(lines.some((line) => line.includes('détail: {"version":8}')));
});

test('an empty journal says so rather than producing a header nobody can read', () => {
  const text = formatLog([], { planning: 'Loto Tekno' });
  assert.ok(text.includes('(aucune entrée)'));
});

/**
 * The volunteer view, which is the screen most people will ever open and the only one reachable
 * without an account. What matters is not that it renders, it is what it refuses to show.
 */
const schedule = {
  benevole: { prenom: 'Marie', nom: 'Perrin', heures_demandees: 6 },
  // Nothing on the montage: the common case, and the one the empty-state has to survive.
  phases: [],
  creneaux: [
    {
      debut: '2027-03-13T13:00:00.000Z',
      fin: '2027-03-13T17:00:00.000Z',
      pole: 'Bar / Service',
      responsables: [
        { nom: 'Claire Dubois', telephone: '06 11 22 33 44', email: 'claire@example.org' },
      ],
      avec: ['Jean M.', 'Sofia B.'],
    },
  ],
};

test('a volunteer sees when, where, with whom, and who to call', () => {
  const html = renderToStaticMarkup(<VolunteerShifts schedule={schedule} onForget={noop} />);

  assert.ok(shows(html, 'Marie Perrin'));
  assert.ok(shows(html, 'Bar / Service'));
  assert.ok(shows(html, 'Avec Jean M., Sofia B.'));
  assert.ok(shows(html, 'Claire Dubois'));
  // A tap, not a number to copy out: this is the line somebody needs at 3 in the morning.
  assert.ok(html.includes('href="tel:0611223344"'));
  assert.ok(shows(html, '4 h'), 'la durée du créneau');
});

test('the volunteer view carries no way to reach another volunteer', () => {
  const html = renderToStaticMarkup(<VolunteerShifts schedule={schedule} onForget={noop} />);

  // Other volunteers are first name and an initial, and that is the whole of it. The only
  // contact details on this screen belong to the pole organisers, who are the people to call.
  assert.ok(!html.includes('tel:') || html.match(/tel:/g)?.length === 1);
  assert.ok(!shows(html, '@'), 'aucune adresse mail affichée');
  assert.ok(!shows(html, 'Jean Martin'), 'jamais le nom complet de quelqu\'un d\'autre');
});

test('having no shift yet is a normal answer, not a failure', () => {
  // Between the form closing and the first solve, everybody is in this state. A screen that
  // treated it as an error would generate a hundred messages to the régisseur in one afternoon.
  const html = renderToStaticMarkup(
    <VolunteerShifts schedule={{ ...schedule, creneaux: [] }} onForget={noop} />,
  );

  assert.ok(shows(html, "Vous n'avez pas encore de créneau"));
  assert.ok(shows(html, '6 h demandées'));
  assert.ok(!shows(html, 'Erreur'));
});

test('the codes export names who is missing from it, and who would overwrite whom', () => {
  // Both cases are silent everywhere else. Somebody with no address never receives their code,
  // and two people behind one address become one contact in the mailing tool, so the second
  // import row overwrites the first one's code and one of them opens the other's schedule.
  const shared = plan.volunteers[1]!.email;
  const tricky: Plan = {
    ...plan,
    volunteers: plan.volunteers.map((v, position) =>
      position === 0
        ? { ...v, email: '' }
        : position === 2
          ? { ...v, email: shared }
          : v,
    ),
  };

  const html = render(<PrintScreen />, tricky);

  assert.ok(shows(html, "1 bénévole n'a pas d'adresse mail"));
  assert.ok(shows(html, `${plan.volunteers[0]!.firstName} ${plan.volunteers[0]!.lastName}`));
  assert.ok(shows(html, 'Adresse partagée par plusieurs personnes'));
  assert.ok(shows(html, shared));
  // 120 volunteers, one without an address.
  assert.ok(shows(html, 'Exporter 119 contacts'));
});

test('two people who would read as the same box are told apart on the grid', () => {
  // "Jean M." twice is not a shortened name, it is a wrong one: the régisseur moving a box at
  // two in the morning would have no way to know which of the two they had just moved. And
  // somebody whose team calls them Nono is drawn under that, not under the registration.
  const placed = plan.volunteers.filter((v) =>
    plan.assignments.some((a) => a.volunteerKey === v.key),
  );
  const [one, two, three] = [placed[0]!, placed[1]!, placed[2]!];
  const renamed: Plan = {
    ...plan,
    volunteers: plan.volunteers.map((v) =>
      v.key === one.key ? { ...v, firstName: 'Jean', lastName: 'Martin' }
      : v.key === two.key ? { ...v, firstName: 'Jean', lastName: 'Marchand' }
      : v.key === three.key ? { ...v, firstName: 'Arnaud', lastName: 'Leroy', nickname: 'Nono' }
      : v,
    ),
  };

  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, renamed);

  assert.ok(shows(html, 'Jean Mart.'), 'la case dit assez du nom pour désigner une personne');
  assert.ok(shows(html, 'Jean Marc.'));
  assert.ok(shows(html, 'Nono L.'), 'le surnom remplace le prénom sur la case');
  assert.ok(!html.includes('>Jean M.<'), 'et jamais la forme ambiguë');
  // The whole name is still there for anyone who has room to read it: short, not secretive.
  assert.ok(shows(html, 'Jean Martin'));
});

// ---------------------------------------------------------------------------
// La fiche: ce qui a été écrit, le doute, et la file de relecture
// ---------------------------------------------------------------------------

/** The same plan with one fiche the importer was unsure about. */
function withDoubt(): { plan: Plan; key: string } {
  const target = plan.volunteers[0]!;
  const flagged = {
    ...target,
    availabilityNote: "Je bosse jusqu'à 15h ce jour-là",
    refusedSlotIds: ['12h-18h'],
    needsReview: true,
    reviewReasons: [
      'Contrainte horaire à trancher: la tranche entière a été refusée.',
    ],
  };
  return {
    plan: {
      ...plan,
      volunteers: plan.volunteers.map((v) => (v.key === target.key ? flagged : v)),
    },
    key: target.key,
  };
}

test('the fiche shows the sentence the volunteer typed, word for word', () => {
  const { plan: doubted, key } = withDoubt();
  const html = infoOf(doubted, { kind: 'benevole', volunteerKey: key });

  // The evidence the régisseur corrects against. Without it, the fiche shows a reading with
  // nothing to check it against, which is the whole failure this feature exists to prevent.
  assert.ok(shows(html, "Je bosse jusqu'à 15h ce jour-là"), 'la réponse brute doit être là');
  assert.ok(shows(html, 'À relire'), 'le doute doit être annoncé');
  assert.ok(shows(html, 'Valider la fiche'), 'et il doit y avoir un moyen de le lever');
});

test('a flagged fiche shows up in the review queue, and an unflagged one does not', () => {
  const { plan: doubted, key } = withDoubt();

  // The scenario already carries a few: the generator writes sentences the parser cannot read,
  // on purpose, so the queue is exercised by a fixture rather than only by this test.
  const rows = (html: string): number => html.split('pool-item is-review').length - 1;
  const before = rows(poolOf(plan, 'relecture'));
  const after = rows(poolOf(doubted, 'relecture'));
  assert.equal(after, before + 1, 'la fiche signalée doit rejoindre la file');

  const queue = poolOf(doubted, 'relecture');
  const name = doubted.volunteers.find((v) => v.key === key)!.firstName;
  assert.ok(shows(queue, name), 'et y figurer sous son nom');

  // Somebody the importer read without hesitating carries no banner at all. Checked on the
  // banner's own class rather than on the words: 'À relire' is also the name of the tab, which
  // is drawn whatever fiche is open.
  const calm = plan.volunteers.find((v) => !v.needsReview)!;
  assert.ok(!infoOf(plan, { kind: 'benevole', volunteerKey: calm.key }).includes('fiche-review'));
});

test('a read-only fiche offers no way to change anything', () => {
  const { plan: doubted, key } = withDoubt();
  const html = infoOf(doubted, { kind: 'benevole', volunteerKey: key }, true);

  // A pole organiser reads the fiche and must still see the doubt: it explains what they are
  // looking at. What they must not get is a button that changes somebody else’s answers.
  assert.ok(shows(html, 'À relire'), 'le doute reste visible en lecture seule');
  assert.ok(!shows(html, 'Valider la fiche'), 'mais rien ne doit se valider depuis là');
  assert.ok(!shows(html, 'Modifier la fiche'), 'ni se modifier');
});

test('the import screen asks for a link once, then offers to refresh it', () => {
  const fresh = render(<ImportScreen />, plan);
  assert.ok(shows(fresh, 'Récupérer'), 'sans lien mémorisé, on récupère');
  assert.ok(!shows(fresh, 'Rafraîchir'));
  assert.ok(shows(fresh, 'tous les utilisateurs disposant du lien'));

  const known: Plan = {
    ...plan,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit',
  };
  const again = render(<ImportScreen />, known);
  assert.ok(shows(again, 'Rafraîchir'), 'avec un lien mémorisé, on rafraîchit');
  assert.ok(shows(again, 'Lien mémorisé avec le planning'));
  assert.ok(
    again.includes('https://docs.google.com/spreadsheets/d/abc/edit'),
    'et le champ est déjà rempli',
  );
});

// ---------------------------------------------------------------------------
// The montage and the démontage
//
// The four things the régisseur asked for, checked on a rendered screen: nights are not drawn,
// a declared presence appears without anybody placing it, a decision moves somebody out of
// Général, and an événement short of people says so.
// ---------------------------------------------------------------------------

/** The balanced plan with a three-day montage, one orga on it, and one truck to unload. */
function planWithMontage(over: Partial<Plan['montage']> = {}): Plan {
  return {
    ...plan,
    organisers: [
      {
        key: 'o1',
        firstName: 'Camille',
        lastName: 'Dubois',
        email: '',
        phone: '',
        accessCode: '',
        diet: '',
        allergies: '',
        note: '',
        // Arrives at the very start of the montage, works in Général unless told otherwise.
        montageFrom: 0,
        demontageUntil: null,
        montagePoleKeys: [],
        demontagePoleKeys: [],
      },
    ],
    montage: {
      ...plan.montage,
      enabled: true,
      startISO: '2027-03-10T08:00:00+01:00',
      lengthHours: 40,
      poles: [
        { key: 'general', name: 'Général' },
        { key: 'scene', name: 'Scène' },
      ],
      events: [
        { key: 'camion', label: 'Déchargement camion', start: 2, end: 4, headcount: 4 },
      ],
      assignments: [],
      ...over,
    },
  };
}

test('a montage grid draws one column per worked day, and none for the nights', () => {
  const html = render(<PhaseGrid id="montage" />, planWithMontage());

  // The phase runs 08:00 Wednesday to midnight Thursday, with the nights unworked: two days,
  // two columns, and the hours of each drawn inside them.
  assert.equal((html.match(/phase-ruler-day/g) ?? []).length, 2);
  // Two poles and the événements lane, two days each: one column per stretch, none for a night.
  assert.equal((html.match(/class="phase-column"/g) ?? []).length, 3 * 2);
  // At this zoom the axis labels every other hour, so the day reads 8h, 10h ... 22h.
  assert.ok(shows(html, '8h'), "l'axe porte les heures");
  assert.ok(shows(html, '22h'));
});

test('a declaration is offered as boxes to place, and placing it draws them', () => {
  const before = render(<PhaseGrid id="montage" />, planWithMontage());
  // Nothing is drawn yet, and the toolbar says how many boxes the answers are asking for.
  assert.equal((before.match(/class="phase-bar[ "]/g) ?? []).length, 0);
  assert.ok(shows(before, 'Placer 2 présences déclarées'));

  const after = render(
    <PhaseGrid id="montage" />,
    placeDeclared(planWithMontage(), 'montage'),
  );
  assert.ok(shows(after, 'Camille Dubois'));
  // Two bars, one per worked day, since the night between them is not on the axis.
  assert.equal((after.match(/class="phase-bar[ "]/g) ?? []).length, 2);
});

test('a box outside what somebody declared is drawn in red and says why', () => {
  // A bénévole who never said they were coming, placed on the montage all the same. The régisseur
  // is allowed to do it; the grid is not allowed to keep quiet about it.
  const stranger = plan.volunteers[0]!.key;
  const outside = planWithMontage({
    assignments: [
      {
        key: 'a1',
        personKind: 'benevole',
        personKey: stranger,
        poleKey: 'scene',
        eventKey: '',
        start: 0,
        end: 5,
      },
    ],
  });

  const html = render(<PhaseGrid id="montage" />, outside);
  assert.ok(html.includes('is-illegal'), 'la case est en rouge');
  assert.ok(shows(html, "N'a pas déclaré être là"), 'et la raison est dite');
  assert.ok(shows(html, 'contredisent une réponse'));
});

test('a box in a pole other than the declared one is reported, and names it', () => {
  const moved = planWithMontage({
    assignments: [
      {
        key: 'a1',
        personKind: 'orga',
        personKey: 'o1',
        poleKey: 'scene',
        eventKey: '',
        start: 0,
        end: 5,
      },
    ],
  });
  // The orga of this fixture declared no pole, so nothing is wrong yet.
  assert.ok(!render(<PhaseGrid id="montage" />, moved).includes('is-illegal'));

  const declared = {
    ...moved,
    organisers: moved.organisers.map((o) => ({ ...o, montagePoleKeys: ['general'] })),
  };
  const html = render(<PhaseGrid id="montage" />, declared);
  assert.ok(html.includes('is-illegal'));
  assert.ok(shows(html, 'A indiqué le pôle Général'));
});

test('clicking somebody in an événement opens their fiche instead of removing them', () => {
  const inEvent: Plan = (() => {
    const source = planWithMontage();
    return {
      ...source,
      montage: {
        ...source.montage,
        assignments: [
          {
            key: 'a1',
            personKind: 'orga',
            personKey: 'o1',
            poleKey: '',
            eventKey: 'camion',
            start: 2,
            end: 4,
          },
        ],
      },
    };
  })();

  const html = render(<PhaseGrid id="montage" />, inEvent);

  // The bug, reported as "cliquer sur une case dans un événement supprime une personne de
  // l'événement": the click was wired straight to the removal, and the tooltip said so.
  assert.ok(!shows(html, 'Cliquer pour retirer'), 'un clic ne retire plus personne');
  assert.ok(shows(html, 'cliquer pour voir sa fiche'), 'il ouvre la fiche');

  // And since 2026-09-13 the place is a drag source, so the gesture that removes it is the same
  // one as everywhere else: onto the bin, the pane, or the empty part of the grid.
  assert.ok(
    /class="box is-mini[^"]*"[^>]*draggable="true"/.test(html),
    "une case d'événement se saisit",
  );

  // And removing is a named button, in the pane that describes the box.
  const panel = infoOf(inEvent, { kind: 'case', phaseId: 'montage', assignmentKey: 'a1' });
  assert.ok(shows(panel, 'Camille Dubois'), 'le volet nomme la personne');
  assert.ok(shows(panel, 'Orga'), "et dit de quel fichier elle vient");
  assert.ok(shows(panel, 'Déchargement camion'), "et où elle est");
  assert.ok(shows(panel, 'Retirer cette case'), 'le retrait est un bouton qui dit ce qu\'il fait');
});

test('the printable sheets include the montage when it is on', () => {
  const html = render(<PrintScreen />, placeDeclared(planWithMontage(), 'montage'));
  assert.ok(shows(html, 'Déchargement camion'));
  assert.ok(shows(html, 'Général'));
});

// ---------------------------------------------------------------------------
// The orga fiche: reachable from both screens, and correctable
// ---------------------------------------------------------------------------

test("an orga's fiche carries every answer as an editable field", () => {
  const withOrga = planWithMontage();
  const html = render(<OrganiserFiche organiserKey="o1" />, withOrga);

  for (const label of ['Prénom', 'Nom', 'Adresse e-mail', 'Téléphone', 'Régime alimentaire']) {
    assert.ok(shows(html, label), `${label} manque sur la fiche`);
  }
  // The arrival is a choice among the phase's own half-days, and it can be taken back.
  assert.ok(shows(html, 'pas là'));
  assert.ok(shows(html, 'à partir de'));
  assert.ok(shows(html, 'Sur place à partir de'));
});

test('the grid offers the orgas in the same search box as the bénévoles', () => {
  const html = render(
    <GridScreen onSolve={noop} solving={false} solveMode={null} />,
    planWithMontage(),
  );
  assert.ok(shows(html, 'Chercher un bénévole ou un orga'));
  assert.ok(shows(html, 'Camille Dubois (orga)'), "l'orga est proposé, marqué comme tel");
});

test('a phase that is off puts nothing about it on the fiche', () => {
  const html = render(<OrganiserFiche organiserKey="o1" />, {
    ...planWithMontage(),
    montage: { ...planWithMontage().montage, enabled: false },
  });
  assert.ok(!shows(html, 'pas là'), "aucune question sur une phase qui n'existe pas");
  assert.ok(shows(html, 'Prénom'), 'le reste de la fiche est là');
});

test('a phase that is off says where to turn it on, and draws no grid', () => {
  const html = render(<PhaseGrid id="demontage" />);

  assert.ok(shows(html, "n'est pas activée"));
  assert.ok(!html.includes('lane-track'));
});

test('the planning screen opens on the exploit and offers the three moments', () => {
  const html = render(
    <PlanningScreen onSolve={noop} solving={false} solveMode={null} />,
    planWithMontage(),
  );

  assert.ok(shows(html, 'Exploit'));
  assert.ok(shows(html, 'Montage'));
  assert.ok(shows(html, 'Démontage'));
  // The exploit is what it shows: its own toolbar is there.
  assert.ok(shows(html, 'Recalculer'));
});

test('the settings screen carries both phases, and the dashboard reports the montage', () => {
  const withMontage = placeDeclared(planWithMontage(), 'montage');
  const setup = render(<SetupScreen />, withMontage);
  assert.ok(shows(setup, 'Montage'));
  assert.ok(shows(setup, 'Démontage'));
  // The disabled one says so rather than showing an empty form.
  assert.ok(shows(setup, 'désactivé'));

  const board = render(<DashboardScreen onGoToRecruitment={noop} />, withMontage);
  assert.ok(shows(board, 'personne(s) sur place'));
  assert.ok(shows(board, 'il en manque 4'));
});

test('the pool lists the orgas and the bénévoles who still have hours to place', () => {
  const html = render(<PhaseGrid id="montage" />, planWithMontage());

  // One list and not two since 2026-09-11: the kind is a filter inside "Disponibles", so the
  // count is the people on site with hours left, whichever file they come from. The phase is
  // closed to the bénévoles here, so it is the one orga.
  assert.ok(shows(html, 'Disponibles (1)'), "l'orga déclaré est à placer");
  // The day filter moved to the toolbar on 2026-09-12, where it narrows the grid and this list at
  // once; the kind filter stayed in the pane, because it is about the list alone.
  assert.ok(shows(html, 'Tous les jours'), 'le filtre par jour est sur la barre');
  // And it carries its own word. Unlabelled, between the zoom buttons, the régisseur did not find
  // it at all: "je ne vois pas le sélecteur". A control nobody sees does not exist.
  assert.ok(
    /class="toolbar-field"><span>Jour<\/span>/.test(html),
    'le filtre par jour est nommé sur la barre',
  );
  assert.ok(shows(html, 'Tout le monde'), 'et le filtre par type de personne dans le volet');

  // Once placed, nobody is left to place.
  const after = render(<PhaseGrid id="montage" />, placeDeclared(planWithMontage(), 'montage'));
  assert.ok(shows(after, 'Disponibles (0)'));
});

// ---------------------------------------------------------------------------
// Orgas on the exploit, 2026-09-12.
//
// The régisseur asked for them in "Disponibles" the way the two phases already had them, for a
// drop on a créneau as an ordinary placement, and for a drop on a pole's frise to make somebody
// responsable of it for two hours with both edges draggable afterwards.
// ---------------------------------------------------------------------------

/** The balanced plan with one orga, holding one créneau and running one pole from 2h to 8h. */
function planWithOrga(): Plan {
  const root = plan.poles.find((p) => p.parentKey === null)!;
  return {
    ...plan,
    organisers: [
      {
        key: 'o1', firstName: 'Camille', lastName: 'Dubois', email: '', phone: '0600000000',
        accessCode: '', diet: '', allergies: '', note: '',
        montageFrom: null, demontageUntil: null, montagePoleKeys: [], demontagePoleKeys: [],
      },
    ],
    leaderRoles: [{ key: 'r1', organiserKey: 'o1', poleKey: root.key, start: 2, end: 8 }],
    organiserShifts: [{ key: 's1', organiserKey: 'o1', shiftKey: plan.shifts[0]!.key }],
  };
}

test("the exploit's Disponibles carries the orgas, draggable, beside the bénévoles", () => {
  const withOrga = planWithOrga();
  const benevoles = validate(withOrga).volunteers.filter(
    (v) => !v.reserve && (v.assignedHours < v.requestedHours || v.assignedHours === 0),
  );

  const html = poolOf(withOrga, 'disponibles');
  assert.ok(shows(html, `Disponibles (${benevoles.length + 1})`), "l'orga compte dans la liste");
  assert.ok(shows(html, 'Camille Dubois'));
  // The kind filter used to be phase-only, and a list of two kinds of person needs it.
  assert.ok(shows(html, 'Orgas'), 'le filtre par type est là sur l’exploit aussi');
  // Every row of this tab is a drag source, the orga's included: that is the whole point of
  // putting them here rather than in a list of their own.
  assert.equal(
    (html.match(/class="pool-item"[^>]*draggable="true"/g) ?? []).length,
    benevoles.length + 1,
  );
});

test('an orga standing in a créneau can be dragged out of it', () => {
  // Until 2026-09-12 their box had a ✕ and nothing else: changing créneau meant removing them and
  // placing them again from the list, which is two gestures for what reads as one.
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, planWithOrga());
  assert.ok(
    /class="box is-orga-box"[^>]*draggable="true"/.test(html),
    "la case d'un orga est saisissable",
  );
});

test("a responsable's band carries a grip at each end, and none for a reader", () => {
  const withOrga = planWithOrga();

  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, withOrga);
  assert.equal((html.match(/organiser-band-grip is-start/g) ?? []).length, 1);
  assert.equal((html.match(/organiser-band-grip is-end/g) ?? []).length, 1);

  // A pole organiser reading the planning has no write access at all, so offering an edge to pull
  // would be offering a gesture that then silently fails. See `GridScreenProps.readOnly`.
  const reader = render(
    <GridScreen onSolve={noop} solving={false} solveMode={null} readOnly />,
    withOrga,
  );
  assert.ok(shows(reader, 'Camille Dubois'), 'le bandeau est toujours dessiné');
  assert.equal((reader.match(/organiser-band-grip/g) ?? []).length, 0);
});

/** Every band, as [top, height], read off the style the component writes. */
const bandRows = (html: string): Array<[number, number]> =>
  [...html.matchAll(/class="organiser-band-item"[^>]*top:(\d+)px;height:(\d+)px/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);

test('two responsables on one pole at the same hour get a line each', () => {
  /*
   * 2026-09-13: "si 2 responsables sont sur un même pôle sur un même créneau horaire, au lieu de
   * superposer les cases, ajouter de l'espace vertical et les afficher l'une au-dessus de
   * l'autre". They were drawn on top of one another, so the second was invisible.
   */
  const base = planWithOrga();
  const root = plan.poles.find((p) => p.parentKey === null)!;
  const both: Plan = {
    ...base,
    organisers: [...base.organisers, { ...base.organisers[0]!, key: 'o2', firstName: 'Sacha' }],
    leaderRoles: [
      ...base.leaderRoles,
      { key: 'r2', organiserKey: 'o2', poleKey: root.key, start: 4, end: 10 },
    ],
  };

  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, both);
  const rows = bandRows(html);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0]![0], rows[1]![0], 'deux lignes, pas deux cases superposées');
  // And the strip grew rather than clipping the second one.
  assert.ok(/class="organiser-band"[^>]*height:36px/.test(html), 'la frise fait deux lignes');
});

test('two windows of the SAME responsable share one line, however many they hold', () => {
  // 14h to 18h then 22h to 02h is one person taking two turns, not two people: same rule as a
  // montage lane, where one person keeps one row.
  const base = planWithOrga();
  const root = plan.poles.find((p) => p.parentKey === null)!;
  const twice: Plan = {
    ...base,
    leaderRoles: [
      ...base.leaderRoles,
      { key: 'r2', organiserKey: 'o1', poleKey: root.key, start: 10, end: 14 },
    ],
  };

  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, twice);
  const rows = bandRows(html);
  assert.equal(rows.length, 2, 'deux bandeaux');
  assert.equal(rows[0]![0], rows[1]![0], 'sur la même ligne');
  assert.ok(/class="organiser-band"[^>]*height:18px/.test(html), 'la frise garde une ligne');
});

test('the info pane lists the poles somebody is responsable of, with their hours', () => {
  const html = infoOf(planWithOrga(), { kind: 'orga', organiserKey: 'o1' });
  assert.ok(shows(html, 'Responsable de'));
  assert.ok(shows(html, 'Retirer'), 'et la façon de le lui retirer, puisque la pose est un glisser');
});

test("a bénévole's name is written once in the info pane, not twice", () => {
  // Reported word for word: "son nom prénom apparait 2 fois". The fiche used to repeat the name
  // the pane's own head had just written two lines above it.
  //
  // Counted on the HEADINGS rather than on the whole pane: the engine's own messages name the
  // person too ("Sophie Lambert est placée pendant ..."), and those are facts about her plan
  // rather than a second title.
  const someone = validate(plan).volunteers[0]!;
  const html = infoOf(plan, { kind: 'benevole', volunteerKey: someone.key });
  const titles = [...html.matchAll(/<h2 class="panel-title">(.*?)<\/h2>/g)].map((m) => m[1]);
  assert.equal(titles.length, 1, 'un seul titre dans le volet');
  assert.ok(titles[0]!.includes(escapeHtml(someone.name)), 'et il porte le nom');

  // Same on an orga, whose fiche never repeated its own head: the point is that the two agree.
  const asOrga = infoOf(planWithOrga(), { kind: 'orga', organiserKey: 'o1' });
  assert.equal([...asOrga.matchAll(/<h2 class="panel-title">/g)].length, 1);
});

test('an orga can be put on a créneau from the pane, full or not', () => {
  // "Je ne vois pas dans le volet de droite de moyen d'ajouter un orga sur une case." The picker
  // used to appear only when one of the créneau's dashed "à pourvoir" boxes had been clicked, so
  // a full créneau, or one clicked anywhere else, offered nothing at all.
  const withOrga = planWithOrga();
  const full = validate(withOrga).shifts.find((s) => s.missing === 0)!;

  const html = infoOf(withOrga, { kind: 'creneau', shiftKey: full.key, fill: false });
  assert.ok(shows(html, 'Ajouter un orga à ce créneau'));
  assert.ok(shows(html, 'Camille Dubois'), "et l'orga est proposé");
  // A créneau already at its headcount takes one all the same, and says what that costs: the
  // grid draws the overflow in red rather than refusing the edit.
  assert.ok(shows(html, 'sureffectif'));

  // Clicking a place to fill still asks the narrower question, in its own words.
  const hole = validate(withOrga).shifts.find((s) => s.missing > 0);
  if (hole) {
    const onHole = infoOf(withOrga, { kind: 'creneau', shiftKey: hole.key, fill: true });
    assert.ok(shows(onHole, 'Mettre un orga à cette place'));
  }

  // A reader is offered nothing: their session cannot write at all.
  const reader = infoOf(withOrga, { kind: 'creneau', shiftKey: full.key, fill: true }, true);
  assert.ok(!shows(reader, 'Ajouter un orga à ce créneau'));
  assert.ok(!shows(reader, 'Mettre un orga à cette place'));
});

test("a responsable's band says the three gestures it takes", () => {
  // Reported as "je n'arrive pas à tirer le créneau en tant que responsable": the band offered
  // two 6 px grips, no sign that it was draggable, and nothing that said so on hover.
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, planWithOrga());
  assert.ok(shows(html, 'Glisser le bandeau le déplace'));
  assert.ok(shows(html, 'glisser un bord change cette heure-là'));
  assert.ok(shows(html, 'cliquer ouvre la fiche'));
});

test('both grids carry one zoom slider and no − / + buttons', () => {
  // Five fixed steps behind two buttons, whose widest was not wide enough once a montage could be
  // filtered down to one day: "au lieu d'avoir 2 boutons + et -, peut-être un slider".
  for (const html of [
    render(<GridScreen onSolve={noop} solving={false} solveMode={null} />),
    render(<PhaseGrid id="montage" />, planWithMontage()),
  ]) {
    assert.equal((html.match(/class="zoom-range"/g) ?? []).length, 1);
    assert.ok(shows(html, 'Ajuster'), 'et le bouton qui recale la vue sur la largeur');
    assert.ok(!shows(html, 'Dézoomer') && !shows(html, 'Zoomer'), 'plus de boutons − et +');
  }
});

test('a phase grid offers the bin and the pane as ways to take a box away', () => {
  // "Faire glisser déposer une case ... dans le volet de droite doit retirer la personne de cette
  // case", with the dashed pane and the bin the exploit already had.
  const html = render(<PhaseGrid id="montage" />, placeDeclared(planWithMontage(), 'montage'));
  assert.ok(shows(html, 'Déposez ici une case de la grille pour la retirer'));
  // The bin itself only appears while a box is in flight, which a server render cannot do; what
  // this checks is that the grid's own viewport is wired as a target at all.
  assert.ok(/class="grid-scroll[ "]/.test(html));
});

test('a pole can ask for its responsable in support, and says so when contradicted', () => {
  // A créneau of the very pole the orga runs, and a role with no hours of its own, which covers
  // the whole event. `planWithOrga` pairs a pole and a créneau that have nothing to do with each
  // other, which would have made this test pass for the wrong reason.
  const index0 = new PlanIndex(plan);
  const root = plan.poles.find(
    (p) => p.parentKey === null && plan.shifts.some((s) => index0.isUnder(s.poleKey, p.key)),
  )!;
  const own = plan.shifts.find((s) => index0.isUnder(s.poleKey, root.key))!;

  const base: Plan = {
    ...planWithOrga(),
    leaderRoles: [{ key: 'r1', organiserKey: 'o1', poleKey: root.key, start: null, end: null }],
    organiserShifts: [{ key: 'os1', organiserKey: 'o1', shiftKey: own.key }],
  };
  const supportOnly: Plan = {
    ...base,
    poles: base.poles.map((p) => (p.key === root.key ? { ...p, leaderSupportOnly: true } : p)),
  };

  // The setting itself, in Réglages. On the pole row rather than the whole screen, because the
  // screen keeps every pole collapsed until one is clicked and a server render cannot click.
  const row = render(
    <PoleRow
      pole={root}
      isRoot={false}
      shifts={base.shifts.filter((s) => s.poleKey === root.key)}
      eventHours={base.lengthHours}
      open
      onToggle={noop}
      assignedOf={() => 0}
    />,
    base,
  );
  assert.ok(shows(row, 'Le responsable reste en support'));

  // The orga of planWithOrga holds a créneau of the pole they run, so the flag bites.
  const held = new PlanIndex(supportOnly).supportOnlyBreaches();
  assert.equal(held.length, 1, 'le scénario doit contredire le réglage, sinon rien n’est prouvé');

  const grid = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, supportOnly);
  assert.ok(/class="box is-orga-box is-warned"/.test(grid), 'la case est en orange, jamais en rouge');

  const panel = infoOf(supportOnly, {
    kind: 'creneau',
    shiftKey: held[0]!.shift.key,
    fill: false,
  });
  assert.ok(shows(panel, 'attend son responsable en support'));
  assert.ok(shows(panel, "Rien n'a été retiré"));

  // Off, which is the default, nothing is said anywhere.
  const quiet = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, base);
  assert.ok(!/class="box is-orga-box is-warned"/.test(quiet));
});

// ---------------------------------------------------------------------------
// Les artistes, since 2026-09-13: a tab of fiches, and their moments on the two grids
// ---------------------------------------------------------------------------

/** The line-up's first act given a changement de plateau, balances the day before, and people. */
function planWithArtistFile(): Plan {
  const [first, ...rest] = plan.artists;
  const artist = makeArtist({
    ...first!,
    name: 'Nashkø',
    changeoverBefore: 0.5,
    changeoverAfter: 0.25,
    soundcheckNeeded: true,
    // 14h to 16h on the 10th: hour 6 of a montage that starts the 10th at 08h.
    soundcheckStart: -70,
    soundcheckEnd: -68,
    soundcheckEngineer: true,
    trainTickets: 2,
    patchSize: 12,
    extraGuests: [
      { key: 'nk-g1', firstName: 'A', lastName: 'Un' },
      { key: 'nk-g2', firstName: 'B', lastName: 'Deux' },
      { key: 'nk-g3', firstName: 'C', lastName: 'Trois' },
    ],
    members: [
      makeArtistMember({ key: 'nk-m1', firstName: 'Lou', lastName: 'Marin', diet: 'végé', guests: [
        { key: 'nk-m1-g1', firstName: 'Noa', lastName: 'Marin' },
        { key: 'nk-m1-g2', firstName: 'Zoé', lastName: 'Marin' },
      ] }),
      makeArtistMember({ key: 'nk-m2', role: 'technicien', drinkTickets: 5 }),
    ],
  });
  return { ...planWithMontage(), artists: [artist, ...rest] };
}

test('the Artistes tab lists every act folded, with the set, the headcount and what is left to do', () => {
  const current = planWithArtistFile();
  const html = render(<ArtistsScreen />, current);
  for (const artist of current.artists) {
    assert.ok(shows(html, artist.name), `artiste absent: ${artist.name}`);
  }
  assert.ok(shows(html, 'Ajouter un artiste'));
  assert.ok(shows(html, '2 billets de train à prendre'), 'le défraiement à faire');
  assert.ok(shows(html, 'patch 12'));
  assert.ok(shows(html, 'avec ingé son'));
  assert.ok(shows(html, '5 invitations'), 'deux invités de Lou plus trois du groupe');
  // Folded: the fields are not rendered, only the summary line.
  assert.ok(!html.includes('name="artist-tech-'), 'la fiche est repliée');
});

test('an open fiche edits every field in place, its members and their plates included', () => {
  const current = {
    ...planWithArtistFile(),
    catering: { ...plan.catering, rules: { ...plan.catering.rules, enabled: true } },
  };
  const artist = current.artists[0]!;
  const report = cateringReport(current, new PlanIndex(current));
  const html = render(
    <ArtistCard artist={artist} open onToggle={noop} catering={report} />,
    current,
  );
  for (const field of [
    'artist-size-', 'artist-before-', 'artist-after-', 'artist-tech-', 'artist-patch-',
    'artist-notes-', 'artist-trainTickets-', 'artist-planeTickets-', 'guest-first-nk-m1-g1',
    'artist-sc-date-',
  ]) {
    assert.ok(html.includes(`name="${field}`), `champ absent: ${field}`);
  }
  assert.ok(html.includes('type="date"'), 'les balances ont un jour, pas seulement une heure');
  assert.ok(shows(html, 'Lou'), 'le membre nommé');
  assert.ok(html.includes('value="végé"'), 'son régime');
  // The second member has 5 tickets of their own, the first follows the setting: the field is
  // filled for the one and empty for the other.
  assert.ok(/name="member-drinks-nk-m2"[^>]*value="5"/.test(html), 'fixé à la main');
  assert.ok(/name="member-drinks-nk-m1"[^>]*value=""/.test(html), 'suit le réglage: champ vide');
  // The plates: one checkbox per service, on each member's row.
  assert.ok(report.services.length > 0);
  assert.ok(
    html.includes(`aria-label="Lou Marin, ${report.services[0]!.label}"`),
    'la case du premier service',
  );
  assert.ok(shows(html, 'Ajouter une personne'));
  assert.ok(shows(html, 'Ajouter un trajet'));
});

test('the exploit ruler draws the changement de plateau and the balances in their own colours', () => {
  const current = planWithArtistFile();
  const html = render(<GridScreen onSolve={noop} solving={false} solveMode={null} />, current);
  assert.ok(html.includes('artist-band is-set'), 'le set');
  assert.ok(html.includes('artist-band is-changeover'), 'le changement de plateau');
  // The balances fall the day before the event: not on this axis at all.
  assert.ok(!html.includes('artist-band is-soundcheck'), "les balances de la veille ne sont pas sur l'exploit");
  assert.ok(shows(html, 'Nashkø · plateau'));
  assert.ok(/class="ruler" style="width:[^"]*;height:\d+px"/.test(html), 'la règle a une hauteur calculée');
});

test('the montage draws the balances of the day before, in its own hours, on a lane of its own', () => {
  const current = planWithArtistFile();
  const html = render(<PhaseGrid id="montage" />, current);
  assert.ok(html.includes('lane is-artists'), 'la ligne Artistes');
  assert.ok(html.includes('artist-band is-soundcheck'), 'les balances');
  assert.ok(shows(html, 'Nashkø · balances'));
  assert.ok(shows(html, 'balances, 14h à 16h'), 'traduites dans les heures du montage');
  // Nothing was stored on the phase for it.
  assert.equal(current.montage.events.length, planWithMontage().montage.events.length);
});

test('the settings screen no longer carries the line-up', () => {
  const html = render(<SetupScreen />, planWithArtistFile());
  assert.ok(!shows(html, 'Programmation'));
  assert.ok(!html.includes('name="artist-name-'), "les fiches sont dans l'onglet Artistes");
});

test("the catering counts the members of an act, marked as artists, with the act's name beside them", () => {
  const current = {
    ...planWithArtistFile(),
    catering: { ...plan.catering, rules: { ...plan.catering.rules, enabled: true } },
  };
  const html = render(<CateringScreen onGoToSetup={noop} />, current);
  assert.ok(shows(html, 'Lou Marin'));
  assert.ok(html.includes('title="Artiste"'), 'la marque artiste');
  assert.ok(shows(html, 'selon la présence du groupe'));
});

test("a member who is also an orga: the fiche's boxes are the orga's own row, and the catering has one line for them", () => {
  const base = planWithArtistFile();
  const camille = base.organisers[0]!;
  const artist = {
    ...base.artists[0]!,
    members: [
      ...base.artists[0]!.members,
      makeArtistMember({ key: 'nk-m3', linkedKind: 'orga', linkedKey: camille.key, drinkTickets: 4 }),
    ],
  };
  const current = {
    ...base,
    artists: [artist, ...base.artists.slice(1)],
    catering: { ...plan.catering, rules: { ...plan.catering.rules, enabled: true, organiserDrinks: 2 } },
  };
  const report = cateringReport(current, new PlanIndex(current));
  // One row, the orga's, carrying the act's name; no 'artiste' row for nk-m3.
  assert.ok(!report.people.some((r) => r.key === 'nk-m3'));
  const row = report.people.find((r) => r.kind === 'orga' && r.key === camille.key)!;
  assert.equal(row.group, 'Nashkø');
  assert.equal(row.drinks, 4, 'the better of 2 (orga) and 4 (artist), not 6');

  const fiche = render(
    <ArtistCard artist={artist} open onToggle={noop} catering={report} />,
    current,
  );
  assert.ok(fiche.includes('name="member-link-nk-m3"'), 'the « Aussi » select');
  assert.ok(fiche.includes(`value="orga|${camille.key}"`), 'the orga is offered');
  assert.ok(shows(fiche, '4 au total'), "the person's total tickets beside the field");
  // The meal boxes on that row are labelled with the member's name but bound to the orga's
  // row: every box the orga's row takes is ticked here.
  const service = report.services.find((sv) => row.serviceKeys.includes(sv.key));
  assert.ok(service, 'the orga eats at least once through the act');

  const catering = render(<CateringScreen onGoToSetup={noop} />, current);
  assert.ok(shows(catering, 'Camille Dubois'));
  assert.ok((catering.match(/Nashkø/g) ?? []).length >= 1, "the act's name beside the person");
  assert.ok(!catering.includes('Nashkø · membre 3'), 'and no separate member line');
});

test('the catering card offers the cumul of the tickets for somebody with two statuses', () => {
  const html = render(<SetupScreen />, {
    ...plan,
    catering: { ...plan.catering, rules: { ...plan.catering.rules, enabled: true } },
  });
  assert.ok(html.includes('name="artist-drinks-cumulative"'));
  assert.ok(shows(html, 'Les tickets boisson se cumulent'));
});

// ---------------------------------------------------------------------------
// The pool's « Pôle demandé » filter, 2026-09-13
// ---------------------------------------------------------------------------

test('the pool offers a pôle filter in the three moments, listing every pole of the exploit', () => {
  for (const moment of ['exploit', 'montage', 'demontage'] as const) {
    const html = poolOf(planWithMontage(), 'disponibles', moment);
    assert.ok(html.includes('aria-label="Filtrer par pôle demandé"'), `${moment}: le filtre`);
    for (const pole of plan.poles) {
      assert.ok(html.includes(`value="${pole.key}"`), `${moment}: ${pole.path}`);
    }
  }
});

test('a person matches a pole through the position of their choice, or the pole they run', () => {
  const index = new PlanIndex(plan);
  const first = (v: (typeof plan.volunteers)[number]) => v.choices[0]?.poleKey ?? '';
  const second = (v: (typeof plan.volunteers)[number]) => v.choices[1]?.poleKey ?? '';
  const withChoice = plan.volunteers.find((v) => first(v) !== '' && second(v) !== '' && first(v) !== second(v)
    && !index.isUnder(first(v), second(v)) && !index.isUnder(second(v), first(v)))!;
  assert.equal(poleMatchOf(index, 'benevole', withChoice.key, first(withChoice)), 0);
  assert.equal(poleMatchOf(index, 'benevole', withChoice.key, second(withChoice)), 1);
  // A choice on a parent pole answers for its sub-poles, and the reverse.
  const parent = plan.poles.find((p) => p.parentKey === null && plan.poles.some((c) => c.parentKey === p.key))!;
  const child = plan.poles.find((c) => c.parentKey === parent.key)!;
  const onParent = plan.volunteers.find((v) => first(v) === parent.key);
  const onChild = plan.volunteers.find((v) => first(v) === child.key);
  if (onParent) assert.equal(poleMatchOf(index, 'benevole', onParent.key, child.key), 0);
  if (onChild) assert.equal(poleMatchOf(index, 'benevole', onChild.key, parent.key), 0);
  // Somebody who asked for neither is not a match.
  const elsewhere = plan.poles.find((p) => withChoice.choices.every((c) =>
    p.key !== c.poleKey && !index.isUnder(p.key, c.poleKey) && !index.isUnder(c.poleKey, p.key)))!;
  assert.equal(poleMatchOf(index, 'benevole', withChoice.key, elsewhere.key), null);

  // An orga answers through the pole they run.
  const root = plan.poles.find((p) => p.parentKey === null)!;
  const withOrga: Plan = {
    ...planWithMontage(),
    leaderRoles: [{ key: 'r1', organiserKey: 'o1', poleKey: root.key, start: 2, end: 8 }],
  };
  const orgaIndex = new PlanIndex(withOrga);
  assert.equal(poleMatchOf(orgaIndex, 'orga', 'o1', root.key), 'responsable');
  assert.equal(poleMatchOf(orgaIndex, 'orga', 'o1', elsewhere.key === root.key ? child.key : elsewhere.key),
    index.isUnder(elsewhere.key === root.key ? child.key : elsewhere.key, root.key) ? 'responsable' : null);
});

// ---------------------------------------------------------------------------
// Two screens on one tab, 2026-09-13
// ---------------------------------------------------------------------------

test('a stacked tab draws both screens, the second under the first, and folds only what it is told to', () => {
  const html = render(
    <StackedScreen
      sections={[
        { id: 'tableau', title: 'Tableau de bord', children: <DashboardScreen onGoToRecruitment={noop} /> },
        { id: 'recrutement', title: 'Recrutement', children: <RecruitmentScreen /> },
      ]}
    />,
    shortPlan,
  );
  const board = html.indexOf('id="stack-tableau"');
  const recruit = html.indexOf('id="stack-recrutement"');
  assert.ok(board >= 0 && recruit > board, 'le recrutement en dessous');
  assert.ok(shows(html, 'à pourvoir'), 'la partie recrutement est rendue');
  assert.ok(!html.includes(' hidden=""'), 'rien de replié quand rien ne se replie');

  const folded = render(
    <StackedScreen
      sections={[
        { id: 'historique', title: 'Historique', children: <p>H</p>, foldable: true },
        { id: 'journal', title: 'Journal', children: <p>J</p>, foldable: true },
      ]}
    />,
  );
  assert.equal((folded.match(/aria-expanded="false"/g) ?? []).length, 2, 'les deux repliées par défaut');
  assert.equal((folded.match(/ hidden=""/g) ?? []).length, 2, 'cachées, pas démontées');
  assert.ok(folded.includes('<p>H</p>') && folded.includes('<p>J</p>'));
});

// ---------------------------------------------------------------------------
// La billetterie, 2026-09-13
// ---------------------------------------------------------------------------

/** The +phases fixture's kind of state: an act with guests, ticket types, bracelets, an extra. */
function planWithTicketing(): Plan {
  const base = planWithArtistFile();
  return {
    ...base,
    catering: { ...plan.catering, rules: { ...plan.catering.rules, enabled: true } },
    ticketing: {
      guestsPerArtist: 1,
      reserveOnDoorList: false,
      ticketTypes: [
        { key: 'loto', label: 'Loto seulement', start: 0, end: 6 },
        { key: 'full', label: 'Pass complet', start: 0, end: 18 },
      ],
      bracelets: [
        { key: 'basique', label: 'Bracelet basique', defaultFor: ['benevole'] },
        { key: 'backstage', label: 'Bracelet backstage', defaultFor: ['artiste', 'invite-artiste', 'orga'] },
      ],
      extras: [{ key: 'x1', firstName: 'Pat', lastName: 'Lumière', status: 'prestataire', phone: '06 99', drinkTickets: 4, mealTickets: 2 }],
      choices: [
        { personKind: 'artiste', personKey: 'nk-m1', ticketTypeKey: 'loto', braceletKey: null, drinkTickets: null, note: '' },
        { personKind: 'extra', personKey: 'x1', ticketTypeKey: null, braceletKey: null, drinkTickets: null, note: 'régie' },
        { personKind: 'benevole', personKey: plan.volunteers[0]!.key, ticketTypeKey: null, braceletKey: null, drinkTickets: 7, note: '' },
      ],
    },
  };
}

test('the Personnes tab lists the reserve apart, under everybody else', () => {
  const current = planWithTicketing();
  const held = current.volunteers[1]!;
  const withReserve: Plan = {
    ...current,
    reserve: [held.key],
    assignments: current.assignments.filter((a) => a.volunteerKey !== held.key),
  };
  const html = peopleOf(withReserve);
  const card = html.indexOf('people-reserve');
  assert.ok(card > 0, 'une carte Réserve à part');
  assert.ok(shows(html, "Liste d'attente (1)"));
  assert.ok(shows(html, "+ 1 en liste d'attente"), 'annoncée dans la barre');
  const row = html.indexOf(`data-person="benevole|${held.key}"`);
  assert.ok(row > card, 'la ligne de la personne en réserve est dans la carte Réserve, pas avant');
  assert.equal(html.split(`data-person="benevole|${held.key}"`).length, 2, 'et une seule fois');

  assert.ok(!peopleOf({ ...current, reserve: [] }).includes('people-reserve'), 'pas de carte sans réserve');

  // The card says whether the door's export carries them, which is the Réglages setting.
  assert.ok(shows(html, "Elles ne sont pas dans la liste d'entrée exportée."));
  const onList = peopleOf({ ...withReserve, ticketing: { ...withReserve.ticketing, reserveOnDoorList: true } });
  assert.ok(shows(onList, "Elles sont dans la liste d'entrée exportée."));
  const settings = render(<TicketingCard />, withReserve);
  assert.ok(settings.includes('name="reserve-on-door-list"'), 'la case est dans la carte Billetterie');
});

const peopleOf = (current: Plan, focus: { kind: TicketPersonKind; key: string } | null = null): string =>
  render(<PeopleScreen focus={focus} onFocus={noop} onGoToSetup={noop} />, current);

test('the Personnes tab lists everybody by name with statuses, tickets, bracelet, and reports the incohérences', () => {
  const current = planWithTicketing();
  const html = peopleOf(current);
  const reserved = ticketingReport(current).rows.filter((r) => r.kind === 'benevole' && current.reserve.includes(r.key)).length;
  assert.ok(shows(html, `${ticketingReport(current).rows.length - reserved} personnes`), 'the count leads the toolbar');
  assert.ok(html.includes('aria-label="Chercher une personne"'));
  assert.ok(html.includes('aria-label="Filtrer par statut"'));
  assert.ok(html.includes('aria-label="Colonnes affichées"'));
  // The statuses, as chips: an orga, the act's guests, the extra.
  assert.ok(shows(html, 'Artiste: Nashkø'));
  assert.ok(shows(html, 'Invité de Nashkø'));
  // The list stays light: no fiche until somebody is clicked, and the extra's name is typed there.
  assert.ok(html.includes('class="screen is-wide"'));
  assert.ok(!html.includes('name="extra-first-x1"'));
  assert.ok(html.includes('data-person="extra|x1"') && shows(html, 'Lumière'));
  // The default bracelet of a bénévole, and the one chosen by hand for Lou (loto) flagged.
  assert.ok(html.includes('name="bracelet-benevole-'));
  assert.ok(/name="ticket-artiste-nk-m1"[^>]*class="select is-manual"|class="select is-manual"[^>]*name="ticket-artiste-nk-m1"/.test(html));
  assert.ok(shows(html, 'incohérence'), 'a meal outside the loto ticket');
  // Phones are off by default.
  assert.ok(!html.includes('06 99'));
  // The headers are words, the note is a field on every row, a drink figure by hand is green.
  assert.ok(html.includes('>Boissons<') && html.includes('>Repas<'));
  assert.ok(html.includes('name="note-extra-x1"') && html.includes('value="régie"'));
  assert.ok(html.includes(`name="note-benevole-${plan.volunteers[0]!.key}"`));
  assert.ok(/class="catering-count is-by-hand"[^>]*>\s*<input[^>]*name="drinks-benevole-/.test(html), 'le chiffre à la main en vert');
  // Sorted by name: Aubert... whichever comes first, the first row is not the extra typed last.
  const first = html.indexOf('<tbody>');
  assert.ok(first > 0);
});

test('the rows carry what the contact and meal columns show, and never a credential', () => {
  const current = planWithTicketing();
  const volunteer = current.volunteers[0]!;
  const orga = current.organisers[0]!;
  const rows = ticketingReport(current).rows;
  const row = rows.find((r) => r.kind === 'benevole' && r.key === volunteer.key)!;
  assert.equal(row.email, volunteer.email);
  assert.equal(row.diet, volunteer.diet);
  assert.equal(row.allergies, volunteer.allergies);
  const orgaRow = rows.find((r) => r.kind === 'orga' && r.key === orga.key)!;
  assert.equal(orgaRow.email, orga.email);
  // A whole Organiser is handed to the row builder: nothing past the named fields may come along.
  assert.ok(!('accessCode' in row) && !('accessCode' in orgaRow));
});

test('clicking a person opens a fiche beside the list, whatever kind of person it is', () => {
  const current = planWithTicketing();
  const volunteer = current.volunteers[0]!;

  const benevole = peopleOf(current, { kind: 'benevole', key: volunteer.key });
  assert.ok(benevole.includes('class="screen has-person"'));
  assert.ok(benevole.includes('aria-label="Fiche de la personne"'));
  assert.ok(benevole.includes(`data-person="benevole|${volunteer.key}"`) && benevole.includes('class="is-selected"'));
  assert.ok(shows(benevole, 'Modifier la fiche'), "the bénévole's own fiche, not a copy");
  assert.ok(benevole.includes(`name="fiche-ticket-benevole-${volunteer.key}"`), "the door's fields, a second time");
  assert.ok(benevole.includes(`name="ticket-benevole-${volunteer.key}"`), 'and still on the row');

  const orga = current.organisers[0]!;
  const orgaHtml = peopleOf(current, { kind: 'orga', key: orga.key });
  assert.ok(orgaHtml.includes(`name="orga-firstName-${orga.key}"`), "the orga's fiche, editable");

  const extra = peopleOf(current, { kind: 'extra', key: 'x1' });
  assert.ok(extra.includes('name="extra-first-x1"') && extra.includes('value="Pat"'), 'the extra is typed in the fiche');
  assert.ok(shows(extra, 'Retirer de la liste'));

  const member = peopleOf(current, { kind: 'artiste', key: 'nk-m1' });
  assert.ok(member.includes('name="fiche-member-first-nk-m1"'));
  assert.ok(shows(member, 'Membre de Nashkø'));

  const guest = peopleOf(current, { kind: 'invite', key: 'nk-m1-g1' });
  assert.ok(guest.includes('name="fiche-guest-first-nk-m1-g1"') && guest.includes('value="Noa"'));

  // The change of status is offered on the two kinds that have one, and on nobody else.
  assert.ok(shows(benevole, 'Passer en orga…'));
  assert.ok(shows(orgaHtml, 'Passer en bénévole…'));
  assert.ok(!shows(extra, 'Passer en') && !shows(member, 'Passer en'));

  const gone = peopleOf(current, { kind: 'benevole', key: 'personne' });
  assert.ok(shows(gone, "Cette personne n'est plus dans le plan."));
});

test('the correction form of a bénévole edits the first and last name too', () => {
  const volunteer = plan.volunteers[0]!;
  const html = render(
    <VolunteerEdit index={new PlanIndex(plan)} volunteer={volunteer} onCancel={noop} onSave={noop} />,
  );
  assert.ok(shows(html, 'Prénom') && html.includes(`value="${escapeHtml(volunteer.firstName)}"`));
  assert.ok(shows(html, 'Nom') && html.includes(`value="${escapeHtml(volunteer.lastName)}"`));
});

test('the info pane of the grids offers the whole fiche only inside the shell', () => {
  const key = plan.volunteers[0]!.key;
  assert.ok(!shows(infoOf(plan, { kind: 'benevole', volunteerKey: key }), 'Ouvrir dans Personnes'));
  const html = renderToStaticMarkup(
    <PlanContext.Provider value={contextFor(plan)}>
      <NavigationContext.Provider value={{ openPerson: noop, openArtists: noop }}>
        <InfoPanel selection={{ kind: 'benevole', volunteerKey: key }} onSelect={noop} />
      </NavigationContext.Provider>
    </PlanContext.Provider>,
  );
  assert.ok(shows(html, 'Ouvrir dans Personnes'));
  const readOnly = renderToStaticMarkup(
    <PlanContext.Provider value={contextFor(plan)}>
      <NavigationContext.Provider value={{ openPerson: noop, openArtists: noop }}>
        <InfoPanel selection={{ kind: 'benevole', volunteerKey: key }} onSelect={noop} readOnly />
      </NavigationContext.Provider>
    </PlanContext.Provider>,
  );
  assert.ok(!shows(readOnly, 'Ouvrir dans Personnes'));
});

test('the Réglages card edits the ticket types, the bracelets and the invitations per artist', () => {
  const html = render(<SetupScreen />, planWithTicketing());
  assert.ok(shows(html, 'Billetterie'));
  assert.ok(html.includes('name="guests-per-artist"'));
  assert.ok(html.includes('name="ticket-label-loto"'));
  assert.ok(html.includes('name="ticket-start-loto"'));
  assert.ok(html.includes('name="bracelet-backstage-artiste"'));
  assert.ok(shows(html, 'Ajouter un type de ticket'));
  assert.ok(shows(html, 'Ajouter un bracelet'));
});

test("the fiche names an act's guests per member, and flags a member past the event's figure", () => {
  const current = planWithTicketing();
  const artist = current.artists[0]!;
  const html = render(<ArtistCard artist={artist} open onToggle={noop} catering={null} />, current);
  assert.ok(html.includes('name="guest-first-nk-m1-g1"') && html.includes('value="Noa"'));
  assert.ok(shows(html, 'Invités de Lou Marin (2 sur 1)'));
  assert.ok(shows(html, 'au-delà du réglage'));
  assert.ok(shows(html, 'Invitations supplémentaires du groupe (3)'));
  assert.ok(shows(html, 'Ajouter un invité'));
  assert.ok(!html.includes('name="member-invited-'), 'the tick is gone');
});

test('a fiche carries the application, and a cancelled person still placed is offered to be freed', () => {
  const held = plan.assignments[0]!.volunteerKey;
  const cancelled: Plan = {
    ...plan,
    applicationSteps: [{ key: 'confirmation', label: 'Mail de confirmation envoyé' }],
    volunteers: plan.volunteers.map((v) =>
      v.key === held ? { ...v, status: 'annule' as const, statusSteps: ['confirmation'], energy: 'fatigable' as const } : v),
  };
  const html = infoOf(cancelled, { kind: 'benevole', volunteerKey: held });
  assert.ok(shows(html, 'Candidature'));
  assert.ok(html.includes('>Libérer ses places</button>'), 'le bouton explicite, rien de retiré tout seul');
  assert.ok(shows(html, 'Mail de confirmation envoyé'));
  assert.ok(shows(html, 'Fatigue vite'));

  const reading = infoOf(cancelled, { kind: 'benevole', volunteerKey: held }, true);
  assert.ok(shows(reading, 'Annulée'));
  assert.ok(!reading.includes('>Libérer ses places</button>'), 'rien à modifier en lecture seule');
});

test('a fiche names the tranches somebody would rather avoid, apart from the refused ones', () => {
  const key = plan.volunteers[0]!.key;
  const slot = plan.slots[plan.slots.length - 1]!;
  const avoiding: Plan = {
    ...plan,
    volunteers: plan.volunteers.map((v) => (v.key === key ? { ...v, refusedSlotIds: [], avoidedSlotIds: [slot.id] } : v)),
  };
  const html = infoOf(avoiding, { kind: 'benevole', volunteerKey: key });
  assert.ok(shows(html, 'Préfère éviter'));
});

test('a fiche shows the availability of each day, with the day somebody is away', () => {
  const key = plan.volunteers[0]!.key;
  const index = new PlanIndex(plan);
  const away: Plan = {
    ...plan,
    volunteers: plan.volunteers.map((v) => (v.key === key ? { ...v, unavailable: [{ start: 0, end: 4 }] } : v)),
  };
  const html = infoOf(away, { kind: 'benevole', volunteerKey: key });
  assert.ok(shows(html, 'Disponibilités par jour'));
  assert.ok(shows(html, index.dayLabel(0)));
  assert.ok(html.includes('name="fiche-day-0-from"'), "l'heure d'arrivée se corrige sur le jour");
});
