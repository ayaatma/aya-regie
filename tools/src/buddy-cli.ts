/**
 * What raising the buddy weight actually buys, and what it costs.
 *
 * The régisseur asked for buddies to outrank pole choice. The weight table already carries a
 * measurement saying that trade is one for one, but it was taken when `outsideChoice` was 120,
 * and it is 800 now. That changes the answer: the term that used to absorb the cost of honouring
 * a pairing is six times dearer, so the search has to find a way that keeps people inside their
 * choices instead of giving up on them. Worth re-measuring rather than reasoning about.
 *
 * The "sauf si" in the request needs no weight at all: a pole somebody refused is a tier 1 rule,
 * so no weight can put them there. That column is here to prove it stays at zero.
 *
 *   npm run buddy
 *   npm run buddy -- --scenario=balanced+headliner+debutants+buddies
 */

import { DEFAULT_WEIGHTS, solve } from './solver.js';
import { validate } from './validate.js';
import { loadScenario } from './plan-fixtures.js';
import { PlanIndex, type Plan } from './plan.js';

interface Args {
  scenario: string;
  iterations: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { scenario: 'balanced+buddies', iterations: 1000 };
  for (const arg of argv) {
    if (arg.startsWith('--scenario=')) args.scenario = arg.slice(11);
    else if (arg.startsWith('--iterations=')) args.iterations = Number(arg.slice(13));
    else throw new Error(`Option inconnue: ${arg}`);
  }
  return args;
}

function measure(plan: Plan) {
  const report = validate(plan);
  const index = new PlanIndex(plan);

  // A refused pole is tier 1, so this must be zero whatever the weights say.
  let inRefusedPole = 0;
  for (const volunteer of plan.volunteers) {
    if (volunteer.refusedPoleKeys.length === 0) continue;
    for (const shift of index.shiftsOf(volunteer.key)) {
      if (volunteer.refusedPoleKeys.some((r) => index.isUnder(shift.poleKey, r))) inRefusedPole++;
    }
  }

  return {
    honoured: report.summary.buddyHonoured,
    requests: report.summary.buddyRequests,
    choix1: (report.summary.hoursByRank[0] ?? 0),
    choix2: (report.summary.hoursByRank[1] ?? 0),
    horsChoix: report.summary.hoursHorsChoix,
    gapHours: report.summary.gapHours,
    inRefusedPole,
    tier1: report.summary.tier1Count,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const plan = loadScenario(args.scenario);
  const seeds = [20270313, 7, 99, 4242, 31415];

  console.log(`${args.scenario}, ${args.iterations} itérations, moyenne sur ${seeds.length} graines\n`);
  console.log(
    'buddy'.padEnd(8) +
      'binômes'.padStart(12) +
      'choix 1 (h)'.padStart(13) +
      'choix 2 (h)'.padStart(13) +
      'hors choix'.padStart(12) +
      'manque (h)'.padStart(12) +
      'pôle refusé'.padStart(13) +
      'tier 1'.padStart(8),
  );

  for (const buddy of [100, 3500, 5000, 6000, 12000]) {
    const runs = seeds.map((seed) =>
      measure(
        solve(plan, {
          iterations: args.iterations,
          seed,
          weights: { ...DEFAULT_WEIGHTS, buddy },
        }).plan,
      ),
    );
    const mean = (pick: (m: (typeof runs)[number]) => number): number =>
      runs.reduce((total, m) => total + pick(m), 0) / runs.length;

    const label = buddy === DEFAULT_WEIGHTS.buddy ? `${buddy} *` : String(buddy);
    console.log(
      label.padEnd(8) +
        `${mean((m) => m.honoured).toFixed(0)}/${runs[0]!.requests}`.padStart(12) +
        mean((m) => m.choix1).toFixed(0).padStart(13) +
        mean((m) => m.choix2).toFixed(0).padStart(13) +
        mean((m) => m.horsChoix).toFixed(0).padStart(12) +
        mean((m) => m.gapHours).toFixed(0).padStart(12) +
        mean((m) => m.inRefusedPole).toFixed(0).padStart(13) +
        mean((m) => m.tier1).toFixed(0).padStart(8),
    );
  }

  console.log('\n* la valeur actuelle. "pôle refusé" doit rester à zéro: c\'est une règle tier 1.');
}

main();
