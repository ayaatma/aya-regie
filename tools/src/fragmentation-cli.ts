/**
 * What the anti-fragmentation weights actually buy, measured rather than argued.
 *
 * Prints, for a range of weights, how many volunteers work their hours in one place and one
 * stretch, against what it costs in shifts left short and in choice quality. The point is to see
 * the trade before setting the numbers, because these two weights are the only ones that can
 * make the solver refuse a placement purely on the grounds that somebody's day would be untidy.
 *
 *   npm run fragmentation
 *   npm run fragmentation -- --scenario=shortage-heavy --iterations=1000
 */

import { DEFAULT_WEIGHTS, solve, type SolverWeights } from './solver.js';
import { validate } from './validate.js';
import { loadScenario } from './plan-fixtures.js';
import { PlanIndex, buildBlocks, type Plan } from './plan.js';

interface Args {
  scenario: string;
  iterations: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { scenario: 'balanced', iterations: 1000 };
  for (const arg of argv) {
    if (arg.startsWith('--scenario=')) args.scenario = arg.slice(11);
    else if (arg.startsWith('--iterations=')) args.iterations = Number(arg.slice(13));
    else throw new Error(`Option inconnue: ${arg}`);
  }
  return args;
}

/** Counts, over the whole plan, how broken up the volunteers' days are. */
function measure(plan: Plan) {
  const index = new PlanIndex(plan);
  let splitBlocks = 0;      // contiguous blocks worked across more than one pole
  let extraBlocks = 0;      // blocks beyond what the consecutive cap forces
  let wholeDay = 0;         // volunteers doing all their hours in one place, one stretch
  let working = 0;

  for (const volunteer of plan.volunteers) {
    const shifts = index.shiftsOf(volunteer.key);
    if (shifts.length === 0) continue;
    working++;

    const blocks = buildBlocks(shifts);
    for (const block of blocks) {
      const poles = new Set(
        block.shiftKeys.map((key) => index.shiftByKey.get(key)!.poleKey),
      );
      splitBlocks += poles.size - 1;
    }
    const hours = index.hoursOf(volunteer.key);
    const needed = Math.ceil(hours / plan.rules.maxConsecutiveHours - 1e-9);
    extraBlocks += Math.max(0, blocks.length - needed);

    const allPoles = new Set(shifts.map((s) => s.poleKey));
    if (blocks.length === needed && allPoles.size === 1 && splitBlocksIn(index, blocks) === 0) {
      wholeDay++;
    }
  }

  // The two figures a régisseur would actually recognise: worked in one place, and turned up
  // once. They separate the half the weights can fix from the half only the shift grid can.
  let onePole = 0;
  let oneBlock = 0;
  for (const volunteer of plan.volunteers) {
    const shifts = index.shiftsOf(volunteer.key);
    if (shifts.length === 0) continue;
    if (new Set(shifts.map((s) => s.poleKey)).size === 1) onePole++;
    if (buildBlocks(shifts).length === 1) oneBlock++;
  }

  const report = validate(plan);
  return {
    splitBlocks,
    extraBlocks,
    wholeDay,
    working,
    onePole,
    oneBlock,
    gapHours: report.summary.gapHours,
    choix1: (report.summary.hoursByRank[0] ?? 0),
    horsChoix: report.summary.hoursHorsChoix,
    tier1: report.summary.tier1Count,
  };
}

const splitBlocksIn = (index: PlanIndex, blocks: ReturnType<typeof buildBlocks>): number => {
  let total = 0;
  for (const block of blocks) {
    const poles = new Set(block.shiftKeys.map((key) => index.shiftByKey.get(key)!.poleKey));
    total += poles.size - 1;
  }
  return total;
};

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const plan = loadScenario(args.scenario);

  const settings: Array<{ label: string; weights: Partial<SolverWeights> }> = [
    { label: 'aucun poids', weights: { poleFragmentation: 0, blockSplit: 0 } },
    { label: 'modéré', weights: { poleFragmentation: 600, blockSplit: 300 } },
    { label: 'défaut', weights: {} },
    { label: 'fort', weights: { poleFragmentation: 6000, blockSplit: 3000 } },
    { label: 'au-dessus du staffing', weights: { poleFragmentation: 20000, blockSplit: 10000 } },
    { label: 'défaut + hors choix 400', weights: { outsideChoice: 400 } },
    { label: 'défaut + hors choix 800', weights: { outsideChoice: 800 } },
    { label: 'hors choix 400 seul', weights: { poleFragmentation: 0, blockSplit: 0, outsideChoice: 400 } },
  ];

  console.log(`${args.scenario}, ${args.iterations} itérations\n`);
  console.log(
    'réglage'.padEnd(24) +
      'blocs éclatés'.padStart(15) +
      'un seul pôle'.padStart(14) +
      'un seul bloc'.padStart(14) +
      'journée nette'.padStart(15) +
      'manque (h)'.padStart(12) +
      'choix 1 (h)'.padStart(13) +
      'hors choix'.padStart(12) +
      'tier 1'.padStart(8),
  );

  // Averaged over several seeds. A single run of a stochastic search moves these figures by
  // tens of hours in either direction, which is more than the effect being measured: reading
  // one seed here produces confident nonsense.
  const seeds = [20270313, 7, 99, 4242, 31415];

  for (const setting of settings) {
    const runs = seeds.map((seed) =>
      measure(
        solve(plan, {
          iterations: args.iterations,
          seed,
          weights: { ...DEFAULT_WEIGHTS, ...setting.weights },
        }).plan,
      ),
    );
    const mean = (pick: (m: (typeof runs)[number]) => number): number =>
      runs.reduce((total, m) => total + pick(m), 0) / runs.length;

    const label =
      setting.label === 'défaut'
        ? `défaut (${DEFAULT_WEIGHTS.poleFragmentation}/${DEFAULT_WEIGHTS.blockSplit})`
        : setting.label;
    const working = runs[0]!.working;
    console.log(
      label.padEnd(24) +
        mean((m) => m.splitBlocks).toFixed(1).padStart(15) +
        `${mean((m) => m.onePole).toFixed(0)}/${working}`.padStart(14) +
        `${mean((m) => m.oneBlock).toFixed(0)}/${working}`.padStart(14) +
        `${mean((m) => m.wholeDay).toFixed(0)}/${working}`.padStart(15) +
        mean((m) => m.gapHours).toFixed(0).padStart(12) +
        mean((m) => m.choix1).toFixed(0).padStart(13) +
        mean((m) => m.horsChoix).toFixed(0).padStart(12) +
        mean((m) => m.tier1).toFixed(0).padStart(8),
    );
  }
}

main();
