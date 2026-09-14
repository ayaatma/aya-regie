/**
 * Who a volunteer asked to work with.
 *
 * A buddy request is stored one-way, from the person who wrote the name down to the person they
 * named. The régisseur reading the grid does not care which way round it was: what they need is
 * which other boxes this pairing is about. So both directions count, and the answer never
 * includes the volunteer themselves.
 */

import type { Plan } from '../engine.ts';

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
