/**
 * The edits the billetterie makes: the ticket types and the bracelets in Réglages, the people
 * the door alone knows, and one ticket or bracelet chosen by hand for one person.
 *
 * TWO KINDS OF EDIT, as in `cateringEdits.ts`. Changing a type or a bracelet's default statuses
 * changes what everybody gets at once, and every row nobody has touched follows it. Choosing a
 * ticket for one person changes that person and nothing else, and it survives a change to the
 * defaults, because that is what a decision taken by a human is for. `setTicketingChoice` in
 * the engine stores only the disagreements; a pick equal to the default deletes the row.
 */

import { setTicketingChoice } from '../engine.ts';
import type {
  BraceletType,
  ExtraPerson,
  PersonStatus,
  Plan,
  TicketPersonKind,
  TicketType,
  TicketingChoice,
  TicketingSettings,
  TravelRates,
  FuelKind,
} from '../engine.ts';

const withTicketing = (plan: Plan, over: Partial<TicketingSettings>): Plan => ({
  ...plan,
  ticketing: { ...plan.ticketing, ...over },
});

const slug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** A key derived from a name and never equal to another in the list. Permanent: labels change. */
function freeKey(taken: ReadonlySet<string>, base: string, fallback: string): string {
  const root = base === '' ? fallback : base;
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A row deciding nothing at all: the default, and not worth a row. */
const isEmptyChoice = (c: TicketingChoice): boolean =>
  c.ticketTypeKey === null && c.braceletKey === null && c.drinkTickets === null && c.note === '';

/** A fuel price or the toll rate, kept at zero or above; a NaN leaves the figure alone. */
export function setTravelRate(plan: Plan, fuel: FuelKind | 'toll', value: number): Plan {
  if (!Number.isFinite(value)) return plan;
  const clean = Math.max(0, value);
  const travel: TravelRates =
    fuel === 'toll'
      ? { ...plan.travel, tollPerKm: clean }
      : { ...plan.travel, fuelPrices: { ...plan.travel.fuelPrices, [fuel]: clean } };
  return { ...plan, travel };
}

export function setGuestsPerArtist(plan: Plan, count: number): Plan {
  return Number.isFinite(count)
    ? withTicketing(plan, { guestsPerArtist: Math.max(0, Math.round(count)) })
    : plan;
}

// ---------------------------------------------------------------------------
// Ticket types
// ---------------------------------------------------------------------------

/** A new kind of entry, opening the whole event until its window is typed. */
export function addTicketType(plan: Plan, label: string): Plan {
  const trimmed = label.trim();
  if (trimmed === '') return plan;
  const taken = new Set(plan.ticketing.ticketTypes.map((t) => t.key));
  const type: TicketType = {
    key: freeKey(taken, slug(trimmed), 'ticket'),
    label: trimmed,
    start: 0,
    end: plan.lengthHours,
  };
  return withTicketing(plan, { ticketTypes: [...plan.ticketing.ticketTypes, type] });
}

export function setTicketType(
  plan: Plan,
  key: string,
  over: Partial<Omit<TicketType, 'key'>>,
): Plan {
  return withTicketing(plan, {
    ticketTypes: plan.ticketing.ticketTypes.map((t) => {
      if (t.key !== key) return t;
      return {
        ...t,
        label: over.label !== undefined ? over.label : t.label,
        start: Number.isFinite(over.start) ? over.start! : t.start,
        end: Number.isFinite(over.end) ? over.end! : t.end,
      };
    }),
  });
}

/** How many people hold this type by hand: what a deletion sends back to the default. */
export function ticketTypeHolders(plan: Plan, key: string): number {
  return plan.ticketing.choices.filter((c) => c.ticketTypeKey === key).length;
}

/**
 * Removes a type. The choices naming it lose that half and go back to the default, which the
 * screen prices first; a choice left with nothing is dropped.
 */
export function deleteTicketType(plan: Plan, key: string): Plan {
  return withTicketing(plan, {
    ticketTypes: plan.ticketing.ticketTypes.filter((t) => t.key !== key),
    choices: plan.ticketing.choices
      .map((c) => (c.ticketTypeKey === key ? { ...c, ticketTypeKey: null } : c))
      .filter((c) => !isEmptyChoice(c)),
  });
}

// ---------------------------------------------------------------------------
// Bracelets
// ---------------------------------------------------------------------------

export function addBracelet(plan: Plan, label: string): Plan {
  const trimmed = label.trim();
  if (trimmed === '') return plan;
  const taken = new Set(plan.ticketing.bracelets.map((b) => b.key));
  const bracelet: BraceletType = {
    key: freeKey(taken, slug(trimmed), 'bracelet'),
    label: trimmed,
    defaultFor: [],
  };
  return withTicketing(plan, { bracelets: [...plan.ticketing.bracelets, bracelet] });
}

export function setBracelet(
  plan: Plan,
  key: string,
  over: Partial<Omit<BraceletType, 'key'>>,
): Plan {
  return withTicketing(plan, {
    bracelets: plan.ticketing.bracelets.map((b) => (b.key === key ? { ...b, ...over } : b)),
  });
}

/**
 * Gives a status to this bracelet by default, or takes it back.
 *
 * ONE BRACELET PER STATUS: "backstage pour les artistes" means the artistes do not also get
 * "basique", so taking a status here takes it off every other bracelet. That is what the
 * régisseur means by "attribué par défaut à un type de personne", and the alternative (the
 * first bracelet in the list wins) would have made the order of the list a rule nobody sees.
 */
export function setBraceletDefault(plan: Plan, key: string, status: PersonStatus, on: boolean): Plan {
  return withTicketing(plan, {
    bracelets: plan.ticketing.bracelets.map((b) => {
      const without = b.defaultFor.filter((s) => s !== status);
      if (b.key !== key) return on ? { ...b, defaultFor: without } : b;
      return { ...b, defaultFor: on ? [...without, status] : without };
    }),
  });
}

export function braceletHolders(plan: Plan, key: string): number {
  return plan.ticketing.choices.filter((c) => c.braceletKey === key).length;
}

export function deleteBracelet(plan: Plan, key: string): Plan {
  return withTicketing(plan, {
    bracelets: plan.ticketing.bracelets.filter((b) => b.key !== key),
    choices: plan.ticketing.choices
      .map((c) => (c.braceletKey === key ? { ...c, braceletKey: null } : c))
      .filter((c) => !isEmptyChoice(c)),
  });
}

// ---------------------------------------------------------------------------
// The people the door alone knows
// ---------------------------------------------------------------------------

/** The key the next extra person will get, so the screen can open their fiche as it adds them. */
export function nextExtraKey(plan: Plan): string {
  const taken = new Set(plan.ticketing.extras.map((x) => x.key));
  let n = plan.ticketing.extras.length + 1;
  while (taken.has(`extra-${n}`)) n++;
  return `extra-${n}`;
}

/** One more prestataire or invitation, unnamed: the fiche is where the name is typed. */
export function addExtraPerson(plan: Plan, status: ExtraPerson['status']): Plan {
  const person: ExtraPerson = {
    key: nextExtraKey(plan),
    firstName: '',
    lastName: '',
    status,
    phone: '',
    drinkTickets: 0,
    mealTickets: 0,
  };
  return withTicketing(plan, { extras: [...plan.ticketing.extras, person] });
}

export function setExtraPerson(
  plan: Plan,
  key: string,
  over: Partial<Omit<ExtraPerson, 'key'>>,
): Plan {
  return withTicketing(plan, {
    extras: plan.ticketing.extras.map((x) => {
      if (x.key !== key) return x;
      const next: ExtraPerson = { ...x };
      for (const [field, value] of Object.entries(over)) {
        if (value === undefined) continue;
        if (typeof value === 'number' && !Number.isFinite(value)) continue;
        (next as unknown as Record<string, unknown>)[field] = value;
      }
      return next;
    }),
  });
}

/** Removes the person, and the ticket or bracelet chosen for them: nothing can carry that key again. */
export function deleteExtraPerson(plan: Plan, key: string): Plan {
  return withTicketing(plan, {
    extras: plan.ticketing.extras.filter((x) => x.key !== key),
    choices: plan.ticketing.choices.filter((c) => !(c.personKind === 'extra' && c.personKey === key)),
  });
}

// ---------------------------------------------------------------------------
// One person's ticket or bracelet
// ---------------------------------------------------------------------------

/**
 * The régisseur choosing for one person. `defaults` is what the report computed for that row,
 * so a pick equal to it stores nothing.
 */
export function chooseForPerson(
  plan: Plan,
  kind: TicketPersonKind,
  personKey: string,
  over: { ticketTypeKey?: string | null; braceletKey?: string | null; drinkTickets?: number | null; note?: string },
  defaults: { ticketTypeKey: string | null; braceletKey: string | null; drinkTickets?: number },
): Plan {
  return withTicketing(plan, {
    choices: setTicketingChoice(plan, kind, personKey, over, defaults),
  });
}

/** Everything chosen by hand for this person, given back to the defaults. */
export function clearChoices(plan: Plan, kind: TicketPersonKind, personKey: string): Plan {
  return withTicketing(plan, {
    choices: plan.ticketing.choices.filter(
      (c) => !(c.personKind === kind && c.personKey === personKey),
    ),
  });
}
