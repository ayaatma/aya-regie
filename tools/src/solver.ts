/**
 * The solver.
 *
 * Shape of the thing: a greedy construction, then iterated local search by ruin and recreate.
 * No dependency, no external solver, runs client side in a couple of seconds on the real size
 * of this event (about 130 volunteers, 91 shifts, 600 person-hours).
 *
 * THE TWO PROMISES.
 *
 *   1. It never produces a tier 1 issue. Every single placement goes through `isLegal`, which is
 *      the same code `validate()` uses. The solver owns no copy of the scheduling rules.
 *   2. It never returns "infeasible". Tier 2 problems are priced in the objective, not forbidden,
 *      so a plan always comes back, and the validator paints the remaining problems red. That is
 *      what a régisseur needs: the least-bad plan, with the damage listed.
 *
 * THE OBJECTIVE is a weighted sum of penalties, lower is better, and it is deliberately not
 * lexicographic. The ranking from the brief falls out of the weights:
 *
 *      1  every volunteer reaches the 4h floor, or is
 *         openly held in reserve rather than forgotten   floorBelow, floorPerHour, reserve
 *      2  every shift is staffed                        staffing
 *      3  no shift of nothing but débutants             allDebutants, minExperienced
 *      4  choice 1, then choice 2, never outside        choice2, outsideChoice
 *      5  every volunteer reaches the volume asked      volume
 *      6  buddy pairs honoured                          buddy
 *      7  débutants spread out                          debutantStacking
 *      8  stay close to the plan already in place       stability
 *
 * Ranks 1 and 2 sit close together on purpose: under a shortage the 4h floor is unreachable
 * anyway and staffing dominates, so their relative order is moot in practice.
 *
 * THE WEIGHTS ARE THE EVENT'S since 2026-09-13. `solve` reads them from `Plan.constraints`
 * through `weightsFor`, and `SolveOptions.weights` still overrides them for the measurement
 * CLIs. A criterion the event made blocking costs nothing here because `isLegal` never lets it
 * happen; one it switched off costs nothing either. Six rules that could only block before (a
 * refused pole, a refused hour, the volume ceiling and the three rhythm rules) have a price of
 * their own now, zero on every event that leaves them blocking.
 *
 * INCREMENTAL RE-SOLVE is not a second algorithm. `solve()` starts from the assignments already
 * in the plan, never touches a locked one, and pays `stability` for every change it makes. Feed
 * it a plan after a shift is added or a volunteer cancels and it repairs locally instead of
 * reshuffling everything. `proposals.ts` turns the difference into the add/remove/move list the
 * régisseur validates.
 */

import { preferenceMisfit, preferredSlot } from './availability.js';
import {
  DEFAULT_CONSTRAINTS,
  priceOf,
  resolveConstraints,
  type ResolvedConstraints,
} from './constraints.js';
import { Rng } from './rng.js';
import {
  type Artist,
  type EventSlot,
  type PreferenceSlot,
  type SchedulingRules,
  type Shift,
  type SkillLevel,
  type Volunteer,
  type Window,
} from './model.js';
import { PlanIndex, buildBlocks, overlaps, type Assignment, type BuddyPair, type Plan } from './plan.js';
import { isLegal, type LegalityContext } from './validate.js';

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

export interface SolverWeights {
  /**
   * Fixed penalty for finishing under the 4h floor, whatever the shortfall. Rank 1.
   *
   * Fixed and not per hour, and that is the whole point. A per-hour floor cannot tell "four
   * people at 2h" from "two people at 4h and two at nothing": both are eight hours short, both
   * cost the same, and the solver shrugs and spreads. A fixed penalty says what the rule
   * actually says, which is that 4h is a threshold and reaching it is what counts.
   */
  floorBelow: number;
  /** Small per-hour term under the floor, so 3h is still better than 1h. Tie-break only. */
  floorPerHour: number;
  /**
   * Cost of putting one volunteer on reserve. Rank 1, and cheaper than forgetting them.
   *
   * Reserve is the honest answer to more registrations than the event has hours for: the person
   * is told they are the backup, rather than handed a token 2h so the plan looks tidy. It must
   * stay dearer than finding them real work and cheaper than leaving them at zero with no
   * explanation, which is what the numbers below encode.
   */
  reserve: number;
  /** Per missing person-hour on a shift. Rank 2. */
  staffing: number;
  /** Per full shift holding no experienced volunteer at all. Rank 3. */
  allDebutants: number;
  /** Per experienced volunteer a pole requires and does not get. Rank 3. */
  minExperienced: number;
  /**
   * Per hour per rank below the first choice. Rank 4. The name predates N choices: with two, a
   * rank below the first IS choice 2. See `CRITERIA.notChoice1`.
   */
  choice2: number;
  /**
   * Per hour in a pole the volunteer chose none of, ON TOP of the rank steps. Rank 4. It was the
   * whole price until 2026-09-14 (800); the rank part is `choice2` since.
   */
  outsideChoice: number;
  /** Per hour missing under the volume the volunteer asked for. Rank 5. */
  volume: number;
  /**
   * Per time-contiguous block a volunteer spends across more than one pole. Rank 2.
   *
   * Four hours straight at the bar is one job. Two hours at the bar then two on the gate is two
   * jobs, two briefings and two sets of colleagues, for the same four hours on the plan. The
   * plan cannot see the difference; the person doing it can. This is the term that makes the
   * solver prefer the first, and it is deliberately an order of magnitude above every quality
   * term below it.
   *
   * It sits under `staffing` on purpose. A shift left short is worse than a split block, so a
   * volunteer is still moved across poles when that is what fills a hole.
   */
  poleFragmentation: number;
  /**
   * Per block beyond the fewest the volunteer's hours actually require. Rank 2.
   *
   * Someone down for 4 h can do them in one block or in two; the rules allow both and the plan
   * scores the same. This says the single block is better. Someone down for 8 h needs two
   * blocks because the consecutive cap is 4 h, so they pay nothing for the second: the term
   * charges only for splitting that was not forced.
   */
  blockSplit: number;
  /**
   * Per buddy request left unhonoured. Rank 6 in the brief, raised on request 2026-09-07 to
   * outrank pole choice.
   *
   * It must stay BELOW what the smallest staffing hole costs. `staffing` is 3000 a person-hour,
   * so a 2 h gap is 6000: at or above that, the solver starts leaving shifts short to put
   * friends together, which inverts rank 2 over rank 6 and is not what anybody asked for.
   * Measured at 12000 it does exactly that, 7 h of coverage traded for pairings.
   *
   * Nothing needs to protect a refused pole from this. That is a tier 1 rule, so no weight can
   * reach it, which the measurement below confirms column by column.
   */
  buddy: number;
  /** Per débutant-hour beyond half a shift's headcount. Rank 7. */
  debutantStacking: number;
  /** Per assignment added or removed against the plan already in place. Rank 8. */
  stability: number;
  /** Per hour spent during an artist the volunteer asked not to miss. */
  artist: number;
  /**
   * Per hour², so the cost of an "après-midi" answer stretching into the evening grows with
   * the distance past the boundary. Applies only inside the overflow the régisseur accepts.
   */
  overflow: number;
  /**
   * Per hour worked flatly against what the volunteer answered they would rather do. Rank 4.
   *
   * THIS WEIGHT REPLACES A TIER 1 RULE, which is the only reason its size needs an argument.
   * Until 2026-09-08 an "après-midi" answer past the overflow limit, and a "soirée" answer
   * before the boundary, were illegal: the solver would sooner leave a shift empty than make
   * either placement, every time and without saying so.
   *
   * It sits deliberately between `outsideChoice` (800) and `staffing` (3000). Above the pole
   * choice, because when somebody works matters more to them than which pole they land in.
   * Below staffing, because that is the entire point of the change: a shift about to go short
   * outranks a preference, and nothing else does. Keep it under `buddy` (5000) too, so that
   * pairing two friends is never worth dragging one of them across the boundary.
   *
   * Set by measurement, `npm run preference` re-runs it. 1000 iterations, five seeds averaged,
   * "contre" being person-hours worked flatly against a stated answer:
   *
   *              balanced                    shortage-moderate
   *      poids   créneaux  manque  contre    créneaux  manque  contre
   *          0   90.2/91       2h    186h     73.2/91    119h    143h
   *        400   89.2/91       7h    146h     73.8/91    120h    118h
   *       1500   89.2/91       5h     95h     75.8/91    121h     94h   <-
   *       3000   88.2/91      14h     63h     74.0/91    126h     66h
   *       6000   85.4/91      34h     51h     73.6/91    131h     48h
   *      20000   83.2/91      41h     39h     73.2/91    135h     35h
   *
   * 1500 is the last row that costs nothing. It halves the breaches against a weight of zero,
   * where the preference is decorative, and coverage is still where it was. From 3000 the
   * solver starts leaving shifts short to protect an answer, and by 6000 it is five créneaux
   * and 30 h down: that is the old hard rule coming back wearing a price tag, which is exactly
   * what this change was made to remove. The remaining breaches are structural, not a weight
   * problem, which is why 20000 buys so little.
   */
  againstPreference: number;
  /** Per hour in a refused pole, for an event that weighs the refusal rather than blocking it. */
  refusedPole: number;
  /** Per hour in a refused tranche or past the event's end, same condition. */
  availability: number;
  /** Per hour beyond the volume the volunteer asked for, same condition. */
  volumeOver: number;
  /** Per hour a block runs past the consecutive cap, same condition. */
  maxConsecutive: number;
  /** Per block beyond the maximum, same condition. */
  maxBlocks: number;
  /** Per hour of break missing between two blocks, same condition. */
  minBreak: number;
}

/**
 * The solver's prices for one event's Réglages avancés.
 *
 * Two mappings are not one to one. `floorPerHour` is not a criterion: it is the tie-break under
 * the floor and follows the floor's own weight, in the ratio the measured defaults had (30000 to
 * 2000). And `outsideChoice` is the SUM of the two pole criteria, because the régisseur's
 * "pas sur le choix 1" also covers a placement outside both choices; see `CRITERIA`.
 */
export function weightsFor(c: ResolvedConstraints): SolverWeights {
  const floor = priceOf(c.floor);
  return {
    floorBelow: floor,
    floorPerHour: floor / 15,
    reserve: priceOf(c.reserve),
    staffing: priceOf(c.staffing),
    poleFragmentation: priceOf(c.poleFragmentation),
    blockSplit: priceOf(c.blockSplit),
    allDebutants: priceOf(c.allDebutants),
    minExperienced: priceOf(c.minExperienced),
    outsideChoice: priceOf(c.outsideChoices),
    volume: priceOf(c.volumeUnder),
    artist: priceOf(c.artist),
    buddy: priceOf(c.buddy),
    choice2: priceOf(c.notChoice1),
    debutantStacking: priceOf(c.debutantStacking),
    overflow: priceOf(c.preferenceOverflow),
    againstPreference: priceOf(c.preference),
    stability: priceOf(c.stability),
    refusedPole: priceOf(c.refusedPole),
    availability: priceOf(c.availability),
    volumeOver: priceOf(c.volumeOver),
    maxConsecutive: priceOf(c.maxConsecutive),
    maxBlocks: priceOf(c.maxBlocks),
    minBreak: priceOf(c.minBreak),
  };
}

/**
 * Tunable, and meant to be tuned. The absolute values carry no meaning; only the ratios do.
 *
 * The one ratio that encodes a written rule: `staffing` (3000 per person-hour) must stay well
 * above `outsideChoice` (800 per hour), because the brief says never place someone outside
 * their two choices UNLESS that is the only way to fill a shift. Invert those two and the
 * solver starts leaving shifts empty out of politeness.
 *
 * Two of these were set by measurement rather than by argument, and both are real arbitrations
 * rather than technical details. Measured on `balanced+buddies`, 3000 iterations:
 *
 *   buddy, re-measured 2026-09-07 on `balanced+buddies`, 1000 iterations, five seeds, after the
 *   régisseur asked for pairings to outrank pole choice. The earlier numbers here were taken
 *   when `outsideChoice` was 120 and no longer describe anything.
 *
 *      100    17 of 110 honoured, choice 1 on 216 h, outside both choices 220 h, 33 h short
 *     3500    46 of 110,                    181 h,                       268 h, 36 h short
 *     5000    58 of 110,                    166 h,                       290 h, 35 h short  <-
 *     6000    58 of 110,                    161 h,                       294 h, 36 h short
 *    12000    69 of 110,                    157 h,                       305 h, 40 h short
 *
 * 5000 is where it stops paying to go higher: 6000 buys nothing more and costs choice quality,
 * and 12000 reaches 69 only by leaving 7 h of shifts unstaffed, which inverts rank 2 over rank 6.
 * The ceiling of 69 is structural, not a weight problem: the rest of the pairings are between
 * people whose halves, volumes or vetoes cannot be reconciled at all.
 *
 * Volunteers in a pole they refused stayed at zero across every one of those rows, because that
 * is a tier 1 rule and no weight can reach it. Raising this further is a decision about the
 * event, not about the code, and `npm run buddy` re-runs the table.
 *
 *   stability  measured on a re-solve after five volunteers cancel, out of 230 assignments:
 *              3 -> 83% kept, 45 proposals;  200 -> 92% kept, 26 proposals (the default);
 *            500 -> 97% kept, 14 proposals, but three shifts stay unstaffed that need not be.
 *
 * At 200 a move costs 400, so every proposal that survives is worth at least that much real
 * improvement. That is the useful property: the list handed to the régisseur holds no cosmetic
 * churn by construction.
 *
 *   poleFragmentation / blockSplit, and why outsideChoice moved with them. Measured on
 *   `balanced`, 1000 iterations, averaged over five seeds, because a single run of a stochastic
 *   search moves these figures by tens of hours and reading one seed produces confident
 *   nonsense. "Une seule place" is volunteers doing all their hours in one pole; "journée nette"
 *   adds turning up only as often as the consecutive cap forces.
 *
 *     0 / 0            une seule place 60/120, journée nette 46/120, manque 26 h, hors choix 218
 *   600 / 300                          74/120                62/120           27              260
 *  2500 / 1200                         84/120                74/120           30              277
 *  6000 / 3000                         86/120                76/120           39              238
 * 20000 / 10000                        97/120                84/120           51              219
 *
 * The tidiness is bought, and up to 2500 it is cheap: 4 h of coverage for 24 more volunteers
 * working in one place. Past that the price runs away, which is what "sits under staffing"
 * means in practice.
 *
 * What the middle column hides is that the solver was paying for tidiness by placing people
 * outside both their choices, which the brief forbids except to fill a shift. Raising
 * `outsideChoice` from 120 to 800 buys that back at no cost to the tidiness:
 *
 *  2500 / 1200, outsideChoice 800      85/120                73/120           34              217
 *
 * Same result, hours outside both choices back to the level of a plan with no tidiness weight
 * at all, and `staffing` still 3.75x above so a shift is never left short out of politeness.
 * The remaining 8 h of coverage is the real price of the whole thing, out of about 600.
 *
 * CHOICE 2 WENT FROM 20 TO 100 AN HOUR ON 2026-09-13, on the régisseur's remark that "le choix 2
 * d'un bénévole doit avoir moins de poids que son choix 1". It always had: 20 an hour is a
 * cost. But 20 sat BELOW the volume weight (60), which put rank 4 under rank 5 whenever the two
 * met, and the brief's order is the other way round. 100 puts it back above volume and still
 * eight times under `outsideChoice`, so a second choice never becomes a reason to leave a pole.
 * Measured over four seeds and 6000 iterations (`choix1 / choix2 / hors choix / gap / binômes`):
 *
 *   balanced           20: 200 / 154 / 237 / 3.0 / 18.0    100: 199 / 156 / 237 / 2.3 / 19.8
 *   shortage-moderate  20: 138 / 149 / 186 / 121.5 / 17.8  100: 160 / 151 / 161 / 121.5 / 15.5
 *
 * Within noise on the balanced scenario, a little better on the shortage. 200 was tried too and
 * started costing binômes (17.0) and the 4h floor (0.5 people) on balanced for nothing in
 * return. The lever is small because which choice a person lands in is mostly decided by the
 * hours on offer in the poles they asked for, not by this weight.
 */
// SINCE 2026-09-13 THESE ARE DERIVED, from the defaults of `CRITERIA` in `constraints.ts`, so
// the table the régisseur sees and the one measured above cannot drift. Literally, they are
// floorBelow 30000, floorPerHour 2000, reserve 20000, staffing 3000, poleFragmentation 2500,
// blockSplit 1200, allDebutants 600, minExperienced 600, outsideChoice 700 (plus one rank step
// of 100: the 800 measured above), volume 60, artist 50,
// buddy 5000, choice2 100, debutantStacking 8, overflow 6, againstPreference 1500, stability 200,
// and zero for the six rules that block by default. `solver.test.ts` holds them to it.
export const DEFAULT_WEIGHTS: SolverWeights = weightsFor(resolveConstraints(DEFAULT_CONSTRAINTS));

// ---------------------------------------------------------------------------
// Working state
// ---------------------------------------------------------------------------

/** What a given volunteer in a given shift costs, in the parts that never change. */
interface Placement {
  shift: Shift;
  volunteerKey: string;
  /** Hours of this shift times the rank steps it costs; see `CRITERIA.notChoice1`. */
  rankHours: number;
  /** True when the shift honours none of the volunteer's choices. */
  outside: boolean;
  level: SkillLevel | null;
  experienced: boolean;
  duration: number;
  /** Hours of this shift that fall inside an artist this volunteer named. */
  artistHours: number;
  /**
   * Integral of the distance past the boundary, inside the accepted overflow, so an
   * "après-midi" answer worked until 22h costs more than the same answer worked until 21h.
   */
  overflow: number;
  /** Hours of this shift that go against the volunteer's answer outright. */
  againstPreference: number;
  /** The shift's hours when it sits under a pole the volunteer refused, else 0. */
  refusedPoleHours: number;
  /** Hours of this shift in a tranche the volunteer refused or past the event's end. */
  unavailableHours: number;
}

interface VolunteerState {
  volunteer: Volunteer;
  shifts: Shift[];
  hours: number;
  choice2Hours: number;
  outsideHours: number;
  artistHours: number;
  overflow: number;
  againstPreference: number;
  refusedPoleHours: number;
  unavailableHours: number;
  anchor: ReadonlySet<string>;
  /** Assignments added or removed versus the anchor, kept up to date on every change. */
  changed: number;
  pairs: number[];
  /**
   * Every shift this volunteer could ever take, by shift key.
   *
   * Hung off the volunteer rather than kept in one map keyed by "volunteer|shift" because the
   * profiler was clear: building that composite key was the solver's single largest cost, ahead
   * of the scheduling rules themselves.
   */
  placements: Map<string, Placement>;
}

interface ShiftState {
  shift: Shift;
  duration: number;
  headcount: number;
  allowAllDebutants: boolean;
  minExperienced: number;
  assignees: Set<string>;
  experienced: number;
}


/**
 * The mutable plan the search works on, and the arbiter of what a change costs.
 *
 * It implements `LegalityContext`, which is how the solver asks the validator's own rules
 * whether a placement is allowed. Every aggregate a penalty needs is kept up to date on each
 * add and remove, so scoring one candidate placement is arithmetic on a handful of fields
 * rather than a walk over the plan. That is what makes a few million evaluations affordable.
 */
export class SolverState implements LegalityContext {
  readonly rules: SchedulingRules;
  readonly slots: readonly EventSlot[];
  readonly preferenceSlots: readonly PreferenceSlot[];
  readonly constraints: ResolvedConstraints;
  readonly base: PlanIndex;
  readonly weights: SolverWeights;
  score = 0;

  private readonly volunteers = new Map<string, VolunteerState>();
  private readonly shiftStates = new Map<string, ShiftState>();
  /** Volunteers who could ever legally take this shift, ignoring the rest of their day. */
  readonly eligibleFor = new Map<string, Placement[]>();
  readonly shiftsForVolunteer = new Map<string, Shift[]>();
  private readonly pairList: BuddyPair[] = [];
  private readonly pairShared: number[] = [];
  /**
   * Boxes the search may not touch, for any reason: a locked assignment or a locked pole.
   *
   * Kept apart from `ownLocks` below, which is the assignments own flag. A pole lock pins a box
   * for the duration of the search and must never come out the other side written into the box,
   * or unlocking the pole would leave every one of its places individually pinned forever.
   */
  private readonly pinned = new Set<string>();
  /** The `Assignment.locked` flags the plan came in with, and the ones it goes out with. */
  private readonly ownLocks = new Set<string>();
  /** Shifts belonging to a locked pole, or to anything under one. */
  private readonly frozenShifts = new Set<string>();
  private readonly reserved = new Set<string>();
  /** Stability only means something against a plan that exists. A first solve has no anchor. */
  private readonly anchored: boolean;

  constructor(plan: Plan, weights: SolverWeights, anchor: readonly Assignment[]) {
    this.rules = plan.rules;
    this.slots = plan.slots;
    this.preferenceSlots = plan.preferenceSlots;
    this.weights = weights;
    this.anchored = anchor.length > 0;
    this.base = new PlanIndex({ ...plan, assignments: [] });
    this.constraints = this.base.constraints;

    // Shifts the search must leave alone, because their pole is locked. A lock covers the whole
    // subtree: locking Bar locks Bar / Service and Bar / Plonge with it, the same way a refused
    // pole refuses its subtree.
    for (const shift of plan.shifts) {
      const pole = this.base.poleByKey.get(shift.poleKey);
      let current = pole;
      while (current) {
        if (current.locked) {
          this.frozenShifts.add(shift.key);
          break;
        }
        current = current.parentKey ? this.base.poleByKey.get(current.parentKey) : undefined;
      }
    }

    const anchorByVolunteer = new Map<string, Set<string>>();
    for (const a of anchor) {
      const set = anchorByVolunteer.get(a.volunteerKey) ?? new Set<string>();
      set.add(a.shiftKey);
      anchorByVolunteer.set(a.volunteerKey, set);
    }

    // Buddy pairs, deduplicated and stripped of self-requests, indexed from both ends so a
    // change to either member re-prices the pair.
    const pairsByVolunteer = new Map<string, number[]>();
    const seenPairs = new Set<string>();
    for (const pair of plan.buddies) {
      if (pair.fromKey === pair.toKey) continue;
      const canonical = [pair.fromKey, pair.toKey].sort().join('|');
      if (seenPairs.has(canonical)) continue;
      seenPairs.add(canonical);
      const i = this.pairList.length;
      this.pairList.push(pair);
      this.pairShared.push(0);
      for (const key of [pair.fromKey, pair.toKey]) {
        pairsByVolunteer.set(key, [...(pairsByVolunteer.get(key) ?? []), i]);
      }
    }

    for (const volunteer of plan.volunteers) {
      const anchorSet = anchorByVolunteer.get(volunteer.key) ?? new Set<string>();
      this.volunteers.set(volunteer.key, {
        volunteer,
        shifts: [],
        hours: 0,
        choice2Hours: 0,
        outsideHours: 0,
        artistHours: 0,
        overflow: 0,
        againstPreference: 0,
        refusedPoleHours: 0,
        unavailableHours: 0,
        anchor: anchorSet,
        changed: anchorSet.size,
        pairs: pairsByVolunteer.get(volunteer.key) ?? [],
        placements: new Map(),
      });
      this.shiftsForVolunteer.set(volunteer.key, []);
    }

    for (const shift of plan.shifts) {
      const pole = this.base.poleByKey.get(shift.poleKey);
      this.shiftStates.set(shift.key, {
        shift,
        duration: shift.end - shift.start,
        // What is left for volunteers: an orga the régisseur put here already holds a place,
        // and the solver must not offer it to anybody. See `PlanIndex.headcountOf`.
        headcount: this.base.headcountOf(shift),
        allowAllDebutants: pole?.allowAllDebutants ?? false,
        minExperienced: pole?.minExperienced ?? 0,
        assignees: new Set(),
        experienced: 0,
      });

      // Eligibility is asked of the validator's own rules on an empty plan, so it captures
      // exactly the reasons that can never change: the veto and the availability answers.
      const eligible: Placement[] = [];
      for (const volunteer of plan.volunteers) {
        if (!isLegal(this.base, volunteer, shift)) continue;
        const placement = this.buildPlacement(volunteer, shift);
        eligible.push(placement);
        this.volunteers.get(volunteer.key)!.placements.set(shift.key, placement);
        this.shiftsForVolunteer.get(volunteer.key)!.push(shift);
      }
      this.eligibleFor.set(shift.key, eligible);
    }

    for (const state of this.shiftStates.values()) this.score += this.shiftPenalty(state);
    for (const state of this.volunteers.values()) this.score += this.volunteerPenalty(state);
    this.score += this.pairList.length * weights.buddy;
  }

  private buildPlacement(volunteer: Volunteer, shift: Shift): Placement {
    const level = this.base.levelIn(volunteer, shift.poleKey);
    let artistHours = 0;
    for (const artist of this.base.artistsClashing(volunteer, shift)) {
      artistHours += Math.min(shift.end, artist.end) - Math.max(shift.start, artist.start);
    }
    // The two halves of the preference cost, and they are shaped differently on purpose. The
    // tolerated overflow is quadratic in the distance past the slot's edge, so 21h is cheap and
    // 22h is not; anything past the accepted band is a flat per-hour price, because by then
    // the answer is simply not being respected and the exact hour stops mattering.
    const misfit = preferenceMisfit(
      preferredSlot(this.preferenceSlots, volunteer.preferredSlotId),
      shift,
    );
    const overflow = misfit.toleratedDistance;
    const duration = shift.end - shift.start;
    const rank = this.base.rankOf(volunteer, shift.poleKey);
    // Outside every choice costs one step past the last real one, never less than one step:
    // with two choices that is the single step the 800 of 2026-09 was measured with.
    const rankSteps = rank ?? (this.base.plan.poleChoicesRanked === false ? 0 : Math.max(1, volunteer.choices.length - 1));
    // Only an event that weighs these rather than blocking them ever reaches a placement where
    // they are not zero: a blocked one is absent from the eligibility lists.
    const refused = volunteer.refusedPoleKeys.some((root) => this.base.isUnder(shift.poleKey, root));
    let inside = 0;
    for (const w of this.base.windowsOf(volunteer.key)) {
      inside += Math.max(0, Math.min(w.end, shift.end) - Math.max(w.start, shift.start));
    }
    return {
      shift,
      volunteerKey: volunteer.key,
      rankHours: duration * rankSteps,
      outside: rank === null,
      level,
      experienced: level === 'intermediaire' || level === 'expert',
      duration: shift.end - shift.start,
      artistHours,
      overflow,
      againstPreference: misfit.against,
      refusedPoleHours: refused ? duration : 0,
      unavailableHours: Math.max(0, duration - inside),
    };
  }

  // --- LegalityContext -------------------------------------------------------------------

  shiftsOf(volunteerKey: string): readonly Shift[] {
    return this.volunteers.get(volunteerKey)?.shifts ?? [];
  }

  assigneeCount(shiftKey: string): number {
    return this.shiftStates.get(shiftKey)?.assignees.size ?? 0;
  }

  /**
   * The places left for volunteers. Read off this state rather than from the plan, because the
   * orgas were already taken out when the state was built, and because the search must see the
   * same number the validator will.
   */
  headcountOf(shift: Shift): number {
    return this.shiftStates.get(shift.key)?.headcount ?? shift.headcount;
  }

  windowsOf(volunteerKey: string): readonly Window[] {
    return this.base.windowsOf(volunteerKey);
  }

  isUnder(poleKey: string, rootKey: string): boolean {
    return this.base.isUnder(poleKey, rootKey);
  }

  polePath(poleKey: string): string {
    return this.base.polePath(poleKey);
  }

  shiftLabel(shift: Shift): string {
    return this.base.shiftLabel(shift);
  }

  label(hours: number): string {
    return this.base.label(hours);
  }

  rankOf(volunteer: Volunteer, poleKey: string): number | null {
    return this.base.rankOf(volunteer, poleKey);
  }

  artistsClashing(volunteer: Volunteer, window: Window): Artist[] {
    return this.base.artistsClashing(volunteer, window);
  }

  get dayMode(): boolean {
    return this.base.dayMode;
  }

  dayOf(hour: number): number {
    return this.base.dayOf(hour);
  }

  dayLabel(day: number): string {
    return this.base.dayLabel(day);
  }

  // --- Penalties -------------------------------------------------------------------------

  private shiftPenalty(state: ShiftState): number {
    const w = this.weights;
    const filled = state.assignees.size;
    let penalty = 0;

    const missing = state.headcount - filled;
    if (missing > 0) {
      penalty += w.staffing * missing * state.duration;
    } else {
      // Experience is judged on a full shift only, exactly as validate() reports it. An
      // incomplete shift is already paying the staffing penalty, which dwarfs these.
      if (state.experienced === 0 && !state.allowAllDebutants) penalty += w.allDebutants;
      const short = state.minExperienced - state.experienced;
      if (short > 0) penalty += w.minExperienced * short;
    }

    // Spreading débutants is a preference, so it applies whatever the fill state.
    const debutants = filled - state.experienced;
    const tolerated = Math.ceil(state.headcount / 2);
    if (debutants > tolerated) {
      penalty += w.debutantStacking * (debutants - tolerated) * state.duration;
    }

    return penalty;
  }

  /**
   * How broken up this volunteer's day is, as the two counts a volunteer would recognise.
   *
   * `poles` is how many different places they work. `blocks` is how many separate times they
   * turn up. Four hours straight at the bar is one and one; two hours at the bar and two on the
   * gate is two and one or two and two depending on whether they get a break in between.
   *
   * Written as a quadratic scan with no sorting and no allocation, because this runs inside
   * `mutate`, twice per candidate placement, a few million times per solve. A volunteer never
   * holds more than a handful of shifts, so the square is cheaper than a sort would be.
   */
  private fragmentation(shifts: readonly Shift[]): {
    blocks: number;
    poles: number;
    poleRuns: number;
  } {
    let blocks = 0;
    let poles = 0;
    let poleRuns = 0;

    for (let i = 0; i < shifts.length; i++) {
      const s = shifts[i]!;
      let precededInTime = false;
      let precededInSamePole = false;
      let poleSeenEarlier = false;

      for (let j = 0; j < shifts.length; j++) {
        if (i === j) continue;
        const t = shifts[j]!;
        // `t` runs into `s`: it starts earlier and reaches at least its start. Touching counts,
        // which is the whole point, since two adjacent shifts are one stretch of standing up.
        if (t.start < s.start && t.end >= s.start) {
          precededInTime = true;
          if (t.poleKey === s.poleKey) precededInSamePole = true;
        }
        // Each distinct pole is counted once, at its earliest shift. `j < i` breaks the tie
        // when two shifts of the same pole start at the same hour.
        if (t.poleKey === s.poleKey && (t.start < s.start || (t.start === s.start && j < i))) {
          poleSeenEarlier = true;
        }
      }

      if (!precededInTime) blocks++;
      if (!poleSeenEarlier) poles++;
      if (!precededInSamePole) poleRuns++;
    }

    return { blocks, poles, poleRuns };
  }

  private volunteerPenalty(state: VolunteerState): number {
    const w = this.weights;
    const { volunteer, hours } = state;
    let penalty = 0;

    // On reserve: no shift, and therefore none of the terms below apply. The cost of the
    // decision itself replaces them, so the search can weigh "hold them back" against "find
    // them something" on the same scale.
    if (this.reserved.has(volunteer.key)) {
      return w.reserve + (this.anchored ? w.stability * state.changed : 0);
    }

    // Per day on an event counted per day (see `days.ts`): the floor on every day somebody
    // works, the volume on every day they could, and the ceiling on every day at all. Zero hours
    // in total is still one floor missed, as on any event: nobody is left at nothing for free.
    const byDay = this.base.dayMode ? this.base.hoursByDay(state.shifts) : null;
    if (byDay === null) {
      const underFloor = this.rules.minHoursPerPerson - hours;
      if (underFloor > 0) penalty += w.floorBelow + w.floorPerHour * underFloor;
      const underVolume = volunteer.requestedHours - hours;
      if (underVolume > 0) penalty += w.volume * underVolume;
      if (w.volumeOver > 0 && hours > volunteer.requestedHours) {
        penalty += w.volumeOver * (hours - volunteer.requestedHours);
      }
    } else {
      if (hours <= 1e-9) penalty += w.floorBelow + w.floorPerHour * this.rules.minHoursPerPerson;
      for (const dayHours of byDay) {
        const under = this.rules.minHoursPerPerson - dayHours;
        if (dayHours > 1e-9 && under > 1e-9) penalty += w.floorBelow + w.floorPerHour * under;
        if (w.volumeOver > 0 && dayHours > volunteer.requestedHours) {
          penalty += w.volumeOver * (dayHours - volunteer.requestedHours);
        }
      }
      for (const day of this.base.availableDaysOf(volunteer)) {
        const under = volunteer.requestedHours - byDay[day]!;
        if (under > 0) penalty += w.volume * under;
      }
    }

    // Keeping the day in one place, and in one piece.
    //
    // The second term charges only for splitting that was not forced: someone down for 8 h
    // cannot do them in one block, because the consecutive cap is 4 h, and must not be
    // penalised for obeying it. Both counts are zero for a single unbroken shift, so a tidy
    // plan pays nothing here.
    if (state.shifts.length > 1) {
      const { blocks, poles, poleRuns } = this.fragmentation(state.shifts);
      // Working in a second place at all, and then again for changing place without even
      // getting a break out of it, which is the worst version of the same thing.
      penalty += w.poleFragmentation * (poles - 1 + poleRuns - blocks);
      const needed = byDay === null
        ? Math.ceil(hours / this.rules.maxConsecutiveHours - 1e-9)
        : byDay.reduce((n, h) => n + Math.ceil(h / this.rules.maxConsecutiveHours - 1e-9), 0);
      if (blocks > needed) penalty += w.blockSplit * (blocks - needed);
    }

    penalty += w.choice2 * state.choice2Hours;
    penalty += w.outsideChoice * state.outsideHours;
    penalty += w.artist * state.artistHours;
    penalty += w.overflow * state.overflow;
    penalty += w.againstPreference * state.againstPreference;
    penalty += w.refusedPole * state.refusedPoleHours;
    penalty += w.availability * state.unavailableHours;

    // The rhythm of the day, priced only on an event that made it a weight: on every other one
    // the three rules block and these prices are zero, so the blocks are never even built.
    if ((w.maxConsecutive > 0 || w.maxBlocks > 0 || w.minBreak > 0) && state.shifts.length > 0) {
      const blocks = buildBlocks(state.shifts);
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i]!;
        const over = block.end - block.start - this.rules.maxConsecutiveHours;
        if (over > 1e-9) penalty += w.maxConsecutive * over;
        if (i > 0) {
          const short = this.rules.minBreakHours - (block.start - blocks[i - 1]!.end);
          if (short > 1e-9) penalty += w.minBreak * short;
        }
      }
      if (byDay === null) {
        if (blocks.length > this.rules.maxBlocks) penalty += w.maxBlocks * (blocks.length - this.rules.maxBlocks);
      } else {
        const perDay = new Map<number, number>();
        for (const b of blocks) perDay.set(this.base.dayOf(b.start), (perDay.get(this.base.dayOf(b.start)) ?? 0) + 1);
        for (const n of perDay.values()) if (n > this.rules.maxBlocks) penalty += w.maxBlocks * (n - this.rules.maxBlocks);
      }
    }

    if (this.anchored) penalty += w.stability * state.changed;

    return penalty;
  }

  private pairPenalty(index: number): number {
    return this.pairShared[index]! > 0 ? 0 : this.weights.buddy;
  }

  // --- Mutation --------------------------------------------------------------------------

  private mutate(volunteerKey: string, shift: Shift, adding: boolean): void {
    const vs = this.volunteers.get(volunteerKey)!;
    const ss = this.shiftStates.get(shift.key)!;
    const placement = vs.placements.get(shift.key)!;

    let before = this.shiftPenalty(ss) + this.volunteerPenalty(vs);
    for (const i of vs.pairs) before += this.pairPenalty(i);

    const sign = adding ? 1 : -1;
    vs.hours += sign * placement.duration;
    vs.choice2Hours += sign * placement.rankHours;
    if (placement.outside) vs.outsideHours += sign * placement.duration;
    vs.artistHours += sign * placement.artistHours;
    vs.overflow += sign * placement.overflow;
    vs.againstPreference += sign * placement.againstPreference;
    vs.refusedPoleHours += sign * placement.refusedPoleHours;
    vs.unavailableHours += sign * placement.unavailableHours;
    vs.changed += (vs.anchor.has(shift.key) ? -sign : sign);
    if (placement.experienced) ss.experienced += sign;

    if (adding) {
      vs.shifts.push(shift);
      ss.assignees.add(volunteerKey);
    } else {
      const at = vs.shifts.findIndex((s) => s.key === shift.key);
      if (at >= 0) vs.shifts.splice(at, 1);
      ss.assignees.delete(volunteerKey);
    }

    for (const i of vs.pairs) {
      const pair = this.pairList[i]!;
      const other = pair.fromKey === volunteerKey ? pair.toKey : pair.fromKey;
      if (ss.assignees.has(other)) this.pairShared[i] = this.pairShared[i]! + sign;
    }

    let after = this.shiftPenalty(ss) + this.volunteerPenalty(vs);
    for (const i of vs.pairs) after += this.pairPenalty(i);

    this.score += after - before;
  }

  add(volunteerKey: string, shift: Shift): void {
    this.mutate(volunteerKey, shift, true);
  }

  remove(volunteerKey: string, shift: Shift): void {
    this.mutate(volunteerKey, shift, false);
  }

  /**
   * What adding this placement would cost, without keeping it.
   *
   * Deliberately implemented as add-measure-undo rather than as a second copy of the penalty
   * arithmetic: the estimate can then never disagree with what actually happens. The score is
   * written back rather than left to unwind, so repeated probing cannot accumulate drift.
   */
  deltaOfAdd(volunteerKey: string, shift: Shift): number {
    const before = this.score;
    this.add(volunteerKey, shift);
    const delta = this.score - before;
    this.remove(volunteerKey, shift);
    this.score = before;
    return delta;
  }

  /**
   * Places a volunteer whatever the rules say. Only ever used for a locked assignment.
   *
   * A lock is the régisseur's decision, and the tool's rule is that their decision stands and is
   * shown in red rather than quietly undone. So an illegal lock is carried into the plan and
   * left for validate() to flag. It stays safe for the search: the inflated headcount and the
   * volunteer's now-overlapping day make `isLegal` refuse everything further on that shift, so
   * the solver can only ever be more conservative around it, never less.
   *
   * The placement is built on demand, because an illegal one is by definition absent from the
   * eligibility lists.
   */
  forceAdd(volunteerKey: string, shift: Shift): void {
    const vs = this.volunteers.get(volunteerKey);
    if (!vs) return;
    if (!vs.placements.has(shift.key)) {
      vs.placements.set(shift.key, this.buildPlacement(vs.volunteer, shift));
    }
    if (vs.shifts.some((s) => s.key === shift.key)) return;
    this.mutate(volunteerKey, shift, true);
  }

  canAdd(volunteerKey: string, shift: Shift): boolean {
    // A locked pole is left exactly as it is, which means nobody new goes into it either.
    // Guarding here rather than in the search covers every operator at once: swap, relocate and
    // recreate all ask this question before they place anybody.
    if (this.frozenShifts.has(shift.key)) return false;
    const vs = this.volunteers.get(volunteerKey);
    if (!vs || !vs.placements.has(shift.key)) return false;
    return isLegal(this, vs.volunteer, shift);
  }

  freePlaces(shiftKey: string): number {
    const ss = this.shiftStates.get(shiftKey)!;
    return ss.headcount - ss.assignees.size;
  }

  hoursOf(volunteerKey: string): number {
    return this.volunteers.get(volunteerKey)?.hours ?? 0;
  }

  assigneesOf(shiftKey: string): ReadonlySet<string> {
    return this.shiftStates.get(shiftKey)?.assignees ?? new Set();
  }

  isReserve(volunteerKey: string): boolean {
    return this.reserved.has(volunteerKey);
  }

  /** Moves a volunteer in or out of the reserve. Reserving requires them to hold no shift. */
  setReserve(volunteerKey: string, on: boolean): void {
    const vs = this.volunteers.get(volunteerKey);
    if (!vs || this.reserved.has(volunteerKey) === on) return;
    if (on && vs.shifts.length > 0) return;

    const before = this.volunteerPenalty(vs);
    if (on) this.reserved.add(volunteerKey);
    else this.reserved.delete(volunteerKey);
    this.score += this.volunteerPenalty(vs) - before;
  }

  /** Reserves someone only if it makes the plan better. Returns whether it stuck. */
  trySetReserve(volunteerKey: string): boolean {
    const before = this.score;
    this.setReserve(volunteerKey, true);
    if (this.score < before - 1e-9) return true;
    this.setReserve(volunteerKey, false);
    this.score = before;
    return false;
  }

  /** The reserve list, in plan order so two identical runs write it identically. */
  toReserve(): string[] {
    return this.base.plan.volunteers.filter((v) => this.reserved.has(v.key)).map((v) => v.key);
  }

  /** A box the plan itself declares locked: pinned for the search, and still locked on the way out. */
  lock(volunteerKey: string, shiftKey: string): void {
    this.pinned.add(`${volunteerKey}|${shiftKey}`);
    this.ownLocks.add(`${volunteerKey}|${shiftKey}`);
  }

  /** A box pinned only because its pole is locked. Its own flag is left alone. */
  pin(volunteerKey: string, shiftKey: string): void {
    this.pinned.add(`${volunteerKey}|${shiftKey}`);
  }

  isLocked(volunteerKey: string, shiftKey: string): boolean {
    return this.pinned.has(`${volunteerKey}|${shiftKey}`);
  }

  /** True for a shift whose pole is locked, so nobody may be added to it either. */
  isFrozenShift(shiftKey: string): boolean {
    return this.frozenShifts.has(shiftKey);
  }

  /** The assignments as they stand, in a stable order so two identical runs write identical plans. */
  toAssignments(): Assignment[] {
    const out: Assignment[] = [];
    for (const shift of this.base.plan.shifts) {
      const ss = this.shiftStates.get(shift.key)!;
      for (const volunteer of this.base.plan.volunteers) {
        if (!ss.assignees.has(volunteer.key)) continue;
        // The box's own flag, not the search's pinning. A pole lock must not leak into here.
        const locked = this.ownLocks.has(`${volunteer.key}|${shift.key}`);
        out.push({
          volunteerKey: volunteer.key,
          shiftKey: shift.key,
          locked,
          source: locked ? 'manual' : 'solver',
        });
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SolveOptions {
  seed?: number;
  weights?: Partial<SolverWeights>;
  /** Ruin-and-recreate rounds. Iteration-based rather than time-based, so runs are reproducible. */
  iterations?: number;
  /** Safety valve only. Hitting it makes the run non-reproducible, and the result says so. */
  timeBudgetMs?: number;
  /** The plan to stay close to. Defaults to the assignments already in the plan. */
  anchor?: readonly Assignment[];
}

export interface DroppedAssignment {
  assignment: Assignment;
  /** French, for the proposal the régisseur reads. */
  reason: string;
}

export interface SolveResult {
  plan: Plan;
  score: number;
  /** Score of the starting point, before any search. Useful to see what the search bought. */
  initialScore: number;
  iterations: number;
  improvements: number;
  elapsedMs: number;
  timedOut: boolean;
  /** Existing assignments the solver refused to keep, each with the rule it broke. */
  dropped: DroppedAssignment[];
}

export function solve(plan: Plan, options: SolveOptions = {}): SolveResult {
  const started = Date.now();
  const weights = { ...weightsFor(resolveConstraints(plan.constraints)), ...options.weights };
  const anchor = options.anchor ?? plan.assignments;
  const iterations = options.iterations ?? 3000;
  const timeBudgetMs = options.timeBudgetMs ?? 20000;
  const rng = new Rng(options.seed ?? planSeed(plan));

  const state = new SolverState(plan, weights, anchor);
  const index = new PlanIndex(plan);
  const dropped: DroppedAssignment[] = [];

  // Seed from what is already there. A locked assignment goes in whatever it costs, because the
  // régisseur decided it. An unlocked one goes in only if it is legal; an illegal leftover is
  // handed back as a removal proposal rather than being carried forward or silently dropped.
  for (const assignment of plan.assignments) {
    const shift = index.shiftByKey.get(assignment.shiftKey);
    const volunteer = index.volunteerByKey.get(assignment.volunteerKey);
    if (!shift || !volunteer) {
      dropped.push({ assignment, reason: 'Référence inconnue: bénévole ou créneau supprimé depuis.' });
      continue;
    }
    if (assignment.locked) {
      state.lock(assignment.volunteerKey, assignment.shiftKey);
      state.forceAdd(assignment.volunteerKey, shift);
      continue;
    }
    // A pole the régisseur locked is carried over untouched, exactly as it stands, but its boxes
    // keep their own unlocked flag: unlocking the pole later must not leave every place in it
    // individually pinned. `pin` says "not during this search"; `lock` would say "never again".
    if (state.isFrozenShift(assignment.shiftKey)) {
      state.pin(assignment.volunteerKey, assignment.shiftKey);
      state.forceAdd(assignment.volunteerKey, shift);
      continue;
    }
    if (state.canAdd(assignment.volunteerKey, shift)) {
      state.add(assignment.volunteerKey, shift);
    } else {
      dropped.push({
        assignment,
        reason: `Affectation devenue illégale sur "${index.shiftLabel(shift)}".`,
      });
    }
  }

  // The reserve list is input like the assignments are. A volunteer listed as reserve who
  // nonetheless holds a shift is a contradiction in the data, and the work wins: they come off
  // the reserve, which the régisseur then sees as an "unreserve" proposal rather than as a
  // silent change.
  for (const key of plan.reserve) state.setReserve(key, true);

  recreate(state, rng, [...plan.shifts], 0);
  const initialScore = state.score;

  let best = state.toAssignments();
  let bestReserve = state.toReserve();
  let bestScore = state.score;
  let improvements = 0;
  let ran = 0;
  let timedOut = false;

  for (let i = 0; i < iterations; i++) {
    ran = i + 1;
    if (i % 64 === 0 && Date.now() - started > timeBudgetMs) {
      timedOut = true;
      break;
    }

    const { removed, unreserved } = ruin(state, rng);
    if (removed.length === 0 && unreserved.length === 0) continue;

    const added = recreate(state, rng, neighbourhood(state, rng, removed, unreserved), BLINK_RATE);

    if (state.score < bestScore - 1e-9) {
      bestScore = state.score;
      best = state.toAssignments();
      bestReserve = state.toReserve();
      improvements++;
    } else {
      // Undo exactly, in reverse, rather than rebuilding the state from the best plan.
      for (const [volunteerKey, shift] of added) state.remove(volunteerKey, shift);
      for (const [volunteerKey, shift] of removed) state.add(volunteerKey, shift);
      for (const key of unreserved) state.setReserve(key, true);
      state.score = bestScore;
    }

    // Swaps never change any shift's headcount, so the staffing and floor terms cancel out and
    // the lower-ranked ones decide. That is the only way choice, buddies and débutant spread
    // ever get a say: ruin and recreate always disturbs staffing, and next to a 3000-per-hour
    // swing a 120-per-hour choice improvement is invisible. Every swap kept is a strict
    // improvement, so the result can be folded straight into the best plan.
    if (i % SWAP_EVERY === 0 && swapDescent(state, rng)) {
      bestScore = state.score;
      best = state.toAssignments();
      bestReserve = state.toReserve();
      improvements++;
    }

    if (i % RESERVE_EVERY === 0 && reserveDescent(state)) {
      bestScore = state.score;
      best = state.toAssignments();
      bestReserve = state.toReserve();
      improvements++;
    }
  }

  return {
    plan: { ...plan, assignments: best, reserve: bestReserve },
    score: bestScore,
    initialScore,
    iterations: ran,
    improvements,
    elapsedMs: Date.now() - started,
    timedOut,
    dropped,
  };
}

type Placed = [volunteerKey: string, shift: Shift];

/** Odds of skipping a candidate during a recreate, so two rounds do not always agree. */
const BLINK_RATE = 0.08;
/** How often the swap descent runs. Every iteration is wasteful, never is worse. */
const SWAP_EVERY = 4;
/** How often the reserve descent runs. It is a whole-list scan, so rarely. */
const RESERVE_EVERY = 16;
/** Open shifts reconsidered per iteration, beyond the ones the ruin actually emptied. */
const NEIGHBOURHOOD_EXTRA = 10;

/**
 * The shifts worth reconsidering after a ruin: the ones just emptied, plus a sample of the
 * other open shifts the freed volunteers could reach.
 *
 * The sample is what keeps an iteration cheap. Under a shortage most shifts have a free place
 * at all times, so reconsidering every reachable one turns each iteration into a near-complete
 * rebuild. A small neighbourhood explored ten thousand times beats a large one explored a
 * thousand times.
 */
function neighbourhood(
  state: SolverState,
  rng: Rng,
  removed: readonly Placed[],
  unreserved: readonly string[] = [],
): Shift[] {
  const core = new Set<Shift>();
  for (const [, shift] of removed) core.add(shift);

  const reachable: Shift[] = [];
  const seen = new Set<string>([...core].map((s) => s.key));
  for (const volunteerKey of [...removed.map(([k]) => k), ...unreserved]) {
    for (const shift of state.shiftsForVolunteer.get(volunteerKey) ?? []) {
      if (seen.has(shift.key) || state.freePlaces(shift.key) === 0) continue;
      seen.add(shift.key);
      reachable.push(shift);
    }
  }

  return [...core, ...rng.sample(reachable, NEIGHBOURHOOD_EXTRA)];
}

/**
 * Fills every free place it can, cheapest first.
 *
 * Shifts are handled from the hardest to the easiest, measured by how many volunteers could
 * ever take them. Get that order backwards and the easy shifts eat the flexible volunteers,
 * leaving the hard ones empty for good.
 *
 * `blinkRate` is the diversification: each candidate is skipped with that probability, so two
 * rounds over the same shifts do not always reach the same answer. At 0 it is a plain greedy.
 */
function recreate(state: SolverState, rng: Rng, shifts: Shift[], blinkRate: number): Placed[] {
  const added: Placed[] = [];

  const order = shifts
    .filter((s) => state.freePlaces(s.key) > 0)
    .sort((a, b) => {
      const ea = state.eligibleFor.get(a.key)?.length ?? 0;
      const eb = state.eligibleFor.get(b.key)?.length ?? 0;
      return ea - eb || a.start - b.start || a.key.localeCompare(b.key);
    });

  for (const shift of order) {
    const candidates = state.eligibleFor.get(shift.key) ?? [];
    while (state.freePlaces(shift.key) > 0) {
      let bestKey: string | null = null;
      let bestDelta = Infinity;

      for (const placement of candidates) {
        if (blinkRate > 0 && rng.chance(blinkRate)) continue;
        if (!state.canAdd(placement.volunteerKey, shift)) continue;
        const delta = state.deltaOfAdd(placement.volunteerKey, shift);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestKey = placement.volunteerKey;
        }
      }

      // A placement that makes the plan worse is still taken when it fills a place: the staffing
      // weight already dominates, so a positive delta here means every candidate is costly, and
      // leaving the place empty was priced in and lost.
      if (bestKey === null) break;
      state.add(bestKey, shift);
      added.push([bestKey, shift]);
    }
  }

  return added;
}

// ---------------------------------------------------------------------------
// Swap descent
// ---------------------------------------------------------------------------

/**
 * Exchanges two volunteers between two shifts, and keeps it only if the plan gets better.
 *
 * Both shifts keep exactly the same number of people, which is the whole point: staffing and
 * the 4h floor come out unchanged, so the decision falls to choice, buddies, artists, débutant
 * spread and stability. Legality is re-asked for both crossed placements, on the state with
 * both people already lifted out, so a swap can never sneak past a rule.
 */
function trySwap(state: SolverState, aKey: string, a: Shift, bKey: string, b: Shift): boolean {
  if (a.key === b.key || aKey === bKey) return false;
  if (state.isLocked(aKey, a.key) || state.isLocked(bKey, b.key)) return false;

  const before = state.score;
  state.remove(aKey, a);
  state.remove(bKey, b);

  if (state.canAdd(aKey, b) && state.canAdd(bKey, a)) {
    state.add(aKey, b);
    state.add(bKey, a);
    if (state.score < before - 1e-9) return true;
    state.remove(aKey, b);
    state.remove(bKey, a);
  }

  state.add(aKey, a);
  state.add(bKey, b);
  state.score = before;
  return false;
}

/** Relocates one volunteer to a shift that has room, kept only if it improves things. */
function tryMove(state: SolverState, volunteerKey: string, from: Shift, to: Shift): boolean {
  if (from.key === to.key) return false;
  if (state.isLocked(volunteerKey, from.key)) return false;

  const before = state.score;
  state.remove(volunteerKey, from);
  if (state.canAdd(volunteerKey, to)) {
    state.add(volunteerKey, to);
    if (state.score < before - 1e-9) return true;
    state.remove(volunteerKey, to);
  }
  state.add(volunteerKey, from);
  state.score = before;
  return false;
}

const SWAP_ATTEMPTS = 12;

/**
 * A short burst of targeted exchanges. Returns true if anything stuck.
 *
 * The two targeted operators go straight at the measures ruin and recreate cannot move: someone
 * parked in a pole they never asked for, and a buddy request left unhonoured. The third is an
 * untargeted swap, which catches everything the first two do not think to look at.
 */
function swapDescent(state: SolverState, rng: Rng): boolean {
  const plan = state.base.plan;
  let improved = false;

  // Both work lists are built once per burst, not once per attempt. Rebuilding them inside the
  // loop was, measurably, where most of the solver's time went.
  const stranded: Placed[] = [];
  for (const volunteer of plan.volunteers) {
    for (const shift of state.shiftsOf(volunteer.key)) {
      if (state.base.choiceIndexOf(volunteer, shift.poleKey) === null) {
        stranded.push([volunteer.key, shift]);
      }
    }
  }

  const unhonoured = plan.buddies.filter((pair) => {
    const mine = state.shiftsOf(pair.fromKey);
    const theirs = state.shiftsOf(pair.toKey);
    if (mine.length === 0 || theirs.length === 0) return false;
    return !mine.some((s) => theirs.some((t) => t.key === s.key));
  });

  for (let attempt = 0; attempt < SWAP_ATTEMPTS; attempt++) {
    switch (rng.int(0, 2)) {
      case 0: {
        // Someone is in a pole they chose neither. Look for a place in a pole they did choose,
        // and offer whoever sits there their seat.
        if (stranded.length === 0) break;
        const [volunteerKey, here] = rng.pick(stranded);
        if (!state.shiftsOf(volunteerKey).some((s) => s.key === here.key)) break;
        const wanted = (state.shiftsForVolunteer.get(volunteerKey) ?? []).filter(
          (s) => state.base.choiceIndexOf(state.base.volunteerByKey.get(volunteerKey)!, s.poleKey) !== null,
        );
        if (wanted.length === 0) break;
        for (const there of rng.sample(wanted, 4)) {
          if (state.freePlaces(there.key) > 0 && tryMove(state, volunteerKey, here, there)) {
            improved = true;
            break;
          }
          const occupants = [...state.assigneesOf(there.key)];
          if (occupants.length === 0) continue;
          if (trySwap(state, volunteerKey, here, rng.pick(occupants), there)) {
            improved = true;
            break;
          }
        }
        break;
      }

      case 1: {
        // A buddy request nobody honoured. Try to put one of the two on a shift the other works.
        if (unhonoured.length === 0) break;
        const pair = rng.pick(unhonoured);
        const mine = state.shiftsOf(pair.fromKey);
        const theirs = state.shiftsOf(pair.toKey);
        if (mine.length === 0 || theirs.length === 0) break;
        if (mine.some((s) => theirs.some((t) => t.key === s.key))) break;

        const reachable = (state.shiftsForVolunteer.get(pair.fromKey) ?? []);
        for (const target of theirs) {
          if (!reachable.some((s) => s.key === target.key)) continue;
          const here = rng.pick([...mine]);
          if (state.freePlaces(target.key) > 0 && tryMove(state, pair.fromKey, here, target)) {
            improved = true;
            break;
          }
          const occupants = [...state.assigneesOf(target.key)].filter((k) => k !== pair.toKey);
          if (occupants.length === 0) continue;
          if (trySwap(state, pair.fromKey, here, rng.pick(occupants), target)) {
            improved = true;
            break;
          }
        }
        break;
      }

      default: {
        const a = rng.pick(plan.shifts);
        const b = rng.pick(plan.shifts);
        const occupantsA = [...state.assigneesOf(a.key)];
        const occupantsB = [...state.assigneesOf(b.key)];
        if (occupantsA.length === 0 || occupantsB.length === 0) break;
        if (trySwap(state, rng.pick(occupantsA), a, rng.pick(occupantsB), b)) improved = true;
        break;
      }
    }
  }

  return improved;
}

/**
 * Tears a hole in the plan. Five operators, each aimed at a different way of being stuck.
 *
 * `starved` is the one that earns its keep on a full event: it frees the shifts a volunteer at
 * zero hours could actually take, so the recreate has somewhere to put them. That is the brief's
 * "take hours back from the 8h volunteers to rescue someone at 0h", and it needs no special case
 * anywhere else because the floor weight does the rest.
 */
function ruin(state: SolverState, rng: Rng): { removed: Placed[]; unreserved: string[] } {
  const plan = state.base.plan;
  const removed: Placed[] = [];
  const unreserved: string[] = [];

  const strip = (volunteerKey: string): void => {
    for (const shift of [...state.shiftsOf(volunteerKey)]) {
      if (state.isLocked(volunteerKey, shift.key)) continue;
      state.remove(volunteerKey, shift);
      removed.push([volunteerKey, shift]);
    }
  };

  const clear = (shift: Shift): void => {
    for (const volunteerKey of [...state.assigneesOf(shift.key)]) {
      if (state.isLocked(volunteerKey, shift.key)) continue;
      state.remove(volunteerKey, shift);
      removed.push([volunteerKey, shift]);
    }
  };

  switch (rng.int(0, 5)) {
    case 0: {
      // A handful of volunteers put back on the market.
      for (const volunteer of rng.sample(plan.volunteers, rng.int(1, 4))) strip(volunteer.key);
      break;
    }
    case 1: {
      // One shift and its neighbours in the same pole, so a whole stretch can be rebuilt.
      const shift = rng.pick(plan.shifts);
      for (const other of plan.shifts) {
        if (other.poleKey === shift.poleKey && Math.abs(other.start - shift.start) <= 4) {
          clear(other);
        }
      }
      break;
    }
    case 2: {
      // Everything happening in one slice of the night, across poles.
      const from = rng.int(0, 16);
      const window = { start: from, end: from + rng.int(2, 5) };
      for (const shift of plan.shifts) if (overlaps(shift, window)) clear(shift);
      break;
    }
    case 3: {
      // Make room for someone the plan has left short.
      const starved = plan.volunteers.filter(
        (v) => state.hoursOf(v.key) < state.rules.minHoursPerPerson,
      );
      if (starved.length === 0) break;
      const victim = rng.pick(starved);
      const reachable = state.shiftsForVolunteer.get(victim.key) ?? [];
      if (reachable.length === 0) break;
      for (const shift of rng.sample(reachable, rng.int(1, 3))) clear(shift);
      break;
    }
    case 4: {
      // The shifts that are costing the most right now.
      const worst = [...plan.shifts]
        .filter((s) => state.freePlaces(s.key) === 0)
        .sort((a, b) => state.assigneeCount(b.key) - state.assigneeCount(a.key));
      const pool = worst.slice(0, 12);
      if (pool.length === 0) break;
      for (const shift of rng.sample(pool, rng.int(1, 2))) clear(shift);
      break;
    }
    default: {
      // Call someone back off the reserve and make room for them.
      //
      // Without this the reserve is a one-way door: the descent below only ever puts people on
      // it, and nothing would ever take them off again as the plan changes around them. This is
      // also, exactly, what happens on a re-solve after a cancellation.
      const reserved = plan.volunteers.filter((v) => state.isReserve(v.key));
      if (reserved.length === 0) break;
      const called = rng.pick(reserved);
      state.setReserve(called.key, false);
      unreserved.push(called.key);
      for (const shift of rng.sample(state.shiftsForVolunteer.get(called.key) ?? [], rng.int(1, 3))) {
        clear(shift);
      }
      break;
    }
  }

  return { removed, unreserved };
}

/**
 * Puts on reserve the volunteers the plan has genuinely nothing for. Returns true if any stuck.
 *
 * The guard is the important part: a volunteer is only ever offered to the reserve when they
 * hold no hours AND there is not one legal free place anywhere they could take. Reserve then
 * means "there is nothing for you", never "I could not be bothered to place you", and the
 * operator cannot fire on a shortage, where free places are everywhere.
 *
 * Every reservation still has to pay for itself against the objective, so it only happens when
 * holding someone back genuinely beats leaving them at zero.
 */
function reserveDescent(state: SolverState): boolean {
  let improved = false;

  for (const volunteer of state.base.plan.volunteers) {
    if (state.isReserve(volunteer.key)) continue;
    if (state.hoursOf(volunteer.key) > 0) continue;

    const somewhereToGo = (state.shiftsForVolunteer.get(volunteer.key) ?? []).some((shift) =>
      state.canAdd(volunteer.key, shift),
    );
    if (somewhereToGo) continue;

    if (state.trySetReserve(volunteer.key)) improved = true;
  }

  return improved;
}

/**
 * Re-solving until the search has nothing left to propose.
 *
 * A single `solve` returns one round of improvement, and the régisseur reasonably expects that
 * accepting everything leaves the plan at an optimum. It does not, for two reasons that are both
 * by design. The `stability` weight makes a round refuse any change worth less than twice its
 * cost, and once a round is accepted that cost is banked, so the next round can afford the next
 * tier of improvements. And the search is stochastic, so starting from a better plan explores
 * different neighbourhoods.
 *
 * Measured on four scenarios at 3000 iterations, it settles in four to eight rounds, and every
 * round shows a strictly positive gain: there is no churn to protect against, only rounds to
 * run. See `npm run converge`.
 *
 * LOCKED ASSIGNMENTS NEVER MOVE, in any round. That is not a property of this loop, it is a
 * property of `solve`, which refuses every mutation touching a locked box. Running it many times
 * cannot erode a guarantee it never relaxes once.
 *
 * Nothing is applied here either. The caller diffs the final plan against the one it started
 * from, and the régisseur still accepts or refuses each group of the result.
 */
export interface ConvergeOptions extends SolveOptions {
  /** Safety valve. Reaching it is reported, not hidden. */
  maxRounds?: number;
  /**
   * Wall-clock budget across all rounds.
   *
   * Generous on purpose. Measured at 3000 iterations a round: balanced settles in 28 s,
   * shortage-heavy in 10 s, surplus in 37 s, over-recruited needs about 65 s. Stopping on the
   * budget is reported as `converged: false`, and a plan that stops there may well be one whose
   * own search was never run, so a later re-solve can still find something. Which is exactly
   * what the screen then says.
   */
  totalTimeBudgetMs?: number;
  /**
   * How many different searches in a row must come back empty before the plan is called settled.
   *
   * One is not enough, and this was measured rather than guessed. A plan the loop declared
   * settled after a single quiet round still yielded proposals under three seeds out of seven,
   * with real gains. A stochastic search finding nothing once says something about that search,
   * not about the plan.
   */
  stableRounds?: number;
  /** Called after each round, so a run of twenty can show what it is doing. */
  onRound?: (info: { round: number; changed: boolean; elapsedMs: number }) => void;
}

export interface ConvergeResult {
  plan: Plan;
  /** Rounds actually run, including the last one that proposed nothing. */
  rounds: number;
  /** False when the loop stopped on the round cap or the time budget instead. */
  converged: boolean;
  elapsedMs: number;
  score: number;
  initialScore: number;
  /** Existing assignments the first round refused to keep, each with the rule it broke. */
  dropped: DroppedAssignment[];
}

export function solveToConvergence(plan: Plan, options: ConvergeOptions = {}): ConvergeResult {
  const started = Date.now();
  const maxRounds = options.maxRounds ?? 24;
  const budget = options.totalTimeBudgetMs ?? 120_000;
  const stableRounds = Math.max(1, options.stableRounds ?? 3);

  let current = plan;
  let rounds = 0;
  let converged = false;
  let score = 0;
  let initialScore = 0;
  /** Searches run on the current plan that found nothing. Reset the moment anything moves. */
  let quiet = 0;
  const dropped: DroppedAssignment[] = [];

  while (rounds < maxRounds) {
    // The first attempt on any plan uses that plan's own default seed, which is exactly the
    // search a manual "Recalculer" would run. Ending on a plan whose own search found nothing
    // is what makes the promise real rather than lucky. The later attempts offset it, so each
    // one is a genuinely different search of the same plan rather than a repeat of the last.
    const base = options.seed ?? planSeed(current);
    const result = solve(current, { ...options, seed: base + quiet * 7919 });
    rounds++;

    if (rounds === 1) initialScore = result.initialScore;
    score = result.score;
    dropped.push(...result.dropped);

    // "Did anything move" is an assignment-set question, answered here rather than through
    // buildProposals: solver.ts must not import proposals.ts, which imports it back.
    const changed = !sameAssignments(current, result.plan);
    if (changed) {
      current = result.plan;
      quiet = 0;
    } else {
      quiet++;
    }

    options.onRound?.({ round: rounds, changed, elapsedMs: Date.now() - started });

    if (quiet >= stableRounds) {
      converged = true;
      break;
    }
    if (Date.now() - started > budget) break;
  }

  return {
    plan: current,
    rounds,
    converged,
    elapsedMs: Date.now() - started,
    score,
    initialScore,
    dropped,
  };
}

/**
 * The seed a plan gets when the caller does not name one.
 *
 * Derived from the plan rather than fixed, and that is the whole point. With a constant default,
 * "converged" only ever meant "the seed that round happened to use found nothing", which is not
 * a property of the plan at all: measured on `balanced`, a plan the convergence loop declared
 * settled still yielded proposals under three seeds out of seven, including the constant the
 * single-run button uses. Pressing "Recalculer" right after "Jusqu'à stabilité" therefore found
 * more work, which is exactly what a régisseur reported.
 *
 * Keyed off the plan, the promise becomes real: solving plan P without a seed always runs the
 * same search, so if the last round of a convergence ran it and found nothing, a manual re-solve
 * of that same plan finds nothing either. Determinism is unchanged, and stronger: the same plan
 * still gives the same result, byte for byte, and an explicit seed still overrides.
 *
 * FNV-1a over the sorted assignment and reserve keys. Order-independent by construction, because
 * two plans with the same placements in a different array order are the same plan.
 */
export function planSeed(plan: Plan): number {
  let hash = 0x811c9dc5;
  for (const key of keysOf(plan)) {
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash = Math.imul(hash ^ 0x2c, 0x01000193) >>> 0;
  }
  // Rng wants a positive integer, and zero is a degenerate seed for most generators.
  return hash === 0 ? 1 : hash;
}

/** Everything a round could have changed: who is on what, and who is held back. */
const keysOf = (plan: Plan): string[] =>
  [
    ...plan.assignments.map((a) => `A|${a.volunteerKey}|${a.shiftKey}`),
    ...plan.reserve.map((key) => `R|${key}`),
  ].sort();

const sameAssignments = (a: Plan, b: Plan): boolean => {
  const left = keysOf(a);
  const right = keysOf(b);
  return left.length === right.length && left.every((key, i) => key === right[i]);
};
