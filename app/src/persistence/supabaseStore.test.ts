/**
 * The Supabase store, against a stub client.
 *
 * What is worth testing here is not that Postgres works, it is the seam: that a refused save
 * comes back as a conflict the banner can render rather than as an exception, that the version
 * travels intact in both directions, and that everything crossing the boundary is normalised.
 * A plan that arrives from the database is as much "from outside" as one from localStorage.
 *
 *   npm test    (in app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PLAN_FORMAT, type Plan } from '../engine.ts';
import { normalisePlan } from './normalise.ts';
import { SupabasePlanStore, type RpcCaller } from './supabaseStore.ts';

interface Call {
  fn: string;
  args: Record<string, unknown> | undefined;
}

/** A client that answers from a script and records what it was asked. */
function stub(answers: Record<string, unknown>, fail?: { fn: string; message: string }) {
  const calls: Call[] = [];
  const db: RpcCaller = {
    rpc(fn, args) {
      calls.push({ fn, args });
      if (fail && fail.fn === fn) {
        return Promise.resolve({ data: null, error: { message: fail.message } });
      }
      return Promise.resolve({ data: answers[fn] ?? null, error: null });
    },
  };
  return { db, calls };
}

/** The smallest valid plan: the normaliser fills in every field a Plan must have. */
const plan: Plan = normalisePlan({ name: 'Loto Tekno' });

test('list turns counts into the picker line, singular included', async () => {
  const { db } = stub({
    list_plans: [
      { id: 'a', name: 'Loto Tekno', version: 3, saved_at: null, volunteer_count: 120, shift_count: 91 },
      { id: 'b', name: 'Essai', version: 1, saved_at: null, volunteer_count: 1, shift_count: 0 },
    ],
  });
  const refs = await new SupabasePlanStore(db).list();

  assert.deepEqual(refs, [
    { id: 'a', label: 'Loto Tekno', detail: '120 bénévoles, 91 créneaux' },
    { id: 'b', label: 'Essai', detail: '1 bénévole, 0 créneau' },
  ]);
});

test('load carries the version the plan was read at, in one call', async () => {
  const { db, calls } = stub({
    load_plan: { version: 7, savedAt: '2026-09-08T10:00:00.000Z', plan },
  });
  const stored = await new SupabasePlanStore(db).load('event-1');

  assert.equal(stored.version, 7);
  assert.equal(stored.savedAt, '2026-09-08T10:00:00.000Z');
  assert.equal(stored.plan.name, 'Loto Tekno');
  assert.equal(calls.length, 1, 'the version must not cost a second round trip');
  assert.deepEqual(calls[0]?.args, { p_event_id: 'event-1' });
});

test('a plan from the database is normalised, like every plan from outside', async () => {
  // Written by an older build: no organisers array at all. This is the crash normalise.ts exists
  // for, and the database is no safer a source than localStorage was.
  const stale = { ...plan } as Record<string, unknown>;
  delete stale.organisers;
  const { db } = stub({ load_plan: { version: 1, savedAt: null, plan: stale } });

  const stored = await new SupabasePlanStore(db).load('event-1');
  assert.deepEqual(stored.plan.organisers, []);
});

test('an accepted save reports the new version', async () => {
  const { db, calls } = stub({
    save_plan: { ok: true, version: 8, savedAt: '2026-09-08T11:00:00.000Z' },
  });
  const result = await new SupabasePlanStore(db).save('event-1', plan, 7);

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0]?.args, {
    p_event_id: 'event-1',
    p_base_version: 7,
    p_plan: plan,
    p_label: null,
    p_format: PLAN_FORMAT,
  });
  if (result.ok) assert.equal(result.version, 8);
});

test('the label of the last edit travels with the save, for the history to read back', async () => {
  const { db, calls } = stub({
    save_plan: { ok: true, version: 8, savedAt: '2026-09-08T11:00:00.000Z' },
  });
  await new SupabasePlanStore(db).save('event-1', plan, 7, 'déplacement de Marie Perrin');

  assert.equal(calls[0]?.args?.p_label, 'déplacement de Marie Perrin');
});

test('a refused save is a conflict, not an exception, and carries their plan', async () => {
  const theirs = { ...plan, name: 'Leur version' };
  const { db } = stub({
    save_plan: { ok: false, version: 9, savedAt: '2026-09-08T11:30:00.000Z', plan: theirs },
  });
  const result = await new SupabasePlanStore(db).save('event-1', plan, 7);

  assert.equal(result.ok, false);
  assert.ok(!result.ok && 'conflict' in result);
  if (!result.ok && 'conflict' in result) {
    assert.equal(result.conflict.version, 9);
    assert.equal(result.conflict.plan.name, 'Leur version');
    assert.equal(result.conflict.id, 'event-1');
  }
});

test('a plan that is not there, or not visible, is named rather than crashed on', async () => {
  const { db } = stub({ load_plan: null });
  await assert.rejects(() => new SupabasePlanStore(db).load('event-1'), /introuvable/);
});

test('a database error reaches the régisseur in French, with the server words kept', async () => {
  const { db } = stub({}, { fn: 'save_plan', message: 'permission denied for function save_plan' });
  await assert.rejects(
    () => new SupabasePlanStore(db).save('event-1', plan, 1),
    /Impossible d'enregistrer le planning: permission denied/,
  );
});

test('the history arrives newest first, with the counts each version held', async () => {
  const { db, calls } = stub({
    list_plan_versions: [
      {
        version: 3,
        saved_at: '2026-09-08T11:00:00.000Z',
        archived_at: '2026-09-08T11:20:00.000Z',
        label: 'import de 42 bénévoles',
        pinned: true,
        volunteer_count: 120,
        shift_count: 91,
        assignment_count: 247,
      },
      {
        version: 1,
        saved_at: '2026-09-08T09:00:00.000Z',
        archived_at: '2026-09-08T10:00:00.000Z',
        label: null,
        pinned: false,
        volunteer_count: 78,
        shift_count: 91,
        assignment_count: 0,
      },
    ],
  });

  const versions = await new SupabasePlanStore(db).history('event-1');

  assert.deepEqual(calls[0], { fn: 'list_plan_versions', args: { p_event_id: 'event-1' } });
  assert.deepEqual(versions[0], {
    version: 3,
    savedAt: '2026-09-08T11:00:00.000Z',
    archivedAt: '2026-09-08T11:20:00.000Z',
    label: 'import de 42 bénévoles',
    pinned: true,
    volunteers: 120,
    shifts: 91,
    assignments: 247,
  });
  // A version written before the label existed keeps a null rather than an invented sentence.
  assert.equal(versions[1]?.label, null);
});

test('a restore hands back the whole new state, normalised, at its new version', async () => {
  const old = { ...plan, name: 'La version du matin' } as Record<string, unknown>;
  delete old.organisers;
  const { db, calls } = stub({
    restore_plan_version: { ok: true, version: 9, savedAt: '2026-09-08T12:00:00.000Z', plan: old },
  });

  const result = await new SupabasePlanStore(db).restore('event-1', 3, 8);

  assert.deepEqual(calls[0]?.args, { p_event_id: 'event-1', p_version: 3, p_base_version: 8 });
  assert.equal(result.ok, true);
  if (result.ok) {
    // A restore is a save: it lands as a NEW version, never as the one it went back to.
    assert.equal(result.stored.version, 9);
    assert.equal(result.stored.plan.name, 'La version du matin');
    assert.deepEqual(result.stored.plan.organisers, [], 'un plan restauré passe par le normaliseur');
  }
});

test('a restore against a stale version is refused like a save, and carries their plan', async () => {
  const theirs = { ...plan, name: 'Leur version' };
  const { db } = stub({
    restore_plan_version: { ok: false, version: 12, savedAt: null, plan: theirs },
  });

  const result = await new SupabasePlanStore(db).restore('event-1', 3, 8);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.conflict.version, 12);
    assert.equal(result.conflict.plan.name, 'Leur version');
  }
});

test('deleting a plan sends the typed name for the database to check', async () => {
  const { db, calls } = stub({ delete_plan: { ok: true } });
  await new SupabasePlanStore(db).remove('event-1', 'Loto Tekno');

  assert.deepEqual(calls[0], {
    fn: 'delete_plan',
    args: { p_event_id: 'event-1', p_confirm_name: 'Loto Tekno' },
  });
});

test('a name that does not match comes back as a refusal in French, not a deletion', async () => {
  // The check lives in delete_plan, so what this proves is that its refusal reaches the screen
  // instead of being swallowed into a resolved promise that looks like a success.
  const { db } = stub(
    {},
    { fn: 'delete_plan', message: 'le nom saisi ne correspond pas au planning' },
  );
  await assert.rejects(
    () => new SupabasePlanStore(db).remove('event-1', 'Loto Teknoo'),
    /Impossible de supprimer le planning: le nom saisi ne correspond pas/,
  );
});

test('naming a version keeps it, and says which version was named', async () => {
  const { db, calls } = stub({ create_plan_checkpoint: { ok: true, version: 12 } });
  const result = await new SupabasePlanStore(db).checkpoint('event-1', "avant l'import", 12);

  assert.deepEqual(calls[0], {
    fn: 'create_plan_checkpoint',
    args: { p_event_id: 'event-1', p_name: "avant l'import", p_base_version: 12 },
  });
  assert.deepEqual(result, { ok: true, version: 12 });
});

test('naming a version somebody else has already replaced is refused, not renamed', async () => {
  // Nothing is at risk either way: a checkpoint overwrites nothing. The refusal is about what
  // the name would end up describing, which would be their version rather than the one on screen.
  const { db } = stub({ create_plan_checkpoint: { ok: false, version: 14 } });
  const result = await new SupabasePlanStore(db).checkpoint('event-1', "avant l'import", 12);

  assert.deepEqual(result, { ok: false, version: 14 });
});

test('forgetting one version names the version, never the plan', async () => {
  const { db, calls } = stub({ delete_plan_version: { ok: true } });
  await new SupabasePlanStore(db).forgetVersion('event-1', 4);

  assert.deepEqual(calls[0], {
    fn: 'delete_plan_version',
    args: { p_event_id: 'event-1', p_version: 4 },
  });
});

test('the journal is written in one call per batch, never one per line', async () => {
  const { db, calls } = stub({ write_log: 2 });
  const entries = [
    { at: '2026-09-08T12:00:00.000Z', level: 'info' as const, kind: 'edition' as const, message: 'un', session: 'abcd1234' },
    { at: '2026-09-08T12:00:01.000Z', level: 'error' as const, kind: 'ecran' as const, message: 'deux', session: 'abcd1234' },
  ];

  await new SupabasePlanStore(db).appendLog('event-1', entries);

  assert.equal(calls.length, 1, 'un aller-retour, pas deux');
  assert.deepEqual(calls[0]?.args, { p_event_id: 'event-1', p_entries: entries });
});

test('the journal reads back newest first, with the two clocks kept apart', async () => {
  const { db, calls } = stub({
    read_log: [
      {
        id: 42,
        at: '2026-09-08T12:00:05.000Z',
        received_at: '2026-09-08T12:00:09.000Z',
        level: 'error',
        kind: 'enregistrement',
        message: "Échec de l'enregistrement: réseau injoignable",
        detail: { version: 8 },
        actor: 'regie@example.org',
        session: 'abcd1234',
      },
    ],
  });

  const rows = await new SupabasePlanStore(db).readLog('event-1', 300);

  assert.deepEqual(calls[0]?.args, { p_event_id: 'event-1', p_limit: 300, p_before: null });
  // Two clocks on purpose: `at` is the browser's and is what a person compares against their
  // memory; `receivedAt` is the server's and is what settles it when a browser's clock is wrong.
  assert.equal(rows[0]?.at, '2026-09-08T12:00:05.000Z');
  assert.equal(rows[0]?.receivedAt, '2026-09-08T12:00:09.000Z');
  assert.deepEqual(rows[0]?.detail, { version: 8 });
});

test('a save states the document format this build knows', async () => {
  const { db, calls } = stub({ save_plan: { ok: true, version: 2, savedAt: '2026-09-08T11:00:00.000Z' } });
  await new SupabasePlanStore(db).save('event-1', plan, 1);

  // Without it the database has no way to tell a current writer from one that would strip a
  // field it has never heard of, which is the whole point of the number.
  assert.equal(calls[0]?.args?.p_format, PLAN_FORMAT);
});

test('a page too old to write is told to reload, not shown a conflict', async () => {
  // The two refusals must never look alike. A conflict is a choice between two versions; this is
  // a build that would silently drop a field for everybody, and there is nothing to choose.
  const { db } = stub({ save_plan: { ok: false, reason: 'format', required: 4 } });
  const result = await new SupabasePlanStore(db).save('event-1', plan, 1);

  assert.equal(result.ok, false);
  assert.ok(!result.ok && 'outdated' in result, "ce n'est pas un conflit");
  if (!result.ok && 'outdated' in result) assert.equal(result.outdated.required, 4);
});

test('creating a plan states the format too', async () => {
  const { db, calls } = stub({ create_plan: { id: 'event-9', version: 1, savedAt: '2026-09-08T11:00:00.000Z' } });
  await new SupabasePlanStore(db).create(plan);

  assert.equal(calls[0]?.args?.p_format, PLAN_FORMAT);
});
