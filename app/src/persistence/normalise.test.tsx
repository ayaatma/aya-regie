/**
 * The blank settings page, and the two things that had to change so it cannot come back.
 *
 * A régisseur opened Réglages and got nothing at all: no screen, and no navigation either.
 * The cause was a plan sitting in localStorage from before `Plan.organisers` existed, so
 * `plan.organisers.length` threw and React unmounted the whole tree.
 *
 * Two defects, tested separately. Old stored data must be made safe on the way in, and a screen
 * that throws anyway must not take the tool down with it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { DEFAULT_RULES, PlanIndex, validate, type Plan } from '../engine.ts';
import { PlanContext, type PlanContextValue } from '../store/store.tsx';
import { SetupScreen } from '../screens/SetupScreen.tsx';
import { ScreenBoundary, ScreenError } from '../components/ScreenBoundary.tsx';
import { normalisePlan } from './normalise.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fresh = JSON.parse(
  readFileSync(join(here, '..', '..', 'public', 'fixtures', 'balanced.json'), 'utf8'),
) as Plan;

const noop = () => {};

/** A plan as it would sit in storage, written before a field existed. */
function withoutField(field: keyof Plan): Plan {
  const stale = { ...fresh } as Record<string, unknown>;
  delete stale[field];
  return stale as unknown as Plan;
}

function contextFor(plan: Plan): PlanContextValue {
  return {
    id: 'balanced', plan, past: [], future: [], lastLabel: null, baseVersion: 1,
    savedAt: null, dirty: false, saving: false, conflict: null, outdated: null, error: null, saveError: null,
    index: new PlanIndex(plan), report: validate(plan), canUndo: false, canRedo: false,
    apply: noop, edit: noop, undo: noop, redo: noop, open: noop, reset: noop,
    retrySave: noop, close: noop,
    acceptTheirs: noop, keepMine: noop, restore: async () => {},
    checkpoint: async () => 1, historyChanged: noop, historyRevision: 0,
  };
}

const renderSetup = (plan: Plan): string =>
  renderToStaticMarkup(
    <PlanContext.Provider value={contextFor(plan)}>
      <SetupScreen />
    </PlanContext.Provider>,
  );

test('a plan saved before `organisers` existed would crash the settings screen unnormalised', () => {
  // The exact bug, kept as a test so the fix below is measured against something real.
  assert.throws(() => renderSetup(withoutField('organisers')));
});

test('normalising it makes the settings screen render', () => {
  const html = renderSetup(normalisePlan(withoutField('organisers')));
  assert.ok(html.includes('Responsables de pôle'));
});

test('normalising fills in every missing array, whichever one it is', () => {
  for (const field of ['organisers', 'buddies', 'reserve', 'assignments', 'artists', 'poles', 'shifts', 'volunteers'] as const) {
    const normalised = normalisePlan(withoutField(field));
    assert.ok(Array.isArray(normalised[field]), `${field} doit être un tableau`);
  }
});

test('normalising keeps everything a good plan already had', () => {
  const normalised = normalisePlan(fresh);
  assert.equal(normalised.name, fresh.name);
  assert.equal(normalised.startISO, fresh.startISO);
  assert.equal(normalised.poles.length, fresh.poles.length);
  assert.equal(normalised.assignments.length, fresh.assignments.length);
  assert.deepEqual(normalised.rules, fresh.rules);
});

test('a plan missing a scheduling rule picks up the default for that one only', () => {
  const stale = {
    ...fresh,
    rules: { maxConsecutiveHours: 3, maxBlocks: 2, minHoursPerPerson: 4 },
  } as unknown as Plan;

  const normalised = normalisePlan(stale);
  assert.equal(normalised.rules.maxConsecutiveHours, 3, 'ce que le plan disait est conservé');
  assert.equal(
    normalised.rules.minBreakHours,
    DEFAULT_RULES.minBreakHours,
    'et la règle absente prend sa valeur par défaut',
  );
});

test('the two rules the preference tranches replaced become those tranches, figures kept', () => {
  // A plan saved before 2026-09-13 carried the boundary and the overflow as rules, and the
  // volunteers' answers as two words. Both are carried onto the preference tranches, so what
  // the régisseur had tuned in Réglages survives the change of shape.
  const { preferenceSlots: _dropped, ...withoutSlots } = fresh;
  const old = {
    ...withoutSlots,
    rules: { ...fresh.rules, eveningStartsAt: 7, afternoonOverflowUntil: 10 },
    volunteers: fresh.volunteers.map((v, i) => ({
      ...v,
      preferredSlotId: undefined,
      halfPreference: (['afternoon', 'evening', 'any'] as const)[i % 3],
    })),
  } as unknown as Plan;

  const normalised = normalisePlan(old);
  assert.deepEqual(
    normalised.preferenceSlots.map((s) => [s.id, s.start, s.end, s.overflowHours]),
    [['loto', 0, 7, 3], ['concerts', 7, fresh.lengthHours, 0]],
  );
  assert.deepEqual(
    normalised.volunteers.slice(0, 3).map((v) => v.preferredSlotId),
    ['loto', 'concerts', null],
  );
  assert.ok(!('eveningStartsAt' in normalised.rules), 'la règle disparue ne suit pas');
});

test('a plan with neither the tranches nor the old rules takes the default tranches', () => {
  const { preferenceSlots: _dropped, ...withoutSlots } = fresh;
  const normalised = normalisePlan(withoutSlots as unknown as Plan);
  assert.deepEqual(normalised.preferenceSlots.map((s) => s.id), ['loto', 'concerts']);
});

test('the phases open aligned on the event: the montage ends where it starts, the démontage starts where it ends', () => {
  const normalised = normalisePlan(fresh);
  const start = new Date(normalised.startISO).getTime();
  const montageEnd = new Date(normalised.montage.startISO).getTime() + normalised.montage.lengthHours * 3600_000;
  assert.equal(montageEnd, start);
  assert.equal(
    new Date(normalised.demontage.startISO).getTime(),
    start + normalised.lengthHours * 3600_000,
  );
  assert.equal(normalised.montage.volunteersUntil, normalised.montage.lengthHours);
  assert.equal(normalised.demontage.volunteersFrom, 0);
});

test('normalising junk gives an empty plan rather than throwing', () => {
  for (const junk of [null, undefined, {}, 'not a plan', 42]) {
    const normalised = normalisePlan(junk);
    assert.equal(normalised.poles.length, 0);
    assert.equal(normalised.volunteers.length, 0);
    assert.ok(normalised.rules.minHoursPerPerson > 0);
  }
});

// ---------------------------------------------------------------------------
// PLAN_FORMAT 1 to 2: pole organisers split into people and roles, 2026-09-09
// ---------------------------------------------------------------------------

/** A organiser exactly as PLAN_FORMAT 1 wrote them: one row per person per pole. */
const legacyOrganiser = (over: Record<string, unknown>) => ({
  key: 'k',
  poleKey: 'bar',
  fullName: 'Camille Dubois',
  phone: '',
  email: '',
  note: '',
  start: null,
  end: null,
  ...over,
});

test('a format 1 organiser becomes one person and one role', () => {
  const plan = normalisePlan({
    ...fresh,
    organisers: [legacyOrganiser({ key: 'bar--camille', phone: '0600000000', start: 2, end: 8 })],
    leaderRoles: undefined,
  });

  assert.equal(plan.organisers.length, 1);
  assert.equal(plan.leaderRoles.length, 1);

  const person = plan.organisers[0]!;
  assert.equal(person.phone, '0600000000');
  assert.equal(
    `${person.firstName} ${person.lastName}`.trim(),
    'Camille Dubois',
    'le nom saisi doit se réafficher exactement',
  );

  const role = plan.leaderRoles[0]!;
  assert.equal(role.organiserKey, person.key);
  assert.equal(role.poleKey, 'bar');
  assert.equal(role.start, 2);
  assert.equal(role.end, 8);
});

test('the same person on two poles becomes one person with two roles', () => {
  // The whole reason for the split. Under format 1 these were two unrelated rows, so the tool
  // could not have given this human one access code or one fiche.
  const plan = normalisePlan({
    ...fresh,
    organisers: [
      legacyOrganiser({ key: 'bar--c', poleKey: 'bar', email: 'c@ayaatma.fr' }),
      legacyOrganiser({ key: 'plonge--c', poleKey: 'plonge', email: 'C@Ayaatma.FR' }),
    ],
    leaderRoles: undefined,
  });

  assert.equal(plan.organisers.length, 1, "l'adresse identifie la personne, à la casse près");
  assert.deepEqual(plan.leaderRoles.map((r) => r.poleKey), ['bar', 'plonge']);
  assert.equal(new Set(plan.leaderRoles.map((r) => r.organiserKey)).size, 1);
});

test('two organisers with no address are told apart by name, and matched by it', () => {
  const plan = normalisePlan({
    ...fresh,
    organisers: [
      legacyOrganiser({ key: 'a', poleKey: 'bar', fullName: 'Camille Dubois' }),
      legacyOrganiser({ key: 'b', poleKey: 'plonge', fullName: 'Camille Dubois' }),
      legacyOrganiser({ key: 'c', poleKey: 'bar', fullName: 'Dominique Roy' }),
    ],
    leaderRoles: undefined,
  });

  assert.equal(plan.organisers.length, 2);
  assert.equal(plan.leaderRoles.length, 3);
});

test('the conversion never invents an access code', () => {
  // A credential appearing on its own, because somebody opened an old plan, would hand out the
  // whole planning to whoever the row happened to name.
  const plan = normalisePlan({ ...fresh, organisers: [legacyOrganiser({})], leaderRoles: undefined });
  assert.equal(plan.organisers[0]!.accessCode, '');
});

test('role keys survive the conversion, so two roles never collide', () => {
  const plan = normalisePlan({
    ...fresh,
    organisers: [
      legacyOrganiser({ key: 'bar--c', poleKey: 'bar' }),
      legacyOrganiser({ key: 'plonge--c', poleKey: 'plonge' }),
    ],
    leaderRoles: undefined,
  });
  assert.deepEqual(plan.leaderRoles.map((r) => r.key), ['bar--c', 'plonge--c']);
});

test('a format 2 plan passes through untouched', () => {
  const plan = normalisePlan({
    ...fresh,
    organisers: [
      {
        key: 'l1', firstName: 'Camille', lastName: 'Dubois', email: '', phone: '',
        accessCode: 'ABCD1234', diet: 'Végétarien', allergies: '', note: '',
      },
    ],
    leaderRoles: [{ key: 'r1', organiserKey: 'l1', poleKey: 'bar', start: 2, end: 8 }],
  });

  assert.equal(plan.organisers[0]!.accessCode, 'ABCD1234');
  assert.equal(plan.organisers[0]!.diet, 'Végétarien');
  assert.equal(plan.leaderRoles[0]!.key, 'r1');
});

test('a plan from before organisers existed at all still normalises', () => {
  const plan = normalisePlan({ ...fresh, organisers: undefined, leaderRoles: undefined });
  assert.deepEqual(plan.organisers, []);
  assert.deepEqual(plan.leaderRoles, []);
});

/*
 * The catering, added on 2026-09-12. The two things this boundary has to get right are the same
 * two as everywhere else here: a plan that predates the field opens with the defaults rather
 * than with undefined, and a plan that carries the field keeps every figure of it.
 */

test('a plan from before the catering existed opens with it switched off', () => {
  const plan = normalisePlan({ ...fresh, catering: undefined });
  assert.equal(plan.catering.rules.enabled, false);
  assert.equal(plan.catering.rules.services.length, 2, 'midi et soir');
  assert.deepEqual(plan.catering.choices, []);
});

test('a catering already configured survives the round trip whole', () => {
  const plan = normalisePlan({
    ...fresh,
    catering: {
      rules: {
        enabled: true,
        services: [{ key: 'brunch', label: 'Brunch', fromHour: 11, toHour: 13 }],
        exploitTiers: [{ fromHours: 5, meals: 3 }],
        drinkPerHours: 1.5,
        drinkCountsPhases: true,
        organiserMeals: 4,
        organiserDrinks: 5,
      },
      choices: [
        { personKind: 'orga', personKey: 'o1', serviceKey: '2027-03-13|brunch', takes: false },
      ],
    },
  });

  assert.equal(plan.catering.rules.enabled, true);
  assert.deepEqual(plan.catering.rules.services, [
    { key: 'brunch', label: 'Brunch', fromHour: 11, toHour: 13 },
  ]);
  assert.deepEqual(plan.catering.rules.exploitTiers, [{ fromHours: 5, meals: 3 }]);
  assert.equal(plan.catering.rules.drinkPerHours, 1.5);
  assert.equal(plan.catering.rules.drinkCountsPhases, true);
  assert.equal(plan.catering.rules.organiserMeals, 4);
  assert.equal(plan.catering.choices.length, 1);
});

test('a service with no key is dropped, because no ticked box could ever name it', () => {
  const plan = normalisePlan({
    ...fresh,
    catering: {
      rules: {
        enabled: true,
        services: [{ label: 'Sans clé', fromHour: 12, toHour: 14 }],
        exploitTiers: [],
        drinkPerHours: 2,
        drinkCountsPhases: false,
        organiserMeals: 2,
        organiserDrinks: 2,
      },
      choices: [{ personKind: 'benevole', personKey: '', serviceKey: 'x', takes: true }],
    },
  });

  // The two defaults come back rather than an empty list: a catering switched on with no service
  // at all would show an empty screen with nothing saying why.
  assert.deepEqual(plan.catering.rules.services.map((s) => s.key), ['midi', 'soir']);
  assert.deepEqual(plan.catering.choices, [], 'une case cochée pour personne ne désigne rien');
});

/*
 * The second defect: React unmounts the whole tree on an uncaught render error, so the crash
 * took the navigation with it and there was no way back to the grid.
 *
 * React does not invoke error boundaries during server rendering, so the class cannot be
 * exercised end to end here. Its two pieces can be, and are: what it derives from an error, and
 * what it then draws. The wiring between them is React's own.
 */

test('the boundary turns any thrown value into a message it can show', () => {
  assert.equal(
    ScreenBoundary.getDerivedStateFromError(new Error('organisers is undefined')).message,
    'organisers is undefined',
  );
  // Code can throw anything at all, and the boundary still has to render something.
  assert.equal(ScreenBoundary.getDerivedStateFromError('bang').message, 'bang');
  assert.equal(ScreenBoundary.getDerivedStateFromError(undefined).message, 'undefined');
});

test('the boundary passes an unbroken screen straight through', () => {
  const html = renderToStaticMarkup(
    <ScreenBoundary resetKey="grille">
      <p>la grille</p>
    </ScreenBoundary>,
  );
  assert.equal(html, '<p>la grille</p>');
});

test('the failure card names the error and says the rest of the tool is fine', () => {
  const html = renderToStaticMarkup(
    <ScreenError message="Cannot read properties of undefined (reading 'length')" onRetry={noop} />,
  );
  assert.ok(html.includes('reading &#x27;length&#x27;'), "le message doit être montré, pas avalé");
  assert.ok(html.includes('onglets en haut sont toujours actifs'));
  assert.ok(html.includes('Réessayer'));
});
