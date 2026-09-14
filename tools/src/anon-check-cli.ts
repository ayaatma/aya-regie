/**
 * What the anonymous key can actually reach on the live project.
 *
 * A GRANT IS NOT VERIFIED UNTIL THE ANONYMOUS KEY HAS BEEN POINTED AT IT. Reading the SQL is not
 * enough and neither is a parser: Supabase grants EXECUTE on every new function in `public` to
 * anon, authenticated and service_role through default privileges, and `revoke all ... from
 * public` does not undo it, because PUBLIC and `anon` are different grantees. That is how
 * list_plans, load_plan and save_plan came to answer the anonymous key on 2026-09-08. No data
 * was ever exposed, since row level security returned nothing, but the door should not have
 * been there.
 *
 *   npm run anon-check          (in tools/)
 *
 * It reads app/.env.local for the project URL and the anon key, and calls each RPC with the
 * anonymous key alone. NOTHING IT SENDS CAN CHANGE ANYTHING: every call names an event id that
 * does not exist, so the worst an unexpectedly reachable function can do is say so.
 *
 * Read the result as a list of doors, not as a test suite: `fermée` is what every organiser
 * function must be, `ouverte` is what the two volunteer-facing ones must be, and anything else
 * is a finding to fix with a revoke before it is forgotten.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A uuid that exists nowhere, so a reachable function answers "unknown event" and stops. */
const NOWHERE = '00000000-0000-4000-8000-000000000000';

interface Probe {
  fn: string;
  args: Record<string, unknown>;
  /** What this door must be. Organiser functions are closed; the volunteer ones are open. */
  expect: 'fermée' | 'ouverte';
}

const PROBES: Probe[] = [
  { fn: 'list_plans', args: {}, expect: 'fermée' },
  { fn: 'load_plan', args: { p_event_id: NOWHERE }, expect: 'fermée' },
  { fn: 'create_plan', args: { p_plan: {}, p_format: 1 }, expect: 'fermée' },
  {
    fn: 'save_plan',
    args: { p_event_id: NOWHERE, p_base_version: 1, p_plan: {}, p_label: null, p_format: 1 },
    expect: 'fermée',
  },
  { fn: 'list_plan_versions', args: { p_event_id: NOWHERE }, expect: 'fermée' },
  {
    fn: 'restore_plan_version',
    args: { p_event_id: NOWHERE, p_version: 1, p_base_version: 1 },
    expect: 'fermée',
  },
  {
    fn: 'create_plan_checkpoint',
    args: { p_event_id: NOWHERE, p_name: 'x', p_base_version: 1 },
    expect: 'fermée',
  },
  { fn: 'delete_plan_version', args: { p_event_id: NOWHERE, p_version: 1 }, expect: 'fermée' },
  { fn: 'delete_plan', args: { p_event_id: NOWHERE, p_confirm_name: '' }, expect: 'fermée' },
  // The one function in the journal that writes. An open one would let anybody fill the table
  // until pruning is all it ever does.
  { fn: 'write_log', args: { p_event_id: NOWHERE, p_entries: [] }, expect: 'fermée' },
  { fn: 'read_log', args: { p_event_id: NOWHERE, p_limit: 1 }, expect: 'fermée' },
  // write_plan_body is the one that could destroy an afternoon of work, and it lives in the
  // `private` schema precisely so that no API can name it. 404 here is the whole point.
  { fn: 'write_plan_body', args: { p_event_id: NOWHERE, p_plan: {} }, expect: 'fermée' },
  // The three anybody reaches with no account at all: two for a volunteer, one for a organiser.
  // Each of them takes the credential as an argument and filters inside the database, which is
  // why they may be open at all. `get_organiser_planning` returns the whole plan, so it is the one
  // to look at hardest if this list ever changes: it must answer null to an unknown code, and
  // an empty code must never match a organiser who has not been issued one.
  { fn: 'get_volunteer_schedule', args: { p_code: 'inexistant' }, expect: 'ouverte' },
  { fn: 'get_organiser_planning', args: { p_code: 'inexistant' }, expect: 'ouverte' },
  { fn: 'get_public_planning', args: { p_event_id: NOWHERE }, expect: 'ouverte' },
];

/**
 * The tables, because PostgREST exposes every one of them in the public schema as its own
 * endpoint.
 *
 * The functions are the front door and these are the windows. Row level security is what closes
 * them, and RLS with no policy for anon returns no row rather than an error, so a properly closed
 * table and a wide-open empty one look alike from here. Both an empty array and a refusal are
 * acceptable answers. A row is not.
 */
const TABLES = [
  'event',
  'volunteer',
  'assignment',
  // The orgas carry access codes, so an open table here would hand out the credentials
  // themselves rather than merely the data they open.
  'organiser',
  'volunteer_refused_slot',
  'volunteer_phase_window',
  'phase',
  'phase_assignment',
  'plan_version',
  'app_log',
  'app_setting',
  'schema_migration',
];

const here = dirname(fileURLToPath(import.meta.url));

function env(): { url: string; key: string } {
  const path = join(here, '..', '..', 'app', '.env.local');
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
 * One door, tried.
 *
 * A function the key cannot execute answers 401/403 with a permission error; one that is not
 * exposed at all answers 404 with PGRST202. Anything else means the anonymous key got in far
 * enough to run it, whatever the function then decided to do about the missing event.
 */
async function probe(url: string, key: string, p: Probe): Promise<string> {
  const response = await fetch(`${url}/rest/v1/rpc/${p.fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(p.args),
  });
  const body = await response.text();

  if (response.status === 404 && body.includes('PGRST202')) return 'fermée (non exposée)';
  if (response.status === 401 || response.status === 403) return 'fermée (droit refusé)';
  if (/permission denied/i.test(body)) return 'fermée (droit refusé)';
  return `ouverte (HTTP ${response.status})`;
}

/** One table, read with the anonymous key. Anything other than nothing is a finding. */
async function probeTable(url: string, key: string, table: string): Promise<string> {
  const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const body = await response.text();

  if (response.status === 401 || response.status === 403) return 'fermée (droit refusé)';
  if (/permission denied/i.test(body)) return 'fermée (droit refusé)';
  if (response.status === 404) return 'fermée (non exposée)';
  if (body.trim() === '[]') return 'fermée (aucune ligne, RLS)';
  return `OUVERTE (HTTP ${response.status}, ${body.slice(0, 60)})`;
}

async function main(): Promise<void> {
  const { url, key } = env();
  console.log(`Projet: ${url}\n`);

  let findings = 0;
  for (const p of PROBES) {
    const verdict = await probe(url, key, p);
    const ok = verdict.startsWith(p.expect);
    if (!ok) findings++;
    console.log(
      `${ok ? '  ok  ' : 'ALERTE'} ${p.fn.padEnd(22)} ${verdict}${
        ok ? '' : `   (attendu: ${p.expect})`
      }`,
    );
  }

  console.log('');
  for (const table of TABLES) {
    const verdict = await probeTable(url, key, table);
    const ok = verdict.startsWith('fermée');
    if (!ok) findings++;
    console.log(`${ok ? '  ok  ' : 'ALERTE'} table ${table.padEnd(16)} ${verdict}`);
  }

  console.log(
    findings === 0
      ? '\nAucune porte inattendue.'
      : `\n${findings} porte(s) à corriger par un revoke, puis relancer cette commande.`,
  );
  // "non exposée" means PostgREST could not match the name AND the argument list, so it also
  // reads as "cette migration n'est pas encore appliquée". A function that exists and is
  // correctly revoked answers "droit refusé" instead. Do not read a wall of "non exposée" as
  // a clean bill of health for a schema that was never run.
  console.log(
    'Rappel: "non exposée" veut aussi dire "fonction absente", donc migration non appliquée.',
  );
  if (findings > 0) process.exitCode = 1;
}

void main();
