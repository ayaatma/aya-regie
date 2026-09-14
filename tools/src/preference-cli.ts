/**
 * What the "against the stated preference" weight buys, and what it costs.
 *
 *   npm run preference
 *   npm run preference -- --scenario=shortage-moderate --iterations=1000
 *
 * The question this answers is the one the régisseur actually asked on 2026-09-08: "Qu'est ce
 * que tu préfères ?" used to be a hard rule, and softening it means somebody can now be placed
 * against their answer. How often, and in exchange for what? Zero says the preference is
 * decorative; a number high enough says nothing changed and the rule is still a wall wearing a
 * price tag. The useful setting is the one where a preference is broken only to fill a hole.
 *
 * Columns: shifts complete, person-hours short, hours worked against a stated preference, and
 * how many people that touches. Averaged over five seeds, because one run of a stochastic
 * search moves these by tens of hours and reading a single seed produces confident nonsense.
 */

import { loadScenario } from './plan-fixtures.js';
import { DEFAULT_WEIGHTS, solve } from './solver.js';
import { validate } from './validate.js';

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const SEEDS = [1, 2, 3, 4, 5];
const CANDIDATES = [0, 400, 1500, 3000, 6000, 20000];

function main(): void {
  const scenario = arg('scenario') ?? 'balanced';
  const iterations = Number(arg('iterations') ?? 1000);
  const plan = loadScenario(scenario);

  console.log(`\n${scenario}, ${iterations} itérations, moyenne sur ${SEEDS.length} graines`);
  console.log('  poids   créneaux   manque   heures contre   personnes   hors choix');

  for (const againstPreference of CANDIDATES) {
    let complete = 0;
    let missing = 0;
    let against = 0;
    let people = 0;
    let outside = 0;

    for (const seed of SEEDS) {
      const result = solve(plan, {
        seed,
        iterations,
        weights: { ...DEFAULT_WEIGHTS, againstPreference },
      });
      const report = validate(result.plan);
      complete += report.summary.shiftsFilled;
      missing += report.summary.gapHours;
      for (const v of report.volunteers) {
        against += v.againstPreferenceHours;
        if (v.againstPreferenceHours > 0) people++;
        outside += v.hoursOutside;
      }
    }

    const n = SEEDS.length;
    const cell = (value: number, width: number, digits = 0): string =>
      (value / n).toFixed(digits).padStart(width);
    console.log(
      `  ${String(againstPreference).padStart(5)}` +
      `   ${cell(complete, 5, 1)}/91` +
      `   ${cell(missing, 5)}h` +
      `   ${cell(against, 11)}h` +
      `   ${cell(people, 9, 1)}` +
      `   ${cell(outside, 10)}h`,
    );
  }
  console.log('');
}

main();
