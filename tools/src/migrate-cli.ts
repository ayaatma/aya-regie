/**
 * Applying db/migrations to the live database, from here, without the SQL editor.
 *
 *   npm run migrate                  what would run, and nothing else happens
 *   npm run migrate -- --apply       runs it
 *   npm run migrate -- --apply --only=2026-09-08_preference_and_plural_refusals.sql
 *
 * WHY IT EXISTS. Pasting a file into the Supabase SQL editor is a step that can be skipped, and
 * on 2026-09-08 one was: `2026-09-08_preference_and_plural_refusals.sql` was written, reviewed,
 * mirrored into db/schema.sql, recorded in the ledger by hand, and never actually run. The tool
 * could then neither open nor save a plan. A human hand between "the file exists" and "the
 * database has it" is the whole bug.
 *
 * THE ONE RULE THAT MAKES THE LEDGER TRUSTWORTHY: each file runs inside a single transaction,
 * and the row in `schema_migration` is written INSIDE that same transaction. So either the
 * schema changed and the ledger says so, or neither happened. The ledger can no longer be a
 * statement of what somebody meant to do. Nothing here ever writes a ledger row on its own.
 *
 * ORDER COMES FROM THE FILE, NOT THE FILENAME. Every migration opens with
 * `-- migration-sequence: N`. Alphabetical order was wrong twice in one afternoon
 * (`version_pinning` had to be renamed to sort after `version_history`, `upgrade_safety` sorts
 * before `writing_an_activity_log` and must run after it), so the order is stated rather than
 * inferred. A file without that line is refused, and so are two files claiming one number.
 *
 * WHAT IT REFUSES TO DO. It never rolls a migration back, never rewrites one that is recorded as
 * applied, and never invents a file order. `--only` runs one named file even when the ledger
 * claims it is done, which is the escape hatch for a ledger that lied; it is still the same
 * transaction and the same row.
 *
 * A MIGRATION THAT CANNOT RUN IN A TRANSACTION would need this to change: `create index
 * concurrently`, and `alter type ... add value` on Postgres below 12. None of ours do, and a file
 * that needs it should say so at the top rather than quietly weakening this for everybody.
 *
 * THE CONNECTION STRING lives in `.env.deploy.local` at the repository root, gitignored, beside
 * the deployment credentials, as SUPABASE_DB_URL. It is the "Session pooler" string from Project
 * Settings, Database, Connect. Not the transaction pooler on port 6543: that one hands out a
 * different backend per statement, which is no way to run a transaction. This password can do
 * anything to the database, which is why it is not in app/.env.local, where the browser bundle
 * reads from.
 *
 * TLS, AND WHY THERE IS A CERTIFICATE IN THIS FOLDER. Supabase does not use a public certificate
 * authority for Postgres. `aws-0-<region>.pooler.supabase.com` presents `*.pooler.supabase.com`
 * signed by "Supabase Intermediate 2021 CA", itself signed by the self-signed "Supabase Root
 * 2021 CA", so Node's default trust store answers SELF_SIGNED_CERT_IN_CHAIN and refuses. The two
 * usual reactions are both wrong here: `rejectUnauthorized: false` encrypts the password and
 * proves nothing about who receives it, and trusting whatever the server sends is not a check at
 * all. So `tools/supabase-ca.crt` holds that root, fetched over HTTPS from
 * supabase-downloads.s3.amazonaws.com/prod/ssl/prod-ca-2021.crt, and it is the ONLY authority
 * this connection accepts. The hostname is still checked against the certificate, so the
 * verification is complete rather than merely present. The file is a public certificate, not a
 * secret, and it belongs in the repository: the check is worth nothing if it depends on a
 * download that happens at the wrong moment. It expires on 2031-04-26.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { declaredTables } from './db-check-cli.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const migrationsDir = join(root, 'db', 'migrations');

export interface Migration {
  sequence: number;
  filename: string;
  sql: string;
}

/** The first line of every migration: `-- migration-sequence: 7`. */
const SEQUENCE = /^--\s*migration-sequence:\s*(\d+)\s*$/m;

/**
 * Reading the directory into the order the files must run in.
 *
 * Exported for the test, which is the only place the wrong order can be caught cheaply: on the
 * real database, running two migrations the wrong way round is not a failing assertion.
 */
export function readMigrations(files: Array<{ filename: string; sql: string }>): Migration[] {
  const migrations: Migration[] = [];
  for (const { filename, sql } of files) {
    const found = SEQUENCE.exec(sql);
    if (!found) {
      throw new Error(
        `${filename} n'a pas de ligne "-- migration-sequence: N".\n` +
          "L'ordre des migrations est écrit dans les fichiers, pas déduit de leur nom: deux " +
          'migrations du même jour se trient par leur sujet, ce qui ne dit rien de leur ordre.',
      );
    }
    migrations.push({ sequence: Number(found[1]), filename, sql });
  }

  const bySequence = new Map<number, string>();
  for (const migration of migrations) {
    const other = bySequence.get(migration.sequence);
    if (other) {
      throw new Error(
        `Deux migrations portent le numéro ${migration.sequence}: ${other} et ` +
          `${migration.filename}. Aucune ne sera appliquée tant que ce n'est pas tranché.`,
      );
    }
    bySequence.set(migration.sequence, migration.filename);
  }

  // 1 is db/schema.sql, which is not a migration and is applied whole on a fresh project.
  const first = migrations.find((migration) => migration.sequence <= 1);
  if (first) {
    throw new Error(
      `${first.filename} porte le numéro ${first.sequence}. Le numéro 1 est db/schema.sql ` +
        'lui-même, une migration commence à 2.',
    );
  }

  return migrations.sort((a, b) => a.sequence - b.sequence);
}

/** A one-line summary of what a migration does, for the ledger, taken from its own title. */
export function noteOf(sql: string): string {
  const title = /^--\s*Migration[^:]*:\s*(.+)$/m.exec(sql);
  const note = (title?.[1] ?? '').trim().replace(/\.$/, '');
  return note === '' ? 'Sans description' : note.slice(0, 200);
}

function connectionString(): string {
  const path = join(root, '.env.deploy.local');
  if (!existsSync(path)) {
    throw new Error(
      `Fichier de configuration absent: ${path}\n` +
        'Copiez tools/.env.deploy.example à la racine sous ce nom et remplissez-le.',
    );
  }
  const found = /^SUPABASE_DB_URL\s*=\s*(.*)$/m.exec(readFileSync(path, 'utf8'));
  const url = (found?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  if (url === '') {
    throw new Error(
      `SUPABASE_DB_URL est vide dans ${path}.\n` +
        'Supabase, Project Settings, Database, Connect, onglet "Session pooler": copiez la ' +
        'chaîne et remplacez [YOUR-PASSWORD] par le mot de passe de la base.',
    );
  }
  if (/:6543\//.test(url)) {
    throw new Error(
      'SUPABASE_DB_URL pointe sur le port 6543, le pooler de transactions: il change de ' +
        "backend à chaque instruction, ce qui interdit d'exécuter une migration en une " +
        'transaction. Prenez la chaîne "Session pooler", port 5432.',
    );
  }
  return url;
}

/** The only certificate authority this connection trusts. See the header for why it is a file. */
function certificateAuthority(): string {
  const path = join(here, '..', 'supabase-ca.crt');
  if (!existsSync(path)) {
    throw new Error(
      `Certificat absent: ${path}\n` +
        'Il fait partie du dépôt. Pour le retrouver: Supabase, Project Settings, Database, ' +
        'SSL Configuration, « Download certificate », ou\n' +
        '  curl -sSL -o tools/supabase-ca.crt ' +
        'https://supabase-downloads.s3.amazonaws.com/prod/ssl/prod-ca-2021.crt\n' +
        'Le sujet doit être "Supabase Root 2021 CA". Ce fichier ne contient aucun secret.',
    );
  }
  return readFileSync(path, 'utf8');
}

/**
 * What the database says it already has.
 *
 * A project from before the ledger existed answers 42P01, and that is not an error here: it
 * means nothing has been recorded yet, which is a truthful answer to the question.
 */
async function appliedSequences(client: Client): Promise<Map<number, string>> {
  try {
    const { rows } = await client.query<{ sequence: number; filename: string }>(
      'select sequence, filename from schema_migration order by sequence',
    );
    return new Map(rows.map((row) => [row.sequence, row.filename]));
  } catch (cause) {
    if ((cause as { code?: string }).code === '42P01') return new Map();
    throw cause;
  }
}

/**
 * One migration, one transaction, the ledger row included.
 *
 * `set local role` is deliberately absent: the connection is the owner, which is what a DDL
 * change needs and exactly why this string never goes near the browser.
 */
async function apply(client: Client, migration: Migration): Promise<void> {
  await client.query('begin');
  try {
    await client.query(migration.sql);
    await client.query(
      `insert into schema_migration (sequence, filename, note)
       values ($1, $2, $3)
       on conflict (sequence) do update
         set filename = excluded.filename, applied_at = now(), note = excluded.note`,
      [migration.sequence, migration.filename, noteOf(migration.sql)],
    );
    await client.query('commit');
  } catch (cause) {
    await client.query('rollback');
    throw cause;
  }
}

/**
 * Does the database now hold everything db/schema.sql describes?
 *
 * Asked of `information_schema` rather than over the API, because this connection can see the
 * catalogue directly. It is the same question `npm run db-check` answers, and the reason it is
 * asked here too is that the ledger has already been wrong once: a run that ends "tout est
 * appliqué" while a column is missing is the exact failure this whole file exists to close.
 */
async function verifyShape(client: Client): Promise<string[]> {
  const declared = declaredTables(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'));
  const { rows } = await client.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  );

  const live = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!live.has(row.table_name)) live.set(row.table_name, new Set());
    live.get(row.table_name)!.add(row.column_name);
  }

  const missing: string[] = [];
  for (const [table, columns] of declared) {
    const there = live.get(table);
    if (!there) {
      missing.push(`table ${table}`);
      continue;
    }
    for (const column of columns) if (!there.has(column)) missing.push(`${table}.${column}`);
  }
  return missing;
}

async function main(): Promise<void> {
  const applyNow = process.argv.includes('--apply');
  const only = process.argv
    .find((argument) => argument.startsWith('--only='))
    ?.slice('--only='.length);

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((filename) => ({ filename, sql: readFileSync(join(migrationsDir, filename), 'utf8') }));
  const migrations = readMigrations(files);

  if (only && !migrations.some((migration) => migration.filename === only)) {
    throw new Error(`--only=${only}: aucun fichier de ce nom dans db/migrations.`);
  }

  /*
   * Listing what exists needs no database, and saying so before asking for a password is the
   * difference between a tool somebody can look at and one they have to configure to look at.
   * Only --apply and the "already applied" column need the connection.
   */
  console.log(`db/migrations, dans l'ordre déclaré par les fichiers:`);
  for (const migration of migrations) {
    console.log(`  ${String(migration.sequence).padStart(2)}  ${migration.filename}`);
  }
  console.log('');

  const url = connectionString();
  const client = new Client({
    connectionString: url,
    // Strict, against Supabase's own root and nothing else. See the header: their Postgres
    // certificates are not signed by a public authority, and this password can rewrite the whole
    // event, so knowing who is on the other end is the point rather than a formality.
    ssl: {
      ca: certificateAuthority(),
      rejectUnauthorized: true,
      // Explicit, so the hostname is checked even if the driver stops passing it along.
      servername: new URL(url).hostname,
    },
    // A migration is DDL over a real table, not a page load. Fail rather than hang forever.
    statement_timeout: 120_000,
  });

  await client.connect();
  try {
    const { rows: whoRows } = await client.query<{ db: string; user: string }>(
      'select current_database() as db, current_user as user',
    );
    console.log(`Base: ${whoRows[0]!.db}, connecté comme ${whoRows[0]!.user}\n`);

    const applied = await appliedSequences(client);
    const pending = migrations.filter((migration) =>
      only ? migration.filename === only : !applied.has(migration.sequence),
    );

    console.log('Ce que le registre schema_migration en dit:');
    for (const migration of migrations) {
      const known = applied.has(migration.sequence);
      const chosen = pending.includes(migration);
      const state = chosen ? (known ? 'À REJOUER' : 'à appliquer') : 'déjà appliquée';
      console.log(
        `  ${String(migration.sequence).padStart(2)}  ${state.padEnd(14)} ${migration.filename}`,
      );
    }

    if (pending.length === 0) {
      console.log('\nRien à appliquer.');
    } else if (!applyNow) {
      console.log(
        `\n${pending.length} migration(s) seraient appliquées, chacune dans sa transaction, ` +
          `avec sa ligne de registre.\nRien n'a été exécuté: relancez avec --apply.`,
      );
    } else {
      console.log('');
      for (const migration of pending) {
        process.stdout.write(`  ${migration.filename} ... `);
        await apply(client, migration);
        console.log('appliquée');
      }
      console.log(`\n${pending.length} migration(s) appliquées.`);
    }

    // Asked whether anything ran or not: it is a fact about the database, and the interesting
    // moment for it is precisely when the ledger claims there is nothing left to do.
    const missing = await verifyShape(client);
    console.log(
      missing.length === 0
        ? '\nVérification: la base a bien tout ce que db/schema.sql décrit.'
        : `\nVÉRIFICATION EN ÉCHEC, ${missing.length} objet(s) manquant(s): ${missing.join(', ')}.` +
            '\nLe registre et la base ne disent pas la même chose. Ne déployez pas.',
    );
    if (missing.length > 0) process.exitCode = 1;

    // Read again after an apply: what the ledger says now, not what it said before.
    writeState(migrations, new Set((applyNow ? await appliedSequences(client) : applied).keys()), applyNow, missing);
  } finally {
    await client.end();
  }
}

/**
 * What the base said the last time anybody asked, left on disk for Claude Code to read.
 *
 * WHY. The developer applies migrations from VS Code (« BDD update ») without saying so, and a
 * session that edits a migration it wrote an hour ago cannot tell whether that migration has
 * run in between: on 2026-09-13 migration 18 was extended after it had been applied, and only
 * this command's post-check caught it. So every connected run writes `db/.migration-state.json`,
 * and `tools/scripts/migration-status.cjs` (a UserPromptSubmit hook in .claude/settings.json)
 * reads it without touching the network and tells the session what is applied, what is pending,
 * and whether an applied file has changed since it ran.
 *
 * THE HASH OF AN APPLIED FILE IS THE ONE FIRST SEEN APPLIED and is never refreshed afterwards:
 * refreshing it would bless an edit made after the fact, which is exactly what it is there to
 * catch. A best effort: a failure to write never fails the migration.
 */
function writeState(
  migrations: ReturnType<typeof readMigrations>,
  applied: ReadonlySet<number>,
  applyNow: boolean,
  missing: readonly string[],
): void {
  const path = join(migrationsDir, '..', '.migration-state.json');
  try {
    let previous: { hashes?: Record<string, string> } = {};
    try {
      previous = JSON.parse(readFileSync(path, 'utf8')) as typeof previous;
    } catch {
      // first run
    }
    const hashes: Record<string, string> = {};
    for (const migration of migrations) {
      if (!applied.has(migration.sequence)) continue;
      hashes[migration.filename] =
        previous.hashes?.[migration.filename] ??
        createHash('sha256').update(readFileSync(join(migrationsDir, migration.filename))).digest('hex');
    }
    writeFileSync(
      path,
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          mode: applyNow ? 'apply' : 'dry',
          applied: migrations.filter((m) => applied.has(m.sequence)).map((m) => m.filename),
          pending: migrations.filter((m) => !applied.has(m.sequence)).map((m) => m.filename),
          missing,
          hashes,
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch (error) {
    console.warn(`(état non écrit: ${error instanceof Error ? error.message : String(error)})`);
  }
}

/**
 * The two failures that happen before a single statement runs, said in French.
 *
 * Both were hit on the first real use, and neither says what it means. "self-signed certificate
 * in certificate chain" reads as a Supabase outage; "tenant/user not found" reads as a wrong
 * password. They are a missing file and a wrong hostname.
 */
export function explain(message: string): string {
  if (/SELF_SIGNED_CERT|self.signed certificate/i.test(message)) {
    return (
      `${message}\n\n` +
      "Ce n'est pas une panne: Supabase ne signe pas ses certificats Postgres avec une autorité " +
      'publique, et Node ne connaît donc pas la sienne. Cette commande fait confiance à ' +
      "tools/supabase-ca.crt et à rien d'autre; l'erreur veut dire que ce fichier manque, est " +
      'tronqué, ou a été remplacé.'
    );
  }
  if (/tenant.*not found/i.test(message)) {
    return (
      `${message}\n\n` +
      "Le mot de passe n'est pas en cause: le pooler nommé dans SUPABASE_DB_URL n'héberge pas ce " +
      "projet, et il répond avant même de regarder le mot de passe. L'hôte a la forme " +
      'aws-<n>-<région>.pooler.supabase.com et ne se devine pas. Recopiez la chaîne entière ' +
      'depuis Supabase, Project Settings, Database, Connect, onglet « Session pooler ».'
    );
  }
  return message;
}

// Imported by the test, run by the CLI.
if (process.argv[1]?.includes('migrate-cli')) {
  main().catch((cause: unknown) => {
    console.error(`\n${explain(cause instanceof Error ? cause.message : String(cause))}`);
    process.exitCode = 1;
  });
}
