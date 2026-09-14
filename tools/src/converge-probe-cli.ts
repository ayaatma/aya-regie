/**
 * Why does a plan the convergence loop called settled still yield proposals?
 *
 * The loop stops when one round changes nothing. This checks whether that is actually a
 * property of the plan, or only a property of the seed that round happened to use: it converges
 * a plan, then re-solves the result under a spread of seeds and counts what each one finds.
 *
 *   npm run converge-probe
 *   npm run converge-probe -- --scenario=surplus
 */

import { loadScenario } from './plan-fixtures.js';
import { buildProposals } from './proposals.js';
import { planSeed, solve, solveToConvergence } from './solver.js';

interface Args {
  scenario: string;
  iterations: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { scenario: 'balanced', iterations: 3000 };
  for (const arg of argv) {
    if (arg.startsWith('--scenario=')) args.scenario = arg.slice(11);
    else if (arg.startsWith('--iterations=')) args.iterations = Number(arg.slice(13));
    else throw new Error(`Option inconnue: ${arg}`);
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // The user's situation: a plan already solved once, the way a fixture ships.
  const start = solve(loadScenario(args.scenario), { iterations: args.iterations }).plan;

  const converged = solveToConvergence(start, { iterations: args.iterations });
  console.log(
    `${args.scenario}: convergence en ${converged.rounds} tours, ${(converged.elapsedMs / 1000).toFixed(1)} s, ` +
      `converged=${converged.converged}`,
  );

  // THE PROMISE: pressing "Recalculer" straight afterwards finds nothing. That button passes no
  // seed, so this is the one run that has to come back empty, and it is the one the régisseur
  // actually performs.
  const manual = solve(converged.plan, { iterations: args.iterations });
  const manualProposals = buildProposals(converged.plan, manual.plan, manual.dropped);
  console.log(
    `\n  "Recalculer" juste après (graine par défaut ${planSeed(converged.plan)}): ` +
      `${manualProposals.length} propositions` +
      (manualProposals.length === 0 ? '  ✔' : '  ✘ LA PROMESSE EST ROMPUE'),
  );

  // Other seeds are a different question. A stochastic search can always be restarted somewhere
  // else and find a little more; what matters is that the gains have become small next to the
  // plan's own cost, which is what "settled" honestly means here.
  console.log('\n  ce que trouveraient d\'autres recherches, pour situer ce qui reste:');
  for (const seed of [1, 7, 99, 4242, 31415]) {
    const again = solve(converged.plan, { iterations: args.iterations, seed });
    const proposals = buildProposals(converged.plan, again.plan, again.dropped);
    const gain = Math.round(again.initialScore - again.score);
    console.log(
      `    graine ${String(seed).padStart(7)}: ${String(proposals.length).padStart(3)} propositions, ` +
        `gain ${String(gain).padStart(6)} sur un coût de ${Math.round(again.initialScore)} ` +
        `(${((gain / again.initialScore) * 100).toFixed(2)} %)`,
    );
  }
}

main();
