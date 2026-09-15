/**
 * Turning accepted proposals into edits.
 *
 * A batch is never applied as a block, and it is no longer accepted line by line either. The
 * unit is the group: a set of changes that only makes sense taken together, such as two people
 * trading shifts. Accepting one line of an exchange left a shift over its headcount until the
 * other line was found and accepted too, which meant hunting through the list for the line that
 * cancels the problem you just made. The engine cuts the batch into groups and says which
 * groups each one needs taken first; this module applies what was accepted.
 *
 * The result is not the solver's plan unless every group was accepted, and that is the point.
 */

import type { Plan, Proposal, ProposalGroup } from '../engine.ts';
import { assign, move, setReserve, unassign } from './edits.ts';

export function applyProposal(plan: Plan, proposal: Proposal): Plan {
  switch (proposal.kind) {
    case 'reserve':
      return setReserve(plan, proposal.volunteerKey, true);
    case 'unreserve':
      return setReserve(plan, proposal.volunteerKey, false);
    case 'move':
      if (!proposal.fromShiftKey || !proposal.toShiftKey) return plan;
      return move(plan, proposal.volunteerKey, proposal.fromShiftKey, proposal.toShiftKey);
    case 'remove':
      if (!proposal.fromShiftKey) return plan;
      return unassign(plan, proposal.volunteerKey, proposal.fromShiftKey);
    case 'add':
      if (!proposal.toShiftKey) return plan;
      return assign(plan, proposal.volunteerKey, proposal.toShiftKey);
    default:
      return plan;
  }
}

/** Applies the accepted lines, in the order the engine put them in. */
export function applyProposals(plan: Plan, accepted: readonly Proposal[]): Plan {
  return accepted.reduce(applyProposal, plan);
}

/**
 * Every group the given ones need, transitively, including themselves.
 *
 * This is what one click on "Accepter" really takes: the exchange the régisseur is looking at,
 * plus whatever has to happen first for it to be applicable at all.
 */
export function withPrerequisites(
  groups: readonly ProposalGroup[],
  ids: Iterable<number>,
): number[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const seen = new Set<number>();
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const need of byId.get(id)?.requires ?? []) queue.push(need);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Every group that would be left dangling if the given ones were refused.
 *
 * Rejecting the line that frees a place has to reject whatever was going to take it, otherwise
 * the batch contradicts itself. The screen does this for the régisseur rather than making them
 * work out the consequences.
 */
export function withDependents(
  groups: readonly ProposalGroup[],
  ids: Iterable<number>,
): number[] {
  const rejected = new Set(ids);
  // The graph is small and shallow, so a fixed point costs less than building a reverse index.
  for (;;) {
    let grew = false;
    for (const group of groups) {
      if (rejected.has(group.id)) continue;
      if (group.requires.some((need) => rejected.has(need))) {
        rejected.add(group.id);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return [...rejected].sort((a, b) => a - b);
}

/**
 * Applies whole groups, prerequisites before the groups that need them.
 *
 * The final set of assignments does not actually depend on the order, because everything about
 * one volunteer lives in a single group. The order is respected anyway so that no intermediate
 * state is one the régisseur did not ask for, which is what makes it safe to validate a
 * partially accepted batch and believe the answer.
 */
export function applyGroups(plan: Plan, accepted: readonly ProposalGroup[]): Plan {
  const chosen = new Map(accepted.map((g) => [g.id, g]));
  const done = new Set<number>();
  const order: ProposalGroup[] = [];

  const visit = (group: ProposalGroup, guard: Set<number>): void => {
    if (done.has(group.id) || guard.has(group.id)) return;
    guard.add(group.id);
    for (const need of group.requires) {
      const prerequisite = chosen.get(need);
      if (prerequisite) visit(prerequisite, guard);
    }
    guard.delete(group.id);
    done.add(group.id);
    order.push(group);
  };

  for (const group of accepted) visit(group, new Set<number>());
  return applyProposals(plan, order.flatMap((g) => g.proposals));
}

/** "3 ajouts, 2 déplacements", for the button that applies what was accepted. */
export function describeAccepted(accepted: readonly Proposal[]): string {
  const labels: Record<Proposal['kind'], [string, string]> = {
    add: ['ajout', 'ajouts'],
    move: ['déplacement', 'déplacements'],
    remove: ['retrait', 'retraits'],
    reserve: ["mise en liste d'attente", "mises en liste d'attente"],
    unreserve: ['rappel', 'rappels'],
  };
  const counts = new Map<Proposal['kind'], number>();
  for (const p of accepted) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
  const parts: string[] = [];
  for (const [kind, [one, many]] of Object.entries(labels) as Array<
    [Proposal['kind'], [string, string]]
  >) {
    const count = counts.get(kind) ?? 0;
    if (count > 0) parts.push(`${count} ${count > 1 ? many : one}`);
  }
  return parts.join(', ');
}
