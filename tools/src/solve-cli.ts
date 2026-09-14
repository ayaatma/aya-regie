/**
 * Runs the solver over a generated scenario and shows what it bought against the greedy baseline.
 *
 *   npm run solve                                     # scenario "balanced"
 *   npm run solve -- --scenario=shortage-heavy
 *   npm run solve -- --all                            # baseline versus solver, every scenario
 *   npm run solve -- --scenario=balanced --iterations=8000
 *   npm run solve -- --scenario=balanced --resolve    # cancel volunteers, re-solve, show proposals
 *
 * Two properties are checked on every run, and they are the point of the CLI: the solver never
 * produces a tier 1 issue, and a re-solve after a change moves only what it has to.
 */

import { existsSync, readdirSync } from 'node:fs';

import { fmtHours, type Assignment, type Plan } from './plan.js';
import { greedyFill, loadScenario } from './plan-fixtures.js';
import { buildProposals, summariseProposals } from './proposals.js';
import { solve, type SolveResult } from './solver.js';
import { validate, type ValidationResult } from './validate.js';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const num = (name: string, fallback: number): number => Number(arg(name) ?? fallback);

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

interface Metrics {
  filled: number;
  shifts: number;
  gapHours: number;
  zero: number;
  reserve: number;
  belowFloor: number;
  choix1Share: number;
  horsChoixShare: number;
  buddyShare: number;
  tier1: number;
  tier2: number;
}

function metrics(result: ValidationResult): Metrics {
  const s = result.summary;
  const placed = (s.hoursByRank[0] ?? 0) + (s.hoursByRank[1] ?? 0) + s.hoursHorsChoix;
  return {
    filled: s.shiftsFilled,
    shifts: s.shiftsTotal,
    gapHours: s.gapHours,
    zero: s.volunteersUnassigned,
    reserve: s.volunteersOnReserve,
    belowFloor: s.volunteersBelowFloor,
    choix1Share: placed === 0 ? 0 : (s.hoursByRank[0] ?? 0) / placed,
    horsChoixShare: placed === 0 ? 0 : s.hoursHorsChoix / placed,
    buddyShare: s.buddyRequests === 0 ? 1 : s.buddyHonoured / s.buddyRequests,
    tier1: s.tier1Count,
    tier2: s.tier2Count,
  };
}

const share = (n: number): string => `${(100 * n).toFixed(0)}%`;

function metricsLine(label: string, m: Metrics): string {
  return `  ${label.padEnd(10)} ` +
    `${String(m.filled).padStart(3)}/${m.shifts} créneaux  ` +
    `manque ${fmtHours(m.gapHours).padStart(6)}  ` +
    `0h:${String(m.zero).padStart(3)}  ` +
    `rés:${String(m.reserve).padStart(3)}  ` +
    `<4h:${String(m.belowFloor).padStart(3)}  ` +
    `choix1 ${share(m.choix1Share).padStart(4)}  ` +
    `hors choix ${share(m.horsChoixShare).padStart(4)}  ` +
    `binômes ${share(m.buddyShare).padStart(4)}  ` +
    `T1:${String(m.tier1).padStart(2)}  T2:${String(m.tier2).padStart(4)}`;
}

// ---------------------------------------------------------------------------
// One scenario
// ---------------------------------------------------------------------------

function compare(scenario: string, iterations: number, seed: number, outRoot: string): {
  ok: boolean;
  baseline: Metrics;
  solved: Metrics;
  result: SolveResult;
} {
  const empty = loadScenario(scenario, outRoot);
  const baseline = metrics(validate(greedyFill(empty)));
  const result = solve(empty, { seed, iterations });
  const solved = metrics(validate(result.plan));
  return { ok: solved.tier1 === 0, baseline, solved, result };
}

function reportOne(scenario: string, iterations: number, seed: number, outRoot: string): boolean {
  const { ok, baseline, solved, result } = compare(scenario, iterations, seed, outRoot);

  console.log(`=== ${scenario} ===`);
  console.log('');
  console.log(metricsLine('base', baseline));
  console.log(metricsLine('solveur', solved));
  console.log('');
  console.log(`  Score ${result.initialScore.toFixed(0)} après construction, ` +
              `${result.score.toFixed(0)} après recherche ` +
              `(${result.improvements} améliorations sur ${result.iterations} itérations, ` +
              `${result.elapsedMs} ms)`);
  if (result.timedOut) {
    console.log('  ATTENTION: budget de temps atteint, ce résultat n\'est pas reproductible.');
  }
  if (result.dropped.length > 0) {
    console.log(`  ${result.dropped.length} affectations existantes refusées:`);
    for (const d of result.dropped.slice(0, 3)) console.log(`      ${d.reason}`);
  }
  console.log('');
  console.log(ok
    ? 'Contrôle : le solveur ne produit aucune anomalie de niveau 1.'
    : `ÉCHEC : le solveur a produit ${solved.tier1} anomalies de niveau 1.`);
  return ok;
}

// ---------------------------------------------------------------------------
// Incremental re-solve
// ---------------------------------------------------------------------------

/** Someone cancels. Their assignments go with them; so do the buddy requests naming them. */
function cancel(plan: Plan, keys: ReadonlySet<string>): Plan {
  return {
    ...plan,
    volunteers: plan.volunteers.filter((v) => !keys.has(v.key)),
    buddies: plan.buddies.filter((b) => !keys.has(b.fromKey) && !keys.has(b.toKey)),
    assignments: plan.assignments.filter((a) => !keys.has(a.volunteerKey)),
  };
}

/** The régisseur validated part of the plan by hand. Those assignments must never move again. */
function lockSome(plan: Plan, count: number): Plan {
  const assignments: Assignment[] = plan.assignments.map((a, i) =>
    i % Math.max(1, Math.floor(plan.assignments.length / Math.max(1, count))) === 0
      ? { ...a, locked: true, source: 'manual' as const }
      : a,
  );
  return { ...plan, assignments };
}

function reportResolve(
  scenario: string,
  iterations: number,
  seed: number,
  outRoot: string,
  cancelCount: number,
  lockCount: number,
): boolean {
  const first = solve(loadScenario(scenario, outRoot), { seed, iterations });
  const before = lockSome(first.plan, lockCount);

  // The busiest volunteers cancelling is the worst realistic case: it frees the most hours and
  // therefore invites the biggest reshuffle.
  const byHours = [...before.volunteers].sort(
    (a, b) =>
      before.assignments.filter((x) => x.volunteerKey === b.key).length -
      before.assignments.filter((x) => x.volunteerKey === a.key).length,
  );
  const gone = new Set(byHours.slice(0, cancelCount).map((v) => v.key));
  const after = cancel(before, gone);

  // Counted after the cancellations: a lock on someone who has withdrawn cannot survive, and
  // holding the solver to it would be measuring the wrong thing.
  const lockedKeys = new Set(
    after.assignments.filter((a) => a.locked).map((a) => `${a.volunteerKey}|${a.shiftKey}`),
  );

  const resolved = solve(after, { seed, iterations, anchor: after.assignments });
  const proposals = buildProposals(after, resolved.plan, resolved.dropped);

  const kept = new Set(after.assignments.map((a) => `${a.volunteerKey}|${a.shiftKey}`));
  const survived = resolved.plan.assignments.filter(
    (a) => kept.has(`${a.volunteerKey}|${a.shiftKey}`),
  ).length;
  const lockedSurvived = resolved.plan.assignments.filter(
    (a) => lockedKeys.has(`${a.volunteerKey}|${a.shiftKey}`),
  ).length;

  const beforeMetrics = metrics(validate(after));
  const afterMetrics = metrics(validate(resolved.plan));

  console.log(`=== ${scenario} : re-solve après ${cancelCount} désistements ===`);
  console.log('');
  console.log(metricsLine('avant', beforeMetrics));
  console.log(metricsLine('après', afterMetrics));
  console.log('');
  console.log(`  ${survived}/${after.assignments.length} affectations existantes conservées ` +
              `(${share(survived / Math.max(1, after.assignments.length))})`);
  console.log(`  ${lockedSurvived}/${lockedKeys.size} affectations verrouillées conservées`);
  console.log(`  ${summariseProposals(proposals)}`);
  console.log('');
  for (const proposal of proposals.slice(0, 8)) {
    console.log(`  [${proposal.kind}] ${proposal.rationale}`);
  }
  if (proposals.length > 8) console.log(`  ... et ${proposals.length - 8} autres`);
  console.log('');

  const locksHeld = lockedSurvived === lockedKeys.size;
  const ok = afterMetrics.tier1 === 0 && locksHeld;
  console.log(locksHeld
    ? 'Contrôle : toutes les affectations verrouillées ont survécu au re-solve.'
    : `ÉCHEC : ${lockedKeys.size - lockedSurvived} affectations verrouillées ont bougé.`);
  if (afterMetrics.tier1 > 0) console.log(`ÉCHEC : ${afterMetrics.tier1} anomalies de niveau 1.`);
  return ok;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const iterations = num('iterations', 3000);
  const seed = num('seed', 20270313);
  const outRoot = arg('out') ?? 'out';

  if (process.argv.includes('--all')) {
    let allOk = true;
    for (const scenario of readdirSync(outRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)) {
      const { ok, baseline, solved, result } = compare(scenario, iterations, seed, outRoot);
      if (!ok) allOk = false;
      console.log(scenario);
      console.log(metricsLine('base', baseline));
      console.log(metricsLine('solveur', solved) + `  ${result.elapsedMs} ms`);
    }
    console.log('');
    console.log(allOk
      ? 'Aucune anomalie de niveau 1 sur aucun scénario.'
      : 'ÉCHEC : au moins un scénario produit une anomalie de niveau 1.');
    process.exitCode = allOk ? 0 : 1;
    return;
  }

  const scenario = arg('scenario') ?? 'balanced';
  if (!existsSync(`${outRoot}/${scenario}`)) {
    console.error(`Scénario "${scenario}" introuvable dans ${outRoot}/. Lancer d'abord npm run generate.`);
    process.exitCode = 1;
    return;
  }

  const ok = process.argv.includes('--resolve')
    ? reportResolve(scenario, iterations, seed, outRoot, num('cancel', 5), num('lock', 20))
    : reportOne(scenario, iterations, seed, outRoot);
  process.exitCode = ok ? 0 : 1;
}

main();
