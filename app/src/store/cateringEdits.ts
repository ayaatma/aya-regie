/**
 * The edits the catering makes: the rules in Réglages, and one ticked box at a time.
 *
 * TWO KINDS OF EDIT AND THEY BEHAVE DIFFERENTLY, which is the whole of what is worth knowing
 * here. Changing a rule changes what the tool works out for everybody at once, and every box
 * nobody has touched follows it immediately. Ticking a box changes one person's plate and
 * nothing else, and it SURVIVES a rule change, a re-solve and a moved créneau, because that is
 * what a decision taken by a human is for.
 *
 * Nothing in this file writes a default down. `setMeal` stores a tick only where it disagrees
 * with what the engine computed, and deletes the row again the moment the two agree: see
 * `setMealChoice` in the engine. A stored agreement would be a frozen agreement.
 */

import { setMealChoice } from '../engine.ts';
import type {
  CateringRules,
  MealTier,
  MealWindow,
  MealPersonKind,
  Plan,
} from '../engine.ts';

const withRules = (plan: Plan, rules: CateringRules): Plan => ({
  ...plan,
  catering: { ...plan.catering, rules },
});

/**
 * The figures of the catering, changed in one go.
 *
 * Clamped rather than refused, like `setRules` beside it: a half-typed "" in a number field is a
 * régisseur mid-edit, not a mistake to shout about, and the screen shows what it landed on.
 */
export function setCateringRules(plan: Plan, over: Partial<CateringRules>): Plan {
  const merged = { ...plan.catering.rules, ...over };
  return withRules(plan, {
    ...merged,
    drinkPerHours: Math.max(0, merged.drinkPerHours),
    organiserMeals: Math.max(0, Math.round(merged.organiserMeals)),
    organiserDrinks: Math.max(0, Math.round(merged.organiserDrinks)),
    artistDrinks: Math.max(0, Math.round(merged.artistDrinks)),
  });
}

// ---------------------------------------------------------------------------
// The services of a day
// ---------------------------------------------------------------------------

const slug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * A new service of the day, with a key derived from its name and never equal to another.
 *
 * THE KEY IS PERMANENT AND THE LABEL IS NOT. Every ticked box on the catering screen is stored
 * against `jour|clé`, so a key that changed when somebody fixed a typo in "Diner" would orphan
 * every tick of that service at once. `renameService` below therefore leaves the key alone.
 */
export function addService(plan: Plan, label: string, fromHour: number, toHour: number): Plan {
  const trimmed = label.trim();
  if (trimmed === '') return plan;

  const taken = new Set(plan.catering.rules.services.map((s) => s.key));
  const base = slug(trimmed) || 'service';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;

  return withRules(plan, {
    ...plan.catering.rules,
    services: [...plan.catering.rules.services, { key, label: trimmed, fromHour, toHour }],
  });
}

export function setService(plan: Plan, key: string, over: Partial<Omit<MealWindow, 'key'>>): Plan {
  return withRules(plan, {
    ...plan.catering.rules,
    services: plan.catering.rules.services.map((service) =>
      service.key === key
        ? {
            ...service,
            ...over,
            // A clock hour, so it stays on the clock. An end at or before the start is a
            // legitimate answer and means the service runs past midnight.
            fromHour: clampClock(over.fromHour ?? service.fromHour),
            toHour: clampClock(over.toHour ?? service.toHour),
          }
        : service,
    ),
  });
}

const clampClock = (hour: number): number =>
  Number.isFinite(hour) ? Math.min(24, Math.max(0, hour)) : 0;

/**
 * How many ticked boxes a service takes with it. Asked before it is deleted, never after.
 *
 * A service that is deleted takes every hand-made decision about it out of the plan, because the
 * key those decisions are stored against stops meaning anything. That is a real loss and the
 * régisseur is told the number first, exactly as they are for a deleted pole.
 */
export function serviceRemovalCost(plan: Plan, key: string): number {
  return plan.catering.choices.filter((c) => c.serviceKey.endsWith(`|${key}`)).length;
}

export function deleteService(plan: Plan, key: string): Plan {
  return {
    ...plan,
    catering: {
      rules: {
        ...plan.catering.rules,
        services: plan.catering.rules.services.filter((s) => s.key !== key),
      },
      choices: plan.catering.choices.filter((c) => !c.serviceKey.endsWith(`|${key}`)),
    },
  };
}

// ---------------------------------------------------------------------------
// The tiers
// ---------------------------------------------------------------------------

/** A new step, at the hour after the last one, so the list stays readable as it is built. */
export function addTier(plan: Plan): Plan {
  const tiers = plan.catering.rules.exploitTiers;
  const last = tiers[tiers.length - 1];
  return withRules(plan, {
    ...plan.catering.rules,
    exploitTiers: [
      ...tiers,
      { fromHours: last ? last.fromHours + 2 : 4, meals: last ? last.meals + 1 : 1 },
    ],
  });
}

export function setTier(plan: Plan, index: number, over: Partial<MealTier>): Plan {
  return withRules(plan, {
    ...plan.catering.rules,
    exploitTiers: plan.catering.rules.exploitTiers.map((tier, i) =>
      i === index
        ? {
            fromHours: Math.max(0, over.fromHours ?? tier.fromHours),
            meals: Math.max(0, Math.round(over.meals ?? tier.meals)),
          }
        : tier,
    ),
  });
}

export function deleteTier(plan: Plan, index: number): Plan {
  return withRules(plan, {
    ...plan.catering.rules,
    exploitTiers: plan.catering.rules.exploitTiers.filter((_, i) => i !== index),
  });
}

// ---------------------------------------------------------------------------
// One person's plate
// ---------------------------------------------------------------------------

/**
 * One box, ticked or unticked by the régisseur.
 *
 * `computed` is what the engine worked out for this person and this service, and it is what
 * decides whether anything is stored at all: agreeing with the tool stores nothing, so the
 * answer stays free to follow the plan. See `setMealChoice`.
 */
export function setMeal(
  plan: Plan,
  kind: MealPersonKind,
  personKey: string,
  serviceKey: string,
  takes: boolean,
  computed: boolean,
): Plan {
  return {
    ...plan,
    catering: {
      ...plan.catering,
      choices: setMealChoice(plan, kind, personKey, serviceKey, takes, computed),
    },
  };
}

/** Every hand-made decision about one person, dropped. Their boxes go back to following the plan. */
export function clearMeals(plan: Plan, kind: MealPersonKind, personKey: string): Plan {
  return {
    ...plan,
    catering: {
      ...plan.catering,
      choices: plan.catering.choices.filter(
        (c) => !(c.personKind === kind && c.personKey === personKey),
      ),
    },
  };
}
