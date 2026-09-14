/**
 * Does re-solving ever stop proposing things?
 *
 * The régisseur's question, and a fair one: if you accept every proposal, the plan should be at
 * an optimum, and asking again should return nothing. This measures what actually happens over
 * ten rounds of "solve, accept everything, solve again", on an untouched plan.
 *
 * Two numbers matter. The count of proposals, which is what the régisseur sees. And the quality
 * score with the stability term switched off, which is the plan's real cost: the ordinary score
 * cannot be compared between rounds, because stability is measured against the plan the round
 * started from and is therefore always zero at the start of a round.
 *
 *   npm run converge
 *   npm run converge -- --scenario=shortage-heavy --iterations=3000
 */

import { DEFAULT_WEIGHTS, solve } from './solver.js';
import { buildProposals, groupProposals } from './proposals.js';
import { validate } from './validate.js';
import { loadScenario } from './plan-fixtures.js';
import type { Plan } from './plan.js';

interface Args {
  scenario: string;
  iterations: number;
  rounds: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { scenario: 'balanced', iterations: 3000, rounds: 10 };
  for (const arg of argv) {
    if (arg.startsWith('--scenario=')) args.scenario = arg.slice(11);
    else if (arg.startsWith('--iterations=')) args.iterations = Number(arg.slice(13));
    else if (arg.startsWith('--rounds=')) args.rounds = Number(arg.slice(9));
    else throw new Error(`Option inconnue: ${arg}`);
  }
  return args;
}

/**
 * The plan's cost with no stability term at all.
 *
 * `solve` with zero iterations seeds the working state from the plan and scores it without
 * searching, so this is the objective the search is actually trying to lower, comparable from
 * one round to the next.
 */
const quality = (plan: Plan): number =>
  solve(plan, { iterations: 0, weights: { ...DEFAULT_WEIGHTS, stability: 0 } }).initialScore;

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  let plan = loadScenario(args.scenario);

  console.log(`${args.scenario}, ${args.iterations} itérations par tour\n`);
  console.log(
    'tour'.padEnd(6) +
      'propositions'.padStart(14) +
      'décisions'.padStart(11) +
      'coût qualité'.padStart(14) +
      'gain'.padStart(12) +
      'manque (h)'.padStart(12) +
      'choix 1 (h)'.padStart(13) +
      'tier 2'.padStart(8),
  );

  let previous = quality(plan);
  for (let round = 1; round <= args.rounds; round++) {
    const result = solve(plan, { iterations: args.iterations });
    const proposals = buildProposals(plan, result.plan, result.dropped);
    const groups = groupProposals(plan, proposals);

    plan = result.plan;
    const now = quality(plan);
    const report = validate(plan);

    console.log(
      String(round).padEnd(6) +
        String(proposals.length).padStart(14) +
        String(groups.length).padStart(11) +
        Math.round(now).toLocaleString('fr-FR').padStart(14) +
        Math.round(previous - now).toLocaleString('fr-FR').padStart(12) +
        report.summary.gapHours.toFixed(0).padStart(12) +
        (report.summary.hoursByRank[0] ?? 0).toFixed(0).padStart(13) +
        String(report.summary.tier2Count).padStart(8),
    );
    previous = now;
  }

  console.log(
    '\nUn gain positif veut dire que le tour a réellement amélioré le planning.\n' +
      'Un gain nul ou négatif avec des propositions veut dire que le solveur brasse pour rien.',
  );
}

main();
