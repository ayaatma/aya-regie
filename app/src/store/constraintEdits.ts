/**
 * The edits of the Réglages avancés card: a criterion's mode and weight, where a day reads long,
 * and putting all of it back.
 *
 * ONLY A DISAGREEMENT IS WRITTEN. An override equal to the default is removed rather than stored,
 * field by field, so choosing « Poids » again on a criterion that weighs by default leaves nothing
 * behind, and a default improved by measurement later still reaches this event. See
 * `constraints.ts` in the engine.
 *
 * Nothing here moves anybody. Making a rule blocking can turn boxes red on the grid, the same way
 * tightening the consecutive cap always did; the solver's next run is what proposes to move them,
 * and the régisseur still accepts each move.
 */

import {
  CRITERION_BY_ID,
  DEFAULT_CONSTRAINTS,
  DEFAULT_RULES,
  type ConstraintSettings,
  type CriterionId,
  type CriterionOverride,
  type Plan,
} from '../engine.ts';

const withConstraints = (plan: Plan, constraints: ConstraintSettings): Plan => ({ ...plan, constraints });

/** Sets a criterion's mode, its weight, or both, keeping only what differs from the default. */
export function setCriterion(plan: Plan, id: CriterionId, patch: CriterionOverride): Plan {
  const def = CRITERION_BY_ID.get(id);
  if (!def) return plan;
  const merged: CriterionOverride = { ...plan.constraints.criteria[id], ...patch };
  const kept: CriterionOverride = {};
  if (merged.mode !== undefined && merged.mode !== def.defaultMode && def.modes.includes(merged.mode)) {
    kept.mode = merged.mode;
  }
  if (
    merged.weight !== undefined &&
    Number.isFinite(merged.weight) &&
    merged.weight >= 0 &&
    merged.weight !== def.defaultWeight
  ) {
    kept.weight = merged.weight;
  }
  const criteria = { ...plan.constraints.criteria };
  if (kept.mode === undefined && kept.weight === undefined) delete criteria[id];
  else criteria[id] = kept;
  return withConstraints(plan, { ...plan.constraints, criteria });
}

export function resetCriterion(plan: Plan, id: CriterionId): Plan {
  if (!(id in plan.constraints.criteria)) return plan;
  const criteria = { ...plan.constraints.criteria };
  delete criteria[id];
  return withConstraints(plan, { ...plan.constraints, criteria });
}

/**
 * Where the grid starts drawing 💪 and 💪💪. Each stays above zero, and the second never below the
 * first: a "very long day" shorter than a long one would draw 💪💪 on days that are not long.
 */
export function setLongDay(
  plan: Plan,
  patch: Partial<Pick<ConstraintSettings, 'longDayHours' | 'veryLongDayHours'>>,
): Plan {
  const long = Math.max(0.5, patch.longDayHours ?? plan.constraints.longDayHours);
  const veryLong = Math.max(long, patch.veryLongDayHours ?? plan.constraints.veryLongDayHours);
  return withConstraints(plan, { ...plan.constraints, longDayHours: long, veryLongDayHours: veryLong });
}

/** How many criteria this event changed. What the folded card says about itself. */
export const changedCriteria = (plan: Plan): number => Object.keys(plan.constraints.criteria).length;

/** Whether anything on the card differs from a new event: the criteria, the day marks, the four thresholds. */
export function isDefaultCard(plan: Plan): boolean {
  const r = plan.rules;
  return (
    changedCriteria(plan) === 0 &&
    plan.constraints.longDayHours === DEFAULT_CONSTRAINTS.longDayHours &&
    plan.constraints.veryLongDayHours === DEFAULT_CONSTRAINTS.veryLongDayHours &&
    r.maxConsecutiveHours === DEFAULT_RULES.maxConsecutiveHours &&
    r.maxBlocks === DEFAULT_RULES.maxBlocks &&
    r.minBreakHours === DEFAULT_RULES.minBreakHours &&
    r.minHoursPerPerson === DEFAULT_RULES.minHoursPerPerson
  );
}

/** Everything on the card back to what a new event gets, the four thresholds included. */
export const resetAdvancedSettings = (plan: Plan): Plan => ({
  ...plan,
  rules: { ...DEFAULT_RULES },
  constraints: { ...DEFAULT_CONSTRAINTS, criteria: {} },
});
