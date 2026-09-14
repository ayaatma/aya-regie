/**
 * The order migrations run in, tested without a database.
 *
 * Running two migrations the wrong way round against Postgres is not a failing assertion, it is
 * an event with real people in it, so the ordering rules are checked here where a mistake costs
 * nothing. What cannot be tested here is the transaction, which is the other half of the design;
 * that one is a property of `apply` and of Postgres.
 *
 *   npm test    (in tools/)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deepStrictEqual, match, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { explain, noteOf, readMigrations } from './migrate-cli.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'db', 'migrations');

const file = (filename: string, sequence: number | null, body = '') => ({
  filename,
  sql: (sequence === null ? '' : `-- migration-sequence: ${sequence}\n`) + body,
});

test('les migrations sortent dans l\'ordre du fichier, pas dans celui du nom', () => {
  // The real trap, twice in one afternoon: "upgrade_safety" sorts before
  // "writing_an_activity_log" alphabetically and must run after it.
  const ordered = readMigrations([
    file('2026-09-08_upgrade_safety.sql', 8),
    file('2026-09-08_writing_an_activity_log.sql', 7),
  ]);

  deepStrictEqual(
    ordered.map((migration) => migration.filename),
    ['2026-09-08_writing_an_activity_log.sql', '2026-09-08_upgrade_safety.sql'],
  );
});

test('une migration sans numéro arrête tout, elle ne passe pas à la fin', () => {
  throws(
    () => readMigrations([file('2026-09-08_ok.sql', 2), file('2026-09-09_oubli.sql', null)]),
    /migration-sequence/,
  );
});

test('deux migrations sur le même numéro arrêtent tout', () => {
  throws(() => readMigrations([file('a.sql', 5), file('b.sql', 5)]), /a\.sql et b\.sql/);
});

test('le numéro 1 est réservé à db/schema.sql', () => {
  throws(() => readMigrations([file('a.sql', 1)]), /numéro 1 est db\/schema\.sql/);
});

test('la note du registre vient du titre de la migration', () => {
  strictEqual(
    noteOf('-- migration-sequence: 3\n-- Migration 2026-09-08: la demi-journée devient une préférence.\n'),
    'la demi-journée devient une préférence',
  );
  strictEqual(noteOf('-- migration-sequence: 3\n-- rien de particulier\n'), 'Sans description');
});

test('les vraies migrations du dépôt sont toutes numérotées, sans trou ni doublon', () => {
  // The one test that reads the repository: a file added without its header would otherwise be
  // found by the runner, in front of the database, at the worst moment.
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((filename) => ({ filename, sql: readFileSync(join(migrationsDir, filename), 'utf8') }));

  const ordered = readMigrations(files);
  strictEqual(ordered.length, files.length);

  const numbers = ordered.map((migration) => migration.sequence);
  deepStrictEqual(
    numbers,
    numbers.map((_, index) => numbers[0]! + index),
    `les numéros doivent se suivre: ${numbers.join(', ')}`,
  );

  // 2 because 1 is db/schema.sql, applied whole rather than as a migration.
  strictEqual(numbers[0], 2);
  match(ordered[0]!.filename, /load_plan_envelope/);
});

test('les deux échecs de connexion sont traduits, pas recopiés', () => {
  // Both were met on the first real run, and both point at the wrong thing when read raw.
  match(explain('self-signed certificate in certificate chain'), /supabase-ca\.crt/);
  match(explain('(ENOTFOUND) tenant/user postgres.abc not found'), /Session pooler/);
  match(explain('(ENOTFOUND) tenant/user postgres.abc not found'), /pas en cause/);
  // Anything else goes through untouched: a guess dressed up as an explanation is worse than
  // the original message.
  strictEqual(explain('deadlock detected'), 'deadlock detected');
});
