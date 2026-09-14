/**
 * Does grouping actually work, on real batches?
 *
 * Two questions, and neither can be answered by reading the code. Are the groups small enough
 * to be a decision a régisseur can make, or does everything end up in one giant component? And
 * does each group really stand on its own, meaning applying it alone introduces no tier 1?
 *
 *   npm run groups
 *   npm run groups -- --scenario=shortage-heavy
 */

import { loadScenario } from './plan-fixtures.js';
import { buildProposals, groupProposals } from './proposals.js';
import { solve } from './solver.js';
import { validate } from './validate.js';
import type { Plan } from './plan.js';
import type { Proposal } from './proposals.js';

interface Args {
  scenario: string;
  iterations: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { scenario: 'balanced', iterations: 600 };
  for (const arg of argv) {
    if (arg.startsWith('--scenario=')) args.scenario = arg.slice(11);
    else if (arg.startsWith('--iterations=')) args.iterations = Number(arg.slice(13));
    else throw new Error(`Option inconnue: ${arg}`);
  }
  return args;
}

/** Applying a group on its own, the way the screen will. */
function apply(plan: Plan, group: readonly Proposal[]): Plan {
  let current = plan;
  for (const p of group) {
    switch (p.kind) {
      case 'reserve':
        current = {
          ...current,
          assignments: current.assignments.filter((a) => a.volunteerKey !== p.volunteerKey),
          reserve: current.reserve.includes(p.volunteerKey)
            ? current.reserve
            : [...current.reserve, p.volunteerKey],
        };
        break;
      case 'unreserve':
        current = { ...current, reserve: current.reserve.filter((k) => k !== p.volunteerKey) };
        break;
      case 'remove':
        current = {
          ...current,
          assignments: current.assignments.filter(
            (a) => !(a.volunteerKey === p.volunteerKey && a.shiftKey === p.fromShiftKey),
          ),
        };
        break;
      case 'move':
        current = {
          ...current,
          assignments: current.assignments.map((a) =>
            a.volunteerKey === p.volunteerKey && a.shiftKey === p.fromShiftKey
              ? { ...a, shiftKey: p.toShiftKey!, source: 'manual' as const }
              : a,
          ),
          reserve: current.reserve.filter((k) => k !== p.volunteerKey),
        };
        break;
      case 'add':
        current = {
          ...current,
          assignments: [
            ...current.assignments,
            { volunteerKey: p.volunteerKey, shiftKey: p.toShiftKey!, locked: false, source: 'manual' as const },
          ],
          reserve: current.reserve.filter((k) => k !== p.volunteerKey),
        };
        break;
    }
  }
  return current;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const solved = loadScenario(args.scenario);

  // The realistic starting point: a plan somebody has already been editing by hand.
  const seeded = solve(solved, { iterations: 2000, seed: 1 }).plan;
  const before: Plan = {
    ...seeded,
    assignments: seeded.assignments.filter((_, i) => i % 7 !== 0),
  };

  const result = solve(before, { iterations: args.iterations, seed: 4242 });
  const proposals = buildProposals(before, result.plan, result.dropped);
  const groups = groupProposals(before, proposals);

  const baseline = validate(before).summary.tier1Count;
  const sizes = groups.map((g) => g.proposals.length).sort((a, b) => b - a);

  console.log(`${args.scenario}: ${proposals.length} propositions, ${groups.length} groupes`);
  console.log(`  tailles: ${sizes.slice(0, 12).join(', ')}${sizes.length > 12 ? ', …' : ''}`);
  console.log(`  plus gros groupe: ${sizes[0] ?? 0} lignes`);
  console.log(`  groupes d'une seule ligne: ${sizes.filter((s) => s === 1).length}`);

  // A group taken with everything it says it needs must never introduce an illegality. That is
  // the promise the screen makes when it pulls prerequisites in behind a single click.
  const byId = new Map(groups.map((g) => [g.id, g]));
  const closure = (start: number): number[] => {
    const seen = new Set<number>();
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const need of byId.get(id)?.requires ?? []) queue.push(need);
    }
    return [...seen].sort((a, b) => a - b);
  };

  let broken = 0;
  let closureTotal = 0;
  let closureMax = 0;
  for (const group of groups) {
    const ids = closure(group.id);
    const lines = ids.flatMap((id) => byId.get(id)!.proposals);
    closureTotal += ids.length;
    closureMax = Math.max(closureMax, lines.length);
    const after = validate(apply(before, lines)).summary.tier1Count;
    if (after > baseline) {
      broken++;
      console.log(`  GROUPE NON AUTONOME (${lines.length} lignes): ${group.title}`);
    }
  }
  console.log(`  groupes non autonomes: ${broken} sur ${groups.length}`);
  console.log(
    `  prérequis: ${(closureTotal / groups.length).toFixed(1)} groupes en moyenne par décision, ` +
      `${closureMax} lignes au maximum`,
  );

  // And the whole batch, group by group, must still land on the solver's plan.
  let all = before;
  for (const group of groups) all = apply(all, group.proposals);
  const same =
    JSON.stringify([...all.assignments.map((a) => `${a.volunteerKey}|${a.shiftKey}`)].sort()) ===
    JSON.stringify([...result.plan.assignments.map((a) => `${a.volunteerKey}|${a.shiftKey}`)].sort());
  console.log(`  tout accepter redonne le plan du solveur: ${same ? 'oui' : 'NON'}`);

  console.log('\n  premiers groupes:');
  for (const group of groups.slice(0, 8)) {
    console.log(`   - [${group.kind}] ${group.title}${group.requires.length ? ` (après ${group.requires.join(", ")})` : ""}`);
    for (const p of group.proposals) console.log(`       ${p.kind} ${p.volunteerName}: ${p.rationale}`);
  }
}

main();
