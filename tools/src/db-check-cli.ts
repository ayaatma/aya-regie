/**
 * Does the live database actually have the tables and columns db/schema.sql describes?
 *
 *   npm run db-check            (in tools/)
 *
 * WHY THIS EXISTS. On 2026-09-08 the app started failing with `null value in column "half" of
 * relation "volunteer" violates not-null constraint`, and the whole screen turned into an error
 * card. The cause was that `2026-09-08_preference_and_plural_refusals.sql` had never been run on
 * the live project, while the migration ledger, backfilled by hand three migrations later, said
 * it had. Every check in the repo passed throughout:
 *
 *   npm run sql-check      parses the SQL. The SQL was fine, nobody had run it.
 *   npm run schema-check   compares schema.sql to the engine's model. Both were fine.
 *   npm run anon-check     calls the RPCs. They all answered, with the wrong bodies inside.
 *
 * All three read files. This one reads the database, which is the only thing that knows.
 *
 * HOW IT ASKS, and why it is safe to run at any moment. PostgREST names one endpoint per table
 * and answers `select=<column>&limit=0` with an empty array when the column exists and with
 * error 42703 when it does not. `limit=0` means no row is ever transferred, so row level
 * security has nothing to hide and the anonymous key is enough: this reads the shape of the
 * database and never its contents. Nothing here can write.
 *
 * WHAT IT DOES NOT CATCH. Types, defaults, not-null, constraints, indexes, policies, and the
 * body of any function: it knows which names exist, not what they mean. Read a clean run as
 * "the migrations that add tables and columns have all been applied", which is the failure that
 * actually happened, and keep `npm run anon-check` for the functions.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

/**
 * Columns that exist in the file and cannot exist in the database, with the reason.
 *
 * Empty today, and it should stay that way: every entry is a column this check no longer
 * protects. It exists because a generated column or a column dropped from the API would
 * otherwise have to be silenced by weakening the parser for everything.
 */
const EXCLUDED: Record<string, string> = {};

function env(): { url: string; key: string } {
  const path = join(root, 'app', '.env.local');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Fichier introuvable: ${path}. Copiez app/.env.example et remplissez-le.`);
  }
  const read = (name: string): string => {
    const found = new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm').exec(text);
    if (!found) throw new Error(`${name} absent de ${path}`);
    return found[1]!.trim().replace(/^["']|["']$/g, '');
  };
  return { url: read('VITE_SUPABASE_URL'), key: read('VITE_SUPABASE_ANON_KEY') };
}

/**
 * The tables of db/schema.sql and the columns of each, read from the file.
 *
 * A create table block ends at a line that is exactly `);`, which is how the schema is written
 * throughout. Inside it, a column is a line that opens with an identifier; the table-level
 * constraints open with a keyword instead, and that is the whole distinction needed here.
 */
export function declaredTables(sql: string): Map<string, string[]> {
  const TABLE_LEVEL = new Set([
    'primary',
    'unique',
    'check',
    'foreign',
    'constraint',
    'exclude',
    'like',
  ]);
  const tables = new Map<string, string[]>();
  const blocks = /create table (?:if not exists )?(\w+) \(([\s\S]*?)\n\);/g;

  let block: RegExpExecArray | null;
  while ((block = blocks.exec(sql)) !== null) {
    const table = block[1]!;
    const columns: string[] = [];
    for (const raw of block[2]!.split('\n')) {
      const line = raw.replace(/--.*$/, '').trim();
      const name = /^(\w+)\s/.exec(line);
      if (!name) continue;
      if (TABLE_LEVEL.has(name[1]!.toLowerCase())) continue;
      if (EXCLUDED[`${table}.${name[1]}`]) continue;
      columns.push(name[1]!);
    }
    tables.set(table, columns);
  }
  return tables;
}

type Verdict = 'ok' | 'absente' | 'inconnue';

/** One name, asked for with no row attached. */
async function exists(url: string, key: string, path: string): Promise<Verdict> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (response.ok) return 'ok';
  const body = await response.text();
  // 42703: column does not exist. PGRST204/PGRST205: the table is not in the schema cache.
  if (/42703|PGRST20[45]/.test(body)) return 'absente';
  // Anything else is the anonymous key being turned away, which says nothing about the shape.
  return 'inconnue';
}

async function main(): Promise<void> {
  const { url, key } = env();
  const tables = declaredTables(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'));
  console.log(`Projet: ${url}`);
  console.log(`Référence: db/schema.sql, ${tables.size} tables\n`);

  const findings: string[] = [];
  let unknown = 0;

  for (const [table, columns] of tables) {
    const there = await exists(url, key, `${table}?select=*&limit=0`);
    if (there === 'absente') {
      findings.push(`table ${table}`);
      console.log(`ALERTE ${table.padEnd(24)} TABLE ABSENTE`);
      continue;
    }
    if (there === 'inconnue') {
      unknown++;
      console.log(`  ?    ${table.padEnd(24)} non vérifiable avec la clé anonyme`);
      continue;
    }

    const missing: string[] = [];
    for (const column of columns) {
      const verdict = await exists(url, key, `${table}?select=${column}&limit=0`);
      if (verdict === 'absente') missing.push(column);
      else if (verdict === 'inconnue') unknown++;
    }
    for (const column of missing) findings.push(`${table}.${column}`);

    console.log(
      missing.length === 0
        ? `  ok   ${table.padEnd(24)} ${columns.length} colonnes`
        : `ALERTE ${table.padEnd(24)} colonnes absentes: ${missing.join(', ')}`,
    );
  }

  if (unknown > 0) {
    console.log(
      `\n${unknown} vérification(s) impossible(s): la clé anonyme n'a pas pu lire la forme de ` +
        `ces objets. Ce n'est pas une alerte, mais ce n'est pas une garantie non plus.`,
    );
  }

  if (findings.length === 0) {
    console.log('\nLa base a bien tout ce que db/schema.sql décrit.');
    return;
  }

  console.log(
    `\n${findings.length} objet(s) manquant(s): ${findings.join(', ')}.\n` +
      `La base est en retard sur le dépôt: une migration de db/migrations n'a pas été appliquée. ` +
      `Le registre schema_migration peut affirmer le contraire, il a déjà eu tort.`,
  );
  process.exitCode = 1;
}

// Imported by the migration runner, run by the CLI.
if (process.argv[1]?.includes('db-check-cli')) void main();
