/**
 * The development store's history, against a stub localStorage.
 *
 * The fixture path is kept alive on purpose: it is the only way to work on the grid with no
 * network, and the only reason these tests run at all. That is exactly why its history has to
 * behave like the database's rather than approximately like it. What is checked here is the
 * behaviour the two share and that no parser or type checker can see: a save keeps the version it
 * is about to overwrite, a burst of autosaves does not fill the history with near-identical
 * copies, and a restore lands as a new version instead of rewinding onto the old one.
 *
 *   npm test    (in app/)
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type { Plan } from '../engine.ts';
import { normalisePlan } from './normalise.ts';

/** The three keys the store uses, in memory. */
const memory = new Map<string, string>();

// Set before the module under test is imported, since it reads window.localStorage at call time
// but the import itself must not explode.
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  },
};

const { FixtureStore } = await import('./fixtureStore.ts');

const PLAN_KEY = 'lototekno:plan:balanced';
const VERSIONS_KEY = 'lototekno:versions:balanced';

const planNamed = (name: string): Plan => normalisePlan({ name });

/** What is in the archive right now, as the store wrote it. */
const archived = (): Array<{ version: number; archivedAt: string; plan: Plan }> =>
  JSON.parse(memory.get(VERSIONS_KEY) ?? '[]') as Array<{
    version: number;
    archivedAt: string;
    plan: Plan;
  }>;

/** Pretends the newest kept version was archived long enough ago to let the next one through. */
const backdate = (minutes: number): void => {
  const versions = archived();
  const last = versions[versions.length - 1]!;
  last.archivedAt = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  memory.set(VERSIONS_KEY, JSON.stringify(versions));
};

beforeEach(() => memory.clear());

test('the first save keeps nothing, because there is nothing yet to lose', async () => {
  const store = new FixtureStore();
  const result = await store.save('balanced', planNamed('un'), 0);

  assert.equal(result.ok, true);
  // Version 0 is the pristine scenario, which is a file rather than a stored plan. `reset` is
  // the way back to it, and always was.
  assert.deepEqual(await store.history('balanced'), []);
});

test('the second save keeps the version it overwrites, with its label and its shape', async () => {
  const store = new FixtureStore();
  await store.save('balanced', planNamed('un'), 0, 'import de 42 bénévoles');
  await store.save('balanced', planNamed('deux'), 1, 'déplacement de Marie Perrin');

  const history = await store.history('balanced');
  assert.equal(history.length, 1);
  assert.equal(history[0]?.version, 1);
  // The label describes the body that was kept, not the save that displaced it.
  assert.equal(history[0]?.label, 'import de 42 bénévoles');
  assert.equal(history[0]?.volunteers, 0);
});

test('a burst of autosaves leaves one restore point, and it is the older one', async () => {
  const store = new FixtureStore();
  await store.save('balanced', planNamed('un'), 0);
  await store.save('balanced', planNamed('deux'), 1);
  // No backdating: this is the autosave firing again a second later, as it does all afternoon.
  await store.save('balanced', planNamed('trois'), 2);
  await store.save('balanced', planNamed('quatre'), 3);

  const history = await store.history('balanced');
  assert.equal(history.length, 1, 'une seule version conservée dans la fenêtre de dix minutes');
  assert.equal(archived()[0]?.plan.name, 'un', 'la plus ANCIENNE est celle qui est gardée');

  // And the other half of the same rule: once the window has passed, the next save is kept.
  backdate(20);
  await store.save('balanced', planNamed('cinq'), 4);
  assert.deepEqual(
    (await store.history('balanced')).map((version) => version.version),
    [4, 1],
  );
});

test('a restore lands as a new version, and keeps what it replaced', async () => {
  const store = new FixtureStore();
  await store.save('balanced', planNamed('du matin'), 0);
  await store.save('balanced', planNamed('de la catastrophe'), 1);

  const result = await store.restore('balanced', 1, 2);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.stored.plan.name, 'du matin');
    assert.equal(result.stored.version, 3, 'une restauration est un enregistrement de plus');
  }

  // The catastrophe is kept too, whatever the ten-minute rule says, so a restore can be undone.
  const history = await store.history('balanced');
  assert.deepEqual(
    history.map((version) => version.version),
    [2, 1],
  );
  assert.equal(archived().find((v) => v.version === 2)?.plan.name, 'de la catastrophe');
});

test('a restore built on a stale version is refused, exactly as a save is', async () => {
  const store = new FixtureStore();
  await store.save('balanced', planNamed('un'), 0);
  await store.save('balanced', planNamed('deux'), 1);

  const result = await store.restore('balanced', 1, 1);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.conflict.version, 2);
});

test('reset takes the history with the edits it describes', async () => {
  // reset goes back to the pristine scenario, which is a file, so this is the one path that
  // reaches for the network.
  (globalThis as unknown as { fetch: unknown }).fetch = (url: string) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(
          url.endsWith('manifest.json')
            ? {
                generatedAt: '2026-09-08T00:00:00.000Z',
                scenarios: [
                  { id: 'balanced', file: 'balanced.json', label: 'Équilibré', volunteers: 0, shifts: 0 },
                ],
              }
            : planNamed('pristine'),
        ),
    });

  const store = new FixtureStore();
  await store.save('balanced', planNamed('un'), 0);
  await store.save('balanced', planNamed('deux'), 1);
  assert.equal((await store.history('balanced')).length, 1);

  const back = await store.reset('balanced');

  assert.equal(back.plan.name, 'pristine');
  assert.equal(back.version, 0);
  assert.equal(memory.get(PLAN_KEY), undefined);
  // Left behind, the archive would hold versions 1 and 2 while the next save writes version 1
  // again: two different plans under one number, and a restore reaching into a previous life.
  assert.deepEqual(await store.history('balanced'), []);
});

test('a named version survives the rule that removes the automatic ones', async () => {
  const store = new FixtureStore();
  await store.save('balanced', planNamed('celle du matin'), 0);

  // Named while it is the version on screen, exactly as the button does it.
  const named = await store.checkpoint('balanced', "avant l'import", 1);
  assert.equal(named.ok, true);

  // Then a long afternoon: eight more saves, each far enough apart to be kept, against a cap of
  // five automatic versions.
  for (let version = 1; version <= 8; version++) {
    backdate(20);
    await store.save('balanced', planNamed(`travail ${version}`), version);
  }

  const history = await store.history('balanced');
  const pinned = history.filter((v) => v.pinned);
  assert.equal(pinned.length, 1, 'le point de sauvegarde est toujours là');
  assert.equal(pinned[0]?.version, 1);
  assert.equal(pinned[0]?.label, "avant l'import");
  assert.equal(
    history.filter((v) => !v.pinned).length,
    5,
    'et il ne prend pas la place des cinq automatiques',
  );
});

test('naming a version already in the history names it, rather than doing nothing', async () => {
  const store = new FixtureStore();
  await store.save('balanced', planNamed('un'), 0, 'déplacement de Marie Perrin');
  await store.save('balanced', planNamed('deux'), 1);
  // Version 1 is already archived automatically at this point. Pressing the button on it is a
  // request to NAME it; answering with silence would look exactly like a button that does not work.
  const before = await store.history('balanced');
  assert.equal(before[0]?.pinned, false);

  await store.checkpoint('balanced', 'la bonne version', 2);
  await store.checkpoint('balanced', 'juste avant la reprise', 2);

  const history = await store.history('balanced');
  assert.equal(history.length, 2, 'nommer ne crée pas de doublon');
  assert.equal(history[0]?.version, 2);
  assert.equal(history[0]?.label, 'juste avant la reprise', 'renommer un point le renomme');
  assert.equal(history[0]?.pinned, true);
});

test('naming a version the store has moved past is refused', async () => {
  const store = new FixtureStore();
  await store.save('balanced', planNamed('un'), 0);
  await store.save('balanced', planNamed('deux'), 1);

  const result = await store.checkpoint('balanced', 'trop tard', 1);
  assert.deepEqual(result, { ok: false, version: 2 });
});

test('a named version can be forgotten, which is the only way one ever goes', async () => {
  const store = new FixtureStore();
  await store.save('balanced', planNamed('un'), 0);
  await store.checkpoint('balanced', "avant l'import", 1);
  assert.equal((await store.history('balanced')).length, 1);

  await store.forgetVersion('balanced', 1);
  assert.deepEqual(await store.history('balanced'), []);
  await assert.rejects(() => store.forgetVersion('balanced', 1), /introuvable/);
});

test('the journal survives a round trip through storage, newest first', async () => {
  const store = new FixtureStore();
  await store.appendLog('balanced', [
    { at: '2026-09-08T12:00:00.000Z', level: 'info', kind: 'edition', message: 'la première', session: 's1' },
    { at: '2026-09-08T12:00:01.000Z', level: 'error', kind: 'ecran', message: 'la deuxième', session: 's1' },
  ]);
  await store.appendLog('balanced', [
    { at: '2026-09-08T12:00:02.000Z', level: 'info', kind: 'edition', message: 'la troisième', session: 's1' },
  ]);

  const rows = await store.readLog('balanced');
  assert.deepEqual(
    rows.map((row) => row.message),
    ['la troisième', 'la deuxième', 'la première'],
  );
  // Ids increase with time, which is the only ordering that survives two entries recorded in the
  // same millisecond on a clock that may itself be wrong.
  assert.ok(rows[0]!.id > rows[2]!.id);

  const entries = await store.readLog(null);
  assert.deepEqual(entries, [], "les entrées sans planning sont rangées à part");
});

test('a volunteer finds their own shifts by code, and nothing else', async () => {
  // The development twin of get_volunteer_schedule. What is checked here is the shape and the
  // discretion, not the security: on this path the browser has the whole plan anyway, which is
  // exactly why the real store asks Postgres instead of filtering here.
  const plan = normalisePlan({
    name: 'Essai',
    startISO: '2027-03-13T11:00:00.000Z',
    poles: [{ key: 'bar', name: 'Bar', path: 'Bar' }],
    shifts: [{ key: 'bar-1', poleKey: 'bar', start: 2, end: 6, headcount: 2 }],
    organisers: [{ key: 'chef', poleKey: 'bar', fullName: 'Claire Dubois', phone: '0611223344' }],
    volunteers: [
      { key: 'nom:marie', firstName: 'Marie', lastName: 'Perrin', accessCode: 'AB12CD', requestedHours: 4 },
      { key: 'nom:jean', firstName: 'Jean', lastName: 'Martin', accessCode: 'EF34GH', requestedHours: 4 },
    ],
    assignments: [
      { volunteerKey: 'nom:marie', shiftKey: 'bar-1' },
      { volunteerKey: 'nom:jean', shiftKey: 'bar-1' },
    ],
  });

  (globalThis as unknown as { fetch: unknown }).fetch = (url: string) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(
          url.endsWith('manifest.json')
            ? {
                generatedAt: '2026-09-08T00:00:00.000Z',
                scenarios: [{ id: 'essai', file: 'essai.json', label: 'Essai', volunteers: 2, shifts: 1 }],
              }
            : plan,
        ),
    });

  const store = new FixtureStore();
  const found = await store.volunteerSchedule('ab12cd');

  assert.equal(found?.benevole.prenom, 'Marie');
  assert.equal(found?.creneaux.length, 1);
  assert.equal(found?.creneaux[0]?.pole, 'Bar');
  // 13h to 17h Paris time on an event starting at 11:00 UTC: two hours in, four hours long.
  assert.equal(found?.creneaux[0]?.debut, '2027-03-13T13:00:00.000Z');
  assert.deepEqual(found?.creneaux[0]?.avec, ['Jean M.'], "prénom et initiale, jamais le nom");
  assert.equal(found?.creneaux[0]?.responsables[0]?.telephone, '0611223344');

  assert.equal(await store.volunteerSchedule('inconnu'), null);
  assert.equal(await store.volunteerSchedule(''), null);
});

test('the people on a shift are named apart, and by the surname when there is one', async () => {
  // Two Jean whose surnames both start with M, and one of them goes by Nono. "Jean M." would
  // have been the same string twice, which on a volunteer's own schedule reads as one colleague
  // instead of two.
  const plan = normalisePlan({
    name: 'Essai',
    startISO: '2027-03-13T11:00:00.000Z',
    poles: [{ key: 'bar', name: 'Bar', path: 'Bar' }],
    shifts: [{ key: 'bar-1', poleKey: 'bar', start: 2, end: 6, headcount: 4 }],
    volunteers: [
      { key: 'v1', firstName: 'Marie', lastName: 'Perrin', accessCode: 'AB12CD', requestedHours: 4 },
      { key: 'v2', firstName: 'Jean', lastName: 'Martin', accessCode: 'EF34GH', requestedHours: 4 },
      { key: 'v3', firstName: 'Jean', lastName: 'Marchand', accessCode: 'IJ56KL', requestedHours: 4 },
      { key: 'v4', firstName: 'Arnaud', lastName: 'Leroy', nickname: 'Nono', accessCode: 'MN78OP', requestedHours: 4 },
    ],
    assignments: [
      { volunteerKey: 'v1', shiftKey: 'bar-1' },
      { volunteerKey: 'v2', shiftKey: 'bar-1' },
      { volunteerKey: 'v3', shiftKey: 'bar-1' },
      { volunteerKey: 'v4', shiftKey: 'bar-1' },
    ],
  });

  (globalThis as unknown as { fetch: unknown }).fetch = (url: string) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(
          url.endsWith('manifest.json')
            ? {
                generatedAt: '2026-09-08T00:00:00.000Z',
                scenarios: [{ id: 'essai', file: 'essai.json', label: 'Essai', volunteers: 4, shifts: 1 }],
              }
            : plan,
        ),
    });

  const found = await new FixtureStore().volunteerSchedule('ab12cd');
  assert.deepEqual(found?.creneaux[0]?.avec, ['Jean Marc.', 'Jean Mart.', 'Nono L.']);
});
