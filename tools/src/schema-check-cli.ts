/**
 * Does every field of the engine's `Plan` actually survive a round trip through Postgres?
 *
 *   npm run schema-check        (in tools/)
 *
 * WHAT THIS CATCHES, and it is a silent data loss rather than a crash. A plan is saved whole:
 * `write_plan_body` deletes the event's contents and re-inserts them from the JSON document, and
 * `load_plan` builds that document back from the tables. Both name every field explicitly. So
 * adding a field to `Volunteer` and forgetting it in ONE of those two functions produces no
 * error anywhere: TypeScript is happy, the SQL parses, the tests pass, the screen shows the
 * value, and it is gone at the next save. For everybody. Without a word.
 *
 * That is the exact shape of the accident this project is most exposed to, because the model is
 * expected to keep growing: a dietary requirement, a setup and teardown period, a timeline.
 *
 * WHAT IT DOES NOT CATCH: a field that is written to the wrong column, or a type that will not
 * cast. It knows the names, not the meanings. `npm run sql-check` knows the grammar, and neither
 * of them knows the catalogue: the first run against the real database is still the real test.
 *
 * HOW IT READS THE SQL. Both functions are searched as text, for the field name in quotes, which
 * is how a jsonb key is spelled on both sides (`'firstName', v.first_name` on the way out,
 * `x->>'firstName'` on the way in). Two shapes need their own handling, and both are documented
 * against the exclusions below.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

/** The interfaces that together are the plan document, in the order they read best. */
const INTERFACES = [
  'EventSlot',
  'PreferenceSlot',
  'SchedulingRules',
  'Pole',
  'Shift',
  'Organiser',
  'LeaderRole',
  'Artist',
  'ArtistMember',
  'CarTrip',
  'Guest',
  'TicketType',
  'BraceletType',
  'ExtraPerson',
  'TicketingChoice',
  'TicketingSettings',
  'TravelRates',
  'Volunteer',
  'PoleChoice',
  'VolumeSettings',
  'Assignment',
  'BuddyPair',
  'OrganiserShift',
  // The two phases. Their derived types (a day, a half-day, a placement) are computed and
  // never stored, so they are deliberately not here: only what a save has to carry is.
  'PhasePresence',
  'PhasePole',
  'PhaseEvent',
  'PhaseAssignment',
  'Phase',
  // The catering. `MealService` and everything else about who eats what is derived and never
  // stored, so it is deliberately absent: only what a save has to carry is here.
  'MealWindow',
  'MealTier',
  'CateringRules',
  'MealChoice',
  'CateringSettings',
  'Plan',
] as const;

/**
 * Fields that must NOT round trip, each with the reason.
 *
 * A list of two, and it should stay short: every entry here is a field the check can no longer
 * protect.
 */
const EXCLUDED: Record<string, string> = {
  // Rebuilt on load by a recursive CTE, never stored, so that renaming a parent cannot leave a
  // stale path behind on its children.
  'Pole.path': 'dérivé au chargement',
  // A container rather than a leaf. Its own fields are checked as SchedulingRules, where
  // write_plan_body reaches them through #>>'{rules,maxBlocks}' and the name therefore
  // never appears in quotes of its own.
  'Plan.rules': 'conteneur, ses champs sont vérifiés séparément',
  // The same two containers, for the same reason: write_plan_body reaches inside them through
  // #>>'{catering,rules,drinkPerHours}' and #>'{catering,choices}'.
  'Plan.catering': 'conteneur, ses champs sont vérifiés séparément',
  'CateringSettings.rules': 'conteneur, ses champs sont vérifiés séparément',
  // The same again: write_plan_body reaches inside through #>'{ticketing,ticketTypes}'.
  'Plan.ticketing': 'conteneur, ses champs sont vérifiés séparément',
  'Plan.travel': 'conteneur, ses champs sont vérifiés séparément',
  // A record of five prices, reached through #>>'{travel,fuelPrices,essence}' and built by
  // jsonb_build_object on the way out: the five keys are what the base carries.
  'TravelRates.fuelPrices': 'conteneur, une colonne par carburant',
};

/** The body of one SQL function, from its header to the next top-level `create`. */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`fonction introuvable dans le schéma: ${name}`);
  const after = sql.indexOf('\ncreate ', start);
  return sql.slice(start, after < 0 ? sql.length : after);
}

/** The field names of one exported interface, in declaration order. */
function fieldsOf(source: string, name: string): string[] {
  const header = `export interface ${name} {`;
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`interface introuvable: ${name}`);
  const end = source.indexOf('\n}', start);
  const body = source.slice(start + header.length, end);

  const fields: string[] = [];
  for (const line of body.split('\n')) {
    // Two spaces of indentation is a field of this interface; anything deeper belongs to a
    // nested type literal and is not a column of its own.
    const match = /^ {2}(?:readonly )?(\w+)\??\??:/.exec(line);
    if (match) fields.push(match[1]!);
  }
  return fields;
}

interface Gap {
  where: string;
  field: string;
  missing: 'load_plan' | 'write_plan_body' | 'les deux';
}

function main(): void {
  const source = ['model.ts', 'plan.ts', 'phase.ts', 'days.ts']
    .map((file) => readFileSync(join(root, 'tools', 'src', file), 'utf8'))
    .join('\n');
  const schema = readFileSync(join(root, 'db', 'schema.sql'), 'utf8');

  const load = functionBody(schema, 'public.load_plan');
  const write = functionBody(schema, 'private.write_plan_body');

  const gaps: Gap[] = [];
  let checked = 0;
  let skipped = 0;

  for (const name of INTERFACES) {
    const fields = fieldsOf(source, name);
    const missing: string[] = [];

    for (const field of fields) {
      if (EXCLUDED[`${name}.${field}`]) {
        skipped++;
        continue;
      }
      checked++;

      const quoted = `'${field}'`;
      const inLoad = load.includes(quoted);
      // Three ways a field is reached in the write half, and all three count as written.
      // `,maxBlocks}` is a scheduling rule read through #>>'{rules,maxBlocks}',
      // where the name carries no quotes of its own; `{catering,` is the same thing for a
      // field that is itself the ROOT of such a path, as `Plan.catering` is.
      const inWrite =
        write.includes(quoted) ||
        write.includes(`,${field}}`) ||
        write.includes(`{${field},`);

      if (!inLoad || !inWrite) {
        missing.push(field);
        gaps.push({
          where: name,
          field,
          missing: !inLoad && !inWrite ? 'les deux' : !inLoad ? 'load_plan' : 'write_plan_body',
        });
      }
    }

    console.log(
      `${missing.length === 0 ? 'OK  ' : 'FAIL'} ${name.padEnd(17)} ${String(fields.length).padStart(2)} champs` +
        (missing.length > 0 ? `   absents: ${missing.join(', ')}` : ''),
    );
  }

  console.log('');
  for (const gap of gaps) {
    console.log(
      `  ${gap.where}.${gap.field} n'apparaît pas dans ${gap.missing}. ` +
        'Une sauvegarde effacerait ce champ pour tout le monde, sans erreur.',
    );
  }

  console.log(
    gaps.length === 0
      ? `\n${checked} champs vérifiés, ${skipped} exclus: tout fait l'aller-retour.`
      : `\n${gaps.length} champ(s) sur ${checked} ne font pas l'aller-retour.`,
  );
  if (gaps.length > 0) process.exitCode = 1;
}

main();
