/**
 * What a failure is allowed to destroy.
 *
 * On 2026-09-08 the live database was one migration behind the app, so every autosave came back
 * as `null value in column "half" of relation "volunteer"`. The store answered that by resetting
 * itself: the plan left the screen, the undo stack with it, and the régisseur was shown an error
 * card with no button on it. The plan in the database was untouched the whole time, but the
 * edits made since the last save existed nowhere else and were gone.
 *
 * So: a refused write keeps everything, because the working copy is the only copy. A failed load
 * has nothing to keep except the id of what somebody tried to open, and it keeps that, because
 * an error screen with no way back is read as "the tool is gone".
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Plan } from '../engine.ts';
import { INITIAL, reducer, type PlanState } from './store.tsx';

const here = dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(
  readFileSync(join(here, '..', '..', 'public', 'fixtures', 'balanced.json'), 'utf8'),
) as Plan;

/** A plan open, with unsaved edits on it. The state every one of these tests starts from. */
const working: PlanState = {
  ...INITIAL,
  id: 'balanced',
  plan,
  baseVersion: 3,
  past: [{ plan, label: 'déplacement de Marie Perrin' }],
  lastLabel: 'déplacement de Marie Perrin',
  dirty: true,
  saving: true,
};

test('un enregistrement refusé garde le plan, la pile d\'annulation et les modifications', () => {
  const after = reducer(working, { type: 'save-failed', message: 'null value in column "half"' });

  assert.equal(after.plan, working.plan, 'le plan doit rester exactement le même objet');
  assert.equal(after.id, 'balanced');
  assert.equal(after.baseVersion, 3);
  assert.deepEqual(after.past, working.past);
  assert.equal(after.dirty, true, 'les modifications restent à enregistrer');
  assert.equal(after.saving, false, 'la tentative est terminée');
  assert.match(after.saveError ?? '', /half/);
  assert.equal(after.error, null, "ce n'est pas un échec de chargement");
});

test('réessayer libère la sauvegarde automatique sans toucher à la copie de travail', () => {
  const failed = reducer(working, { type: 'save-failed', message: 'boom' });
  const retried = reducer(failed, { type: 'retry-save' });

  assert.equal(retried.saveError, null);
  assert.equal(retried.plan, working.plan);
  assert.equal(retried.dirty, true, 'sans cela la sauvegarde automatique ne repartirait pas');
});

test('un chargement raté garde l\'identifiant du planning, pour pouvoir réessayer', () => {
  const after = reducer(
    { ...INITIAL },
    { type: 'load-failed', id: 'balanced', message: 'colonne absente' },
  );

  assert.equal(after.id, 'balanced');
  assert.equal(after.plan, null);
  assert.equal(after.error, 'colonne absente');
  assert.equal(after.saveError, null);
});

test('fermer un planning en échec ramène à l\'état de départ', () => {
  const failed = reducer(
    { ...INITIAL },
    { type: 'load-failed', id: 'balanced', message: 'colonne absente' },
  );

  assert.deepEqual(reducer(failed, { type: 'closed' }), INITIAL);
});

test('aucune autre action ne fait disparaître un plan chargé', () => {
  // The list is the point: if a new action is added that resets the state, this test is where
  // the decision has to be made deliberately rather than by leaving it out of a switch.
  const actions = [
    { type: 'save-failed', message: 'boom' },
    { type: 'retry-save' },
    { type: 'saving' },
    { type: 'saved', version: 4, savedAt: '2026-09-08T12:00:00Z' },
    { type: 'outdated', required: 2 },
    { type: 'history-changed' },
    { type: 'overwrite', version: 9 },
  ] as const;

  for (const action of actions) {
    assert.ok(reducer(working, action).plan, `${action.type} a effacé le plan`);
  }
});
