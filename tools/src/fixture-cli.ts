/**
 * Writes a scenario out as a single Plan JSON the browser app can fetch.
 *
 * The app runs the engine client side, so it needs a whole Plan and nothing else: no CSV
 * parsing, no filesystem, no import pass. This CLI is the bridge between the generated
 * scenarios and `app/public/fixtures/`, and exists only so the UI can be built and exercised
 * against real-sized data before Supabase is wired in.
 *
 *   npm run fixture                                    # balanced, empty and solved
 *   npm run fixture -- --scenario=surplus --no-solve
 *   npm run fixture -- --all
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadScenario, withPhases } from './plan-fixtures.js';
import { solve } from './solver.js';
import { validate } from './validate.js';
import type { Plan } from './plan.js';

const DEFAULT_OUT = join('..', 'app', 'public', 'fixtures');

/** Every scenario `npm run generate` writes, in the order the picker should list them. */
const ALL_SCENARIOS = [
  'balanced',
  'balanced+buddies',
  'balanced+headliner+debutants+buddies',
  'balanced+shunned-pole',
  'shortage-moderate',
  'shortage-moderate+afternoon-heavy',
  'shortage-heavy',
  'shortage-heavy+shunned-pole',
  'surplus',
  'over-recruited',
  // The balanced scenario with the montage, the démontage, the catering and an act's fiche on:
  // for looking at those screens, which every other scenario leaves empty.
  'balanced+phases',
];

interface Args {
  scenarios: string[];
  out: string;
  solve: boolean;
  iterations: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { scenarios: ['balanced'], out: DEFAULT_OUT, solve: true, iterations: 3000 };
  for (const arg of argv) {
    if (arg === '--all') args.scenarios = [...ALL_SCENARIOS];
    else if (arg === '--no-solve') args.solve = false;
    else if (arg.startsWith('--scenario=')) args.scenarios = [arg.slice(11)];
    else if (arg.startsWith('--out=')) args.out = arg.slice(6);
    else if (arg.startsWith('--iterations=')) args.iterations = Number(arg.slice(13));
    else throw new Error(`Option inconnue: ${arg}`);
  }
  return args;
}

/** The scenario list the app's picker reads, so the app never hardcodes what was exported. */
interface Manifest {
  generatedAt: string;
  scenarios: Array<{ id: string; file: string; label: string; volunteers: number; shifts: number }>;
}

function labelFor(scenario: string): string {
  const [volume, ...stresses] = scenario.split('+');
  const volumes: Record<string, string> = {
    balanced: 'Équilibré',
    'shortage-moderate': 'Pénurie modérée',
    'shortage-heavy': 'Pénurie forte',
    surplus: 'Surplus',
    'over-recruited': 'Sur-recrutement',
  };
  const stressLabels: Record<string, string> = {
    buddies: 'binômes',
    headliner: 'tête d\'affiche',
    debutants: 'débutants',
    'shunned-pole': 'pôle boudé',
    'afternoon-heavy': 'après-midi chargé',
    phases: 'montage, démontage, catering, artistes',
  };
  const base = volumes[volume ?? ''] ?? (volume ?? scenario);
  if (stresses.length === 0) return base;
  return `${base} (${stresses.map((s) => stressLabels[s] ?? s).join(', ')})`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });

  const entries: Manifest['scenarios'] = [];

  for (const scenario of args.scenarios) {
    const phases = scenario.endsWith('+phases');
    let plan: Plan = loadScenario(phases ? scenario.slice(0, -'+phases'.length) : scenario);
    if (phases) plan = withPhases(plan);

    if (args.solve) {
      const result = solve(plan, { iterations: args.iterations });
      plan = result.plan;
      const report = validate(plan);
      console.log(
        `${scenario}: ${result.elapsedMs} ms, score ${result.score.toFixed(1)}, ` +
        `tier 1 ${report.summary.tier1Count}, tier 2 ${report.summary.tier2Count}`,
      );
    } else {
      console.log(`${scenario}: plan vide, ${plan.volunteers.length} bénévoles`);
    }

    const file = `${scenario.replace(/\+/g, '_')}.json`;
    writeFileSync(join(args.out, file), JSON.stringify(plan), 'utf8');
    entries.push({
      id: scenario,
      file,
      label: labelFor(scenario),
      volunteers: plan.volunteers.length,
      shifts: plan.shifts.length,
    });
  }

  const manifest: Manifest = { generatedAt: new Date().toISOString(), scenarios: entries };
  writeFileSync(join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\n${entries.length} fixture(s) écrite(s) dans ${args.out}`);
}

main();
