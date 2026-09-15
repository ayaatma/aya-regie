/**
 * Les compétences: adding, renaming, and a removal that leaves no invisible requirement behind.
 *
 *   npm test    (in app/)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validate, type Plan } from '../engine.ts';
import { normalisePlan } from '../persistence/normalise.ts';
import { correctVolunteer } from './edits.ts';
import { addSkill, removeSkill, renameSkill, setPoleSkills, skillUsage } from './skillEdits.ts';

const here = dirname(fileURLToPath(import.meta.url));
const basePlan: Plan = normalisePlan(
  JSON.parse(readFileSync(join(here, '..', '..', 'public', 'fixtures', 'balanced.json'), 'utf8')),
);

test('a pole asking for a competence nobody placed there holds turns their boxes into signalements', () => {
  const placed = basePlan.assignments[0]!;
  const poleKey = basePlan.shifts.find((s) => s.key === placed.shiftKey)!.poleKey;
  let plan = addSkill(basePlan, 'Permis B');
  assert.deepEqual(plan.skills, [{ key: 'permis-b', label: 'Permis B' }]);
  plan = setPoleSkills(plan, poleKey, ['permis-b']);
  assert.ok(validate(plan).issues.some((i) => i.code === 'competence-manquante' && i.volunteerKeys.includes(placed.volunteerKey)));

  const holder = correctVolunteer(plan, placed.volunteerKey, { skills: ['permis-b'] });
  assert.ok(!validate(holder).issues.some((i) => i.code === 'competence-manquante' && i.volunteerKeys.includes(placed.volunteerKey)));
  assert.deepEqual(skillUsage(holder, 'permis-b'), { people: 1, poles: 1 });

  const renamed = renameSkill(holder, 'permis-b', 'Permis voiture');
  assert.deepEqual(renamed.volunteers.find((v) => v.key === placed.volunteerKey)!.skills, ['permis-b']);

  const removed = removeSkill(renamed, 'permis-b');
  assert.deepEqual(skillUsage(removed, 'permis-b'), { people: 0, poles: 0 });
  assert.ok(!validate(removed).issues.some((i) => i.code === 'competence-manquante'));
});
