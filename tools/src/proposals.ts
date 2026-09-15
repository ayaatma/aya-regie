/**
 * Turning a re-solve into something the régisseur can accept or refuse.
 *
 * The ground rule of this project is that the tool never silently moves a real person. So the
 * solver produces a plan, and this module reduces the difference against the plan in place to a
 * list of add / remove / move proposals, each carrying the reason it exists. Nothing is applied
 * here. The shape matches the `proposal` table in db/schema.sql on purpose.
 *
 * A removal and an addition for the same volunteer are paired into a single move, because
 * "Marie passes from the 22h bar shift to the 20h one" is one decision, not two.
 */

import { PlanIndex, fmtHours, type Assignment, type Plan } from './plan.js';
import type { DroppedAssignment } from './solver.js';

export type ProposalKind = 'add' | 'remove' | 'move' | 'reserve' | 'unreserve';

export interface Proposal {
  kind: ProposalKind;
  volunteerKey: string;
  volunteerName: string;
  /** Null on a reserve or unreserve line, which is about the person, not about a shift. */
  fromShiftKey: string | null;
  toShiftKey: string | null;
  /** French, and specific. This is the whole reason the régisseur can decide in one read. */
  rationale: string;
}

const keysOf = (assignments: readonly Assignment[]): Map<string, Set<string>> => {
  const byVolunteer = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = byVolunteer.get(a.volunteerKey) ?? new Set<string>();
    set.add(a.shiftKey);
    byVolunteer.set(a.volunteerKey, set);
  }
  return byVolunteer;
};

/**
 * The difference between the plan in place and the plan the solver proposes.
 *
 * `before` and `after` must describe the same event: same poles, same shifts, same volunteers.
 * Only the assignments are expected to differ.
 */
export function buildProposals(
  before: Plan,
  after: Plan,
  dropped: readonly DroppedAssignment[] = [],
): Proposal[] {
  const from = new PlanIndex(before);
  const to = new PlanIndex(after);
  const wasAssigned = keysOf(before.assignments);
  const isAssigned = keysOf(after.assignments);
  const dropReasons = new Map(
    dropped.map((d) => [`${d.assignment.volunteerKey}|${d.assignment.shiftKey}`, d.reason]),
  );

  const proposals: Proposal[] = [];

  for (const volunteer of before.volunteers) {
    const had = wasAssigned.get(volunteer.key) ?? new Set<string>();
    const has = isAssigned.get(volunteer.key) ?? new Set<string>();

    const removals = [...had].filter((k) => !has.has(k))
      .map((k) => from.shiftByKey.get(k)).filter((s) => s !== undefined);
    const additions = [...has].filter((k) => !had.has(k))
      .map((k) => to.shiftByKey.get(k)).filter((s) => s !== undefined);

    removals.sort((a, b) => a.start - b.start);
    additions.sort((a, b) => a.start - b.start);

    const name = to.volunteerName(volunteer.key);
    const hoursBefore = from.hoursOf(volunteer.key);
    const hoursAfter = to.hoursOf(volunteer.key);

    // Pair each addition with the removal it most plausibly replaces: same pole first, then
    // nearest in time. That is what makes the line read as one move rather than two edits.
    const spare = [...removals];
    for (const arrival of additions) {
      let bestAt = -1;
      let bestCost = Infinity;
      for (let i = 0; i < spare.length; i++) {
        const departure = spare[i]!;
        const cost = (departure.poleKey === arrival.poleKey ? 0 : 100)
                   + Math.abs(departure.start - arrival.start);
        if (cost < bestCost) {
          bestCost = cost;
          bestAt = i;
        }
      }

      if (bestAt >= 0) {
        const departure = spare.splice(bestAt, 1)[0]!;
        proposals.push({
          kind: 'move',
          volunteerKey: volunteer.key,
          volunteerName: name,
          fromShiftKey: departure.key,
          toShiftKey: arrival.key,
          rationale: `Déplace ${name} de "${from.shiftLabel(departure)}" vers ` +
                     `"${to.shiftLabel(arrival)}". ${moveReason(from, to, volunteer.key, departure, arrival)}`,
        });
      } else {
        proposals.push({
          kind: 'add',
          volunteerKey: volunteer.key,
          volunteerName: name,
          fromShiftKey: null,
          toShiftKey: arrival.key,
          rationale: `Ajoute ${name} sur "${to.shiftLabel(arrival)}". ` +
                     addReason(from, to, volunteer.key, arrival, hoursBefore, hoursAfter),
        });
      }
    }

    for (const departure of spare) {
      const reason = dropReasons.get(`${volunteer.key}|${departure.key}`);
      proposals.push({
        kind: 'remove',
        volunteerKey: volunteer.key,
        volunteerName: name,
        fromShiftKey: departure.key,
        toShiftKey: null,
        rationale: `Retire ${name} de "${from.shiftLabel(departure)}". ` +
                   (reason ?? 'Libère la place pour un bénévole qui en a plus besoin.'),
      });
    }
  }

  // Reserve decisions come first because they are the only ones that mean telling somebody they
  // are not needed. Moves next: they change an evening rather than fill a hole.
  const rank: Record<ProposalKind, number> =
    { reserve: 0, move: 1, remove: 2, unreserve: 3, add: 4 };
  return [...proposals, ...reserveProposals(from, to)].sort(
    (a, b) => rank[a.kind] - rank[b.kind] || a.volunteerName.localeCompare(b.volunteerName),
  );
}

/**
 * Who joins the reserve and who leaves it.
 *
 * These are the heaviest lines in the batch, so they say what they mean: going on reserve is
 * being told the event has no hours left to offer, and coming off it is being called up.
 */
function reserveProposals(from: PlanIndex, to: PlanIndex): Proposal[] {
  const was = new Set(from.plan.reserve);
  const now = new Set(to.plan.reserve);
  const out: Proposal[] = [];

  for (const volunteer of to.plan.volunteers) {
    const name = to.volunteerName(volunteer.key);
    if (now.has(volunteer.key) && !was.has(volunteer.key)) {
      out.push({
        kind: 'reserve',
        volunteerKey: volunteer.key,
        volunteerName: name,
        fromShiftKey: null,
        toShiftKey: null,
        rationale: `Met ${name} en liste d'attente: plus aucun créneau disponible ne lui convient. ` +
                   `À prévenir de ce statut de renfort, et à rappeler au premier désistement.`,
      });
    } else if (!now.has(volunteer.key) && was.has(volunteer.key)) {
      const hours = to.hoursOf(volunteer.key);
      out.push({
        kind: 'unreserve',
        volunteerKey: volunteer.key,
        volunteerName: name,
        fromShiftKey: null,
        toShiftKey: null,
        rationale: hours > 0
          ? `Sort ${name} de la liste d'attente: ${fmtHours(hours)} lui sont maintenant proposées.`
          : `Sort ${name} de la liste d'attente, mais sans lui donner de créneau. À vérifier.`,
      });
    }
  }

  return out;
}

/** A rank as the régisseur reads it: "son choix 2", or "un pôle non choisi" for null. */
const choiceLabel = (index: PlanIndex, rank: number | null): string =>
  rank === null ? 'un pôle non choisi'
  : index.plan.poleChoicesRanked === false ? 'un de ses choix'
  : `son choix ${rank + 1}`;

function moveReason(
  from: PlanIndex,
  to: PlanIndex,
  volunteerKey: string,
  departure: { poleKey: string; key: string },
  arrival: { poleKey: string; key: string },
): string {
  const volunteer = to.volunteerByKey.get(volunteerKey)!;
  const was = from.rankOf(volunteer, departure.poleKey);
  const now = to.rankOf(volunteer, arrival.poleKey);

  const order = (rank: number | null): number => rank ?? Number.POSITIVE_INFINITY;
  if (order(now) < order(was)) {
    return `Plus proche de ${choiceLabel(to, now)} (était sur ${choiceLabel(from, was)}).`;
  }

  const joined = newBuddy(from, to, volunteerKey, arrival.key);
  if (joined) return `Permet d'être avec ${joined}, comme demandé.`;

  const arrivalShift = to.shiftByKey.get(arrival.key);
  if (from.assigneeCount(arrival.key) < (arrivalShift ? to.headcountOf(arrivalShift) : 0)) {
    return 'Comble un créneau qui manquait de monde.';
  }
  return 'Réoptimisation: le reste du planning gagne plus que ce déplacement ne coûte.';
}

function addReason(
  from: PlanIndex,
  to: PlanIndex,
  volunteerKey: string,
  arrival: { key: string; headcount: number },
  hoursBefore: number,
  hoursAfter: number,
): string {
  const floor = to.rules.minHoursPerPerson;
  if (hoursBefore < floor && hoursAfter >= floor) {
    return `Lui fait atteindre le plancher de ${floor}h (${hoursBefore}h auparavant).`;
  }
  if (hoursBefore === 0) return 'Ce bénévole n\'avait aucun créneau.';

  const joined = newBuddy(from, to, volunteerKey, arrival.key);
  if (joined) return `Permet d'être avec ${joined}, comme demandé.`;

  const missing = arrival.headcount - from.assigneeCount(arrival.key);
  if (missing > 0) return `Il manquait ${missing} personne(s) sur ce créneau.`;
  return 'Réoptimisation.';
}

/** A buddy this volunteer now shares a shift with and did not before. */
function newBuddy(from: PlanIndex, to: PlanIndex, volunteerKey: string, shiftKey: string): string | null {
  for (const pair of to.plan.buddies) {
    const other = pair.fromKey === volunteerKey ? pair.toKey
                : pair.toKey === volunteerKey ? pair.fromKey
                : null;
    if (!other) continue;
    const togetherNow = to.shiftsOf(other).some((s) => s.key === shiftKey);
    if (!togetherNow) continue;
    const togetherBefore = from.shiftsOf(volunteerKey).some((s) =>
      from.shiftsOf(other).some((t) => t.key === s.key),
    );
    if (!togetherBefore) return to.volunteerName(other);
  }
  return null;
}

/** One line per kind, for the CLI and for the batch header in the UI. */
export function summariseProposals(proposals: readonly Proposal[]): string {
  const counts = { move: 0, remove: 0, add: 0, reserve: 0, unreserve: 0 } as Record<ProposalKind, number>;
  for (const p of proposals) counts[p.kind]++;
  return `${proposals.length} propositions : ${counts.add} ajouts, ` +
         `${counts.move} déplacements, ${counts.remove} retraits, ` +
         `${counts.reserve} mises en liste d'attente, ${counts.unreserve} rappels`;
}


// ---------------------------------------------------------------------------
// Grouping into decisions instead of lines
// ---------------------------------------------------------------------------

/**
 * A batch of proposals, cut into decisions the régisseur can actually take.
 *
 * Accepting one line at a time turned out to be the wrong unit. Swapping two people is two
 * moves, and accepting either alone leaves a shift over its headcount until the other is
 * accepted too, so the régisseur ends up hunting through the rest of the list for the line that
 * cancels the problem they just created.
 *
 * THE DEPENDENCY IS DIRECTED, and that is the whole trick. If A takes the place B gives up, A
 * needs B; B does not need A. Treating that as a symmetric link merges the entire batch into
 * one lump through shifts that happen to be full, which is exactly what a first attempt here
 * did: 78 proposals came back as one group of 65 plus ten singletons. Directed, the same batch
 * cuts into small groups with explicit prerequisites, and the two-line exchange the régisseur
 * had in mind falls out on its own, as a cycle of length two.
 *
 * So a group is a set of proposals that need each other in a circle, and `requires` names the
 * groups it needs taken first. Accept a group and the tool pulls its prerequisites in with it.
 */
export interface ProposalGroup {
  /** Position in the batch. Groups are numbered so prerequisites can point at each other. */
  id: number;
  /** French, one line: what accepting this group does. */
  title: string;
  /** The heaviest kind in the group, which is what it is sorted and coloured by. */
  kind: ProposalKind;
  proposals: Proposal[];
  /** Ids of the groups that must be accepted for this one to be applicable on its own. */
  requires: number[];
}

/**
 * Why "same volunteer, or same shift with no room to spare" is the whole of the dependency.
 *
 * Every tier 1 rule is scoped either to one volunteer or to one shift: overlap, consecutive
 * hours, block count, break, requested volume and refusals are all properties of one person's
 * day, and over-staffing is a property of one shift. Two proposals sharing neither cannot make
 * each other illegal, so they never need to be decided together.
 */
const KIND_RANK: Record<ProposalKind, number> =
  { reserve: 0, move: 1, remove: 2, unreserve: 3, add: 4 };

/** The shifts a proposal takes a place on, and the shifts it gives one back. */
function touches(proposal: Proposal, before: PlanIndex): { fills: string[]; frees: string[] } {
  switch (proposal.kind) {
    case 'add':
      return { fills: proposal.toShiftKey ? [proposal.toShiftKey] : [], frees: [] };
    case 'remove':
      return { fills: [], frees: proposal.fromShiftKey ? [proposal.fromShiftKey] : [] };
    case 'move':
      return {
        fills: proposal.toShiftKey ? [proposal.toShiftKey] : [],
        frees: proposal.fromShiftKey ? [proposal.fromShiftKey] : [],
      };
    case 'reserve':
      // Going on reserve gives up every shift the person currently holds, so it frees them all.
      return { fills: [], frees: before.shiftsOf(proposal.volunteerKey).map((s) => s.key) };
    default:
      return { fills: [], frees: [] };
  }
}

/** "Échange entre Marie Perrin et Yann Duval", or "Permutation à 3". */
function titleFor(group: readonly Proposal[]): string {
  const first = group[0]!;
  if (group.length === 1) {
    switch (first.kind) {
      case 'reserve':
        return `Mise en liste d'attente de ${first.volunteerName}`;
      case 'unreserve':
        return `Rappel de ${first.volunteerName}`;
      case 'move':
        return `Déplacement de ${first.volunteerName}`;
      case 'remove':
        return `Retrait de ${first.volunteerName}`;
      default:
        return `Ajout de ${first.volunteerName}`;
    }
  }

  const names = [...new Set(group.map((p) => p.volunteerName))];
  const allMoves = group.every((p) => p.kind === 'move');

  if (allMoves && names.length === 2 && group.length === 2) {
    return `Échange entre ${names[0]} et ${names[1]}`;
  }
  if (names.length === 1) {
    return `${group.length} changements pour ${names[0]}`;
  }
  const who = names.length <= 3 ? names.join(', ') : `${names.length} bénévoles`;
  return allMoves
    ? `Permutation à ${names.length}: ${who}`
    : `${group.length} changements liés: ${who}`;
}

/**
 * Cuts a batch into groups, with the prerequisites between them.
 *
 * `before` must be the plan the proposals were computed against: whether two lines on the same
 * shift depend on each other is a question about how much room that shift has right now.
 */
export function groupProposals(before: Plan, proposals: readonly Proposal[]): ProposalGroup[] {
  const index = new PlanIndex(before);
  const n = proposals.length;
  if (n === 0) return [];

  // Every line about one person travels with the rest of their day, whichever way it points.
  // That merge happens first, so the directed graph below is built over whole people.
  const unitOf = new Map<string, number>();
  const owner: number[] = [];
  for (let i = 0; i < n; i++) {
    const key = proposals[i]!.volunteerKey;
    let unit = unitOf.get(key);
    if (unit === undefined) {
      unit = unitOf.size;
      unitOf.set(key, unit);
    }
    owner[i] = unit;
  }
  const unitCount = unitOf.size;

  const fillsOf = new Map<string, number[]>();
  const freesOf = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const { fills, frees } = touches(proposals[i]!, index);
    const unit = owner[i]!;
    for (const key of fills) fillsOf.set(key, [...(fillsOf.get(key) ?? []), unit]);
    for (const key of frees) freesOf.set(key, [...(freesOf.get(key) ?? []), unit]);
  }

  // A unit taking a place on a shift with no room to spare needs the units that give one back.
  const needs: Array<Set<number>> = Array.from({ length: unitCount }, () => new Set<number>());
  for (const [shiftKey, fills] of fillsOf) {
    const shift = index.shiftByKey.get(shiftKey);
    if (!shift) continue;
    const slack = shift.headcount - index.assigneeCount(shiftKey);
    if (fills.length <= slack) continue;
    for (const filler of fills) {
      for (const freer of freesOf.get(shiftKey) ?? []) {
        if (freer !== filler) needs[filler]!.add(freer);
      }
    }
  }

  const components = stronglyConnected(needs);

  const componentOf: number[] = [];
  components.forEach((units, c) => units.forEach((unit) => (componentOf[unit] = c)));

  const bucket: Proposal[][] = components.map(() => []);
  for (let i = 0; i < n; i++) bucket[componentOf[owner[i]!]!]!.push(proposals[i]!);

  const componentNeeds: Array<Set<number>> = components.map(() => new Set<number>());
  needs.forEach((targets, unit) => {
    const from = componentOf[unit]!;
    for (const target of targets) {
      const to = componentOf[target]!;
      if (to !== from) componentNeeds[from]!.add(to);
    }
  });

  const built = components.map((_, c) => ({
    group: [...bucket[c]!].sort(
      (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.volunteerName.localeCompare(b.volunteerName),
    ),
    needs: componentNeeds[c]!,
  }));

  // Reserve first, because those are the only lines that mean telling somebody they are not
  // needed. Then the groups that depend on nothing, so the list opens on what can be taken now.
  const order = built
    .map((entry, c) => ({ entry, c }))
    .sort((a, b) => {
      const ka = KIND_RANK[a.entry.group[0]!.kind];
      const kb = KIND_RANK[b.entry.group[0]!.kind];
      return (
        ka - kb ||
        a.entry.needs.size - b.entry.needs.size ||
        b.entry.group.length - a.entry.group.length ||
        titleFor(a.entry.group).localeCompare(titleFor(b.entry.group))
      );
    });

  const idOf = new Map<number, number>();
  order.forEach((entry, id) => idOf.set(entry.c, id));

  return order.map(({ entry }, id) => ({
    id,
    title: titleFor(entry.group),
    kind: entry.group[0]!.kind,
    proposals: entry.group,
    requires: [...entry.needs].map((c) => idOf.get(c)!).sort((a, b) => a - b),
  }));
}

/**
 * Tarjan's strongly connected components, iterative.
 *
 * A cycle in "needs" is a set of changes that can only happen together: the plainest case is two
 * people swapping shifts, where each needs the place the other gives up. Anything not in a cycle
 * stands alone and merely names what it needs taken first. Iterative rather than recursive
 * because a long cascade of moves is a long path, and a batch is not bounded in size.
 */
function stronglyConnected(edges: ReadonlyArray<ReadonlySet<number>>): number[][] {
  const n = edges.length;
  const index = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  const out: number[][] = [];
  let counter = 0;

  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;

    const work: Array<{ node: number; next: number[]; at: number }> = [
      { node: root, next: [...edges[root]!], at: 0 },
    ];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = true;

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      if (frame.at < frame.next.length) {
        const child = frame.next[frame.at++]!;
        if (index[child] === -1) {
          index[child] = low[child] = counter++;
          stack.push(child);
          onStack[child] = true;
          work.push({ node: child, next: [...edges[child]!], at: 0 });
        } else if (onStack[child]) {
          low[frame.node] = Math.min(low[frame.node]!, index[child]!);
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) low[parent.node] = Math.min(low[parent.node]!, low[frame.node]!);

      if (low[frame.node] === index[frame.node]) {
        const component: number[] = [];
        for (;;) {
          const popped = stack.pop()!;
          onStack[popped] = false;
          component.push(popped);
          if (popped === frame.node) break;
        }
        out.push(component);
      }
    }
  }

  return out;
}
