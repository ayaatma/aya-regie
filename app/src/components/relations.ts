/**
 * Who a volunteer asked to work with.
 *
 * A buddy request is stored one-way, from the person who wrote the name down to the person they
 * named. The régisseur reading the grid does not care which way round it was: what they need is
 * which other boxes this pairing is about. So both directions count, and the answer never
 * includes the volunteer themselves.
 */

import type { Plan } from '../engine.ts';

/**
 * The selected bénévole's teammates, when the event works in teams. Since 2026-09-15: ringed on
 * the grid beside the buddies, so a team split across créneaux is read off the screen.
 */
export function teammatesOf(plan: Plan, volunteerKey: string | null): Set<string> {
  const keys = new Set<string>();
  if (!volunteerKey || plan.teamsEnabled !== true) return keys;
  const team = plan.volunteers.find((v) => v.key === volunteerKey)?.teamKey;
  if (!team) return keys;
  for (const v of plan.volunteers) if (v.teamKey === team && v.key !== volunteerKey) keys.add(v.key);
  return keys;
}

export function buddiesOf(plan: Plan, volunteerKey: string | null): Set<string> {
  const keys = new Set<string>();
  if (!volunteerKey) return keys;
  for (const pair of plan.buddies) {
    if (pair.fromKey === volunteerKey) keys.add(pair.toKey);
    if (pair.toKey === volunteerKey) keys.add(pair.fromKey);
  }
  keys.delete(volunteerKey);
  return keys;
}
