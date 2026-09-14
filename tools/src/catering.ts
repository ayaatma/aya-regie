/**
 * Les repas et les tickets boisson: who eats, when, how many plates, and what they cannot eat.
 *
 * WHAT THE CATERER ACTUALLY ASKS, and the whole reason this file exists: "combien de personnes
 * mangent chaque jour", plus the list of the diets and the allergies. Everything here is aimed
 * at those two answers and stops there. Nothing in this file schedules anybody, refuses
 * anything, or moves a single box on a grid.
 *
 * THREE DECISIONS WORTH KNOWING BEFORE READING A LINE.
 *
 * A SERVICE IS A REAL DATE AND A REAL HOUR, not an offset into one of the three moments. The
 * rest of this codebase counts hours from an origin, and it is right to: a créneau belongs to
 * the exploit and a box belongs to the montage. A meal belongs to neither. The last day of the
 * montage IS the day of the event, and midi that day is ONE service with ONE queue of people at
 * it, whichever moment each of them is on site for. Counting it once per moment would have told
 * the caterer to cook twice.
 *
 * ENTITLEMENT AND PRESENCE ARE TWO DIFFERENT RULES, because the régisseur described them as two
 * different rules. On the exploit a meal is EARNED: four hours worked is one, six is two, and an
 * orga has two whatever they did. During the montage and the démontage a meal is simply EATEN by
 * whoever is on site when it is served. So this file computes a quota on one side, an overlap on
 * the other, and merges the two into one set of ticked boxes.
 *
 * THE TICKED BOXES ARE THE TRUTH, and the computation is only their default. The régisseur ticks
 * and unticks per person, and only their disagreements are stored: see `MealChoice`. That is
 * what lets a créneau move, a tier change or one more montage day open without freezing
 * yesterday's headcount into the plan.
 *
 * See `.claude/memory/feature_catering.md` for the brief this comes from.
 */

import {
  type Artist,
  type ArtistMember,
  type CateringRules,
  type MealChoice,
  type MealPersonKind,
  type MealTier,
  type Organiser,
  type PersonKind,
  type Volunteer,
  type Window,
} from './model.js';
import { type Plan, PlanIndex } from './plan.js';
import {
  actsOfPerson,
  artistMemberDrinks,
  artistMemberName,
  artistPresence,
  memberIsLinked,
  phaseOffset,
} from './artists.js';
import { toCsv } from './csv.js';
import {
  type Phase,
  type PhaseId,
  mergeWindows,
  phasePeople,
  windowHours,
  windowsOverlap,
} from './phase.js';

/** The three moments of the event a meal can fall in. The exploit always exists; the two others may not. */
export type MomentId = 'montage' | 'exploit' | 'demontage';

export const MOMENT_LABEL: Record<MomentId, string> = {
  montage: 'Montage',
  exploit: 'Exploit',
  demontage: 'Démontage',
};

/**
 * One meal, served once, on one real day.
 *
 * `inMoment` is the same window expressed in each moment's own hour axis, for every moment it
 * lands inside. That is what lets a presence recorded on the montage grid and a créneau of the
 * exploit both be tested against the same plate.
 */
export interface MealService {
  key: string;
  /** "2027-03-13", local. Part of the key, so a reworded label never moves a ticked box. */
  dayKey: string;
  /** The `MealWindow` this comes from, by key. */
  windowKey: string;
  /** "ven. 12/03". */
  dayLabel: string;
  /** "Midi". */
  windowLabel: string;
  /** "ven. 12/03 midi", the way a column is headed. */
  label: string;
  startISO: string;
  endISO: string;
  inMoment: Partial<Record<MomentId, Window>>;
}

/** One person, everything the caterer and the régisseur need about them in one row. */
export interface CateringPerson {
  kind: MealPersonKind;
  key: string;
  /** The registered name, because this list is read at a table with plates on it. */
  name: string;
  /** The act, for a member of one. Empty for everybody else. */
  group: string;
  diet: string;
  allergies: string;
  /** Hours worked in each moment. Zero where they are not there at all. */
  hours: Record<MomentId, number>;
  /** How many meals the exploit rules give them: the tiers, lifted by the orga floor. */
  exploitMeals: number;
  /** Drink tickets due, from the hours and the orga floor. */
  drinks: number;
  /** The services they take, in service order. Defaults and hand ticks already merged. */
  serviceKeys: string[];
  /** The services where the régisseur's answer differs from the computed one. */
  handPicked: string[];
}

export interface DietCount {
  /** The diet as somebody wrote it, first spelling met. Empty means the standard plate. */
  label: string;
  count: number;
}

export interface ServiceFill {
  service: MealService;
  /** Plates to cook. */
  total: number;
  /** The special diets among them, standard plates excluded. */
  byDiet: DietCount[];
}

export interface CateringReport {
  services: MealService[];
  /** Everybody the plan knows, whether they eat or not, in the plan's own order. */
  people: CateringPerson[];
  fills: ServiceFill[];
  /** The special diets over everybody who eats at least once, with who has them. */
  diets: Array<{ label: string; names: string[] }>;
  /** Every allergy declared by somebody who eats at least once. */
  allergies: Array<{ name: string; text: string }>;
  /** Plates over the whole event. */
  meals: number;
  /** Drink tickets over the whole event. */
  drinks: number;
}

// ---------------------------------------------------------------------------
// The rules, as arithmetic
// ---------------------------------------------------------------------------

/**
 * How many meals `hours` of work earns, as a step function: the highest tier reached wins.
 *
 * Tiers are sorted here rather than trusted to be sorted, because they are typed in by hand in
 * Réglages and "à partir de 6 h" is as likely to be entered before "à partir de 4 h" as after.
 */
export function mealsForHours(hours: number, tiers: readonly MealTier[]): number {
  let meals = 0;
  for (const tier of [...tiers].sort((a, b) => a.fromHours - b.fromHours)) {
    if (hours + 1e-9 >= tier.fromHours) meals = Math.max(0, Math.round(tier.meals));
  }
  return meals;
}

/** "Chaque tranche de 2 h travaillé donne droit à 1 ticket boisson." Zero disables them. */
export function drinksForHours(hours: number, perHours: number): number {
  if (perHours <= 0) return 0;
  return Math.floor((hours + 1e-9) / perHours);
}

// ---------------------------------------------------------------------------
// The services of the event
// ---------------------------------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, '0');

const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});

const dayKeyOf = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The key a ticked box is stored against. Built from ids, never from a label. */
export const serviceKey = (dayKey: string, windowKey: string): string => `${dayKey}|${windowKey}`;

/**
 * A clock hour on a given local day, DST included.
 *
 * Built through the Date constructor rather than by adding milliseconds to midnight, which is
 * the same choice `phase.ts` makes and for the same reason: the last Sunday of March has a
 * twenty-three hour day in France, and a meal served at 12h that day is served at 12h. An hour
 * past 24 rolls into the next day on its own, which is how a 23h to 01h night service is written.
 */
function atClock(year: number, month: number, day: number, clock: number): Date {
  const whole = Math.floor(clock);
  const minutes = Math.round((clock - whole) * 60);
  return new Date(year, month, day, whole, minutes, 0, 0);
}

interface MomentSpan {
  id: MomentId;
  startMs: number;
  endMs: number;
  startISO: string;
}

/**
 * The three moments in real time, the disabled phases left out.
 *
 * The exploit is always there. A phase that is switched off has no grid, no placements and
 * nobody on site, so a meal on one of its days is a meal nobody attends.
 */
export function momentSpans(plan: Plan): MomentSpan[] {
  const spans: MomentSpan[] = [];
  const push = (id: MomentId, startISO: string, lengthHours: number): void => {
    const startMs = new Date(startISO).getTime();
    if (!Number.isFinite(startMs) || !(lengthHours > 0)) return;
    spans.push({ id, startMs, endMs: startMs + lengthHours * 3600_000, startISO });
  };
  if (plan.montage.enabled) push('montage', plan.montage.startISO, plan.montage.lengthHours);
  push('exploit', plan.startISO, plan.lengthHours);
  if (plan.demontage.enabled) push('demontage', plan.demontage.startISO, plan.demontage.lengthHours);
  return spans;
}

/**
 * Every meal served over the whole event, in clock order.
 *
 * A service nobody could possibly attend is not produced at all: the window has to overlap at
 * least one moment that is switched on. That is what keeps the caterer's table down to the days
 * the event actually occupies rather than the calendar between them.
 */
export function mealServices(plan: Plan): MealService[] {
  const rules = plan.catering.rules;
  if (!rules.enabled) return [];

  const spans = momentSpans(plan);
  if (spans.length === 0 || rules.services.length === 0) return [];

  const first = new Date(Math.min(...spans.map((s) => s.startMs)));
  const lastMs = Math.max(...spans.map((s) => s.endMs));
  const services: MealService[] = [];

  const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  // The guard is the day's own midnight against the last moment's end, so a service that starts
  // late on the final day is still produced; the overlap test below is what really decides.
  for (let guard = 0; cursor.getTime() < lastMs && guard < 400; guard += 1) {
    for (const window of rules.services) {
      const from = atClock(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), window.fromHour);
      const to = atClock(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate(),
        window.toHour <= window.fromHour ? window.toHour + 24 : window.toHour,
      );
      const startMs = from.getTime();
      const endMs = to.getTime();

      const inMoment: Partial<Record<MomentId, Window>> = {};
      for (const span of spans) {
        if (!(startMs < span.endMs && span.startMs < endMs)) continue;
        inMoment[span.id] = {
          start: Math.max(0, (startMs - span.startMs) / 3600_000),
          end: Math.min((span.endMs - span.startMs) / 3600_000, (endMs - span.startMs) / 3600_000),
        };
      }
      if (Object.keys(inMoment).length === 0) continue;

      const dayKey = dayKeyOf(cursor);
      const dayLabel = DAY_LABEL.format(cursor);
      services.push({
        key: serviceKey(dayKey, window.key),
        dayKey,
        windowKey: window.key,
        dayLabel,
        windowLabel: window.label,
        label: `${dayLabel} ${window.label.toLocaleLowerCase('fr-FR')}`,
        startISO: from.toISOString(),
        endISO: to.toISOString(),
        inMoment,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return services.sort((a, b) => a.startISO.localeCompare(b.startISO));
}

// ---------------------------------------------------------------------------
// Who is where, per moment
// ---------------------------------------------------------------------------

/*
 * THERE IS NO REACH ANY MORE. Until 2026-09-13 a service more than two hours from anything the
 * person worked was not a candidate, so somebody owed a plate and working 20h to 22h could end
 * up with none. The régisseur's rule is simpler: "si un bénévole a droit à 1 repas, le placer
 * le plus proche de ses créneaux; s'il a droit à 2 repas, les deux les plus proches". The quota
 * is what was earned, and it is always spent, on the nearest services first.
 */

const phaseOf = (plan: Plan, id: PhaseId): Phase => (id === 'montage' ? plan.montage : plan.demontage);

/**
 * The hours somebody is on site, per moment, overlaps merged so nothing counts twice.
 *
 * THE EXPLOIT AND THE PHASES ANSWER THIS DIFFERENTLY, because being on site means two different
 * things there.
 *
 * On the exploit it is the créneaux they hold, and nothing else. A créneau is the only way
 * anybody is expected at the event, so there is nothing to add to it.
 *
 * On a phase it is **their boxes if they have any, and otherwise what they declared**, and the
 * order matters more than the fallback.
 *
 * A BOX ALWAYS WINS, because a box is a decision. Somebody whose Thursday was trimmed to 09h-11h
 * leaves before lunch, and the régisseur trimmed it on purpose: feeding them anyway would be the
 * tool overruling the one person who knows.
 *
 * THE DECLARATION FILLS IN FOR SOMEBODY WITH NO BOX AT ALL, and it had to from 2026-09-12, the
 * day bénévoles stopped being placed from their answer (see `declaredPlacements`). A bénévole who
 * told the form they were coming on Thursday and whom nobody has dragged anywhere yet is somebody
 * who turns up on Thursday and expects lunch; counting only the boxes would have left them off
 * the caterer's sheet entirely, which is the failure that costs a plate rather than the one that
 * wastes one. That declaration is already narrowed twice before it reaches here: a bénévole is on
 * the list only if the régisseur opened the phase to bénévoles, and only inside the window they
 * opened.
 *
 * Every one of these is a DEFAULT the régisseur can untick, on the row, one service at a time.
 */
function presenceByMoment(
  plan: Plan,
  index: PlanIndex,
  kind: MealPersonKind,
  key: string,
): Record<MomentId, Window[]> {
  if (kind === 'artiste') return artistPresenceByMoment(plan, key);

  const exploit =
    kind === 'benevole'
      ? index.shiftsOf(key).map((s) => ({ start: s.start, end: s.end }))
      : index.shiftsOfOrganiser(key).map((s) => ({ start: s.start, end: s.end }));

  const fromPhase = (id: PhaseId): Window[] => {
    const phase = phaseOf(plan, id);
    if (!phase.enabled) return [];
    const placed = phase.assignments
      .filter((a) => a.personKind === kind && a.personKey === key)
      .map((a) => ({ start: a.start, end: a.end }));
    if (placed.length > 0) return mergeWindows(placed);

    return (
      phasePeople(phase, plan.organisers, plan.volunteers).find(
        (p) => p.kind === kind && p.key === key,
      )?.presence ?? []
    );
  };

  return {
    montage: fromPhase('montage'),
    exploit: mergeWindows(exploit),
    demontage: fromPhase('demontage'),
  };
}

/**
 * A member of an act is on the venue when the act is: from its balances or its changement de
 * plateau to the end of its set, as ONE window (see `artistPresence`), cut where the moments
 * meet. Balances the afternoon before the doors open are hours of the montage, so a member eats
 * the montage's soir that day exactly as an orga placed there would.
 *
 * A member whose act nobody can find is on site nowhere, which is what an orphaned meal choice
 * should come to as well.
 */
function artistPresenceByMoment(plan: Plan, memberKey: string): Record<MomentId, Window[]> {
  const artist = plan.artists.find((a) => a.members.some((m) => m.key === memberKey));
  return artist ? actPresenceByMoment(plan, artist) : NOWHERE;
}

const NOWHERE: Record<MomentId, Window[]> = { montage: [], exploit: [], demontage: [] };

/** The act's window on the venue, cut into the moments it crosses. */
function actPresenceByMoment(plan: Plan, artist: Artist): Record<MomentId, Window[]> {
  const span = artistPresence(artist);
  if (!span) return NOWHERE;

  const clip = (start: number, end: number): Window[] =>
    end > start ? [{ start, end }] : [];
  const inPhase = (phase: Phase): Window[] => {
    if (!phase.enabled) return [];
    const offset = phaseOffset(plan.startISO, phase);
    if (offset === null) return [];
    return clip(Math.max(0, span.start - offset), Math.min(phase.lengthHours, span.end - offset));
  };

  return {
    montage: inPhase(plan.montage),
    exploit: clip(Math.max(0, span.start), Math.min(plan.lengthHours, span.end)),
    demontage: inPhase(plan.demontage),
  };
}

/** How far a service is from the nearest hour somebody works, in that moment. Null: not there. */
function reachTo(presence: readonly Window[], window: Window): number | null {
  let best: number | null = null;
  for (const w of presence) {
    const gap = windowsOverlap(w, window) ? 0 : Math.max(window.start - w.end, w.start - window.end);
    if (best === null || gap < best) best = gap;
  }
  return best;
}

/**
 * The boxes the tool ticks on its own, before the régisseur touches anything.
 *
 * THE TWO RULES, SIDE BY SIDE, and they are not the same rule:
 *
 *   montage, démontage   somebody placed on the grid across the hour a meal is served eats it.
 *                        A strict overlap, no tolerance and no quota, which is the régisseur's
 *                        own wording: "ils ont le repas s'ils sont présents à l'heure du repas".
 *
 *   exploit              a quota, earned by the hours worked, then spent on the services nearest
 *                        the hours they work. An orga with a floor and no créneau at all has
 *                        nothing to be near, so their quota goes on the first services of the
 *                        day: they are owed the plates whether or not they work for them.
 *
 * A service already ticked by a phase SPENDS the exploit quota rather than adding to it. One
 * plate is one plate: a person cannot eat the same midi twice because they were on site for two
 * different reasons.
 */
export function defaultMealChoices(
  plan: Plan,
  index: PlanIndex,
  services: readonly MealService[],
  kind: MealPersonKind,
  key: string,
): Set<string> {
  const rules = plan.catering.rules;
  const presence = presenceByMoment(plan, index, kind, key);
  const taken = new Set<string>();
  const tickWhere = (there: Record<MomentId, Window[]>, moments: readonly MomentId[]): void => {
    for (const id of moments) {
      for (const service of services) {
        const window = service.inMoment[id];
        if (!window) continue;
        if (there[id].some((w) => windowsOverlap(w, window))) taken.add(service.key);
      }
    }
  };

  /*
   * A MEMBER OF AN ACT EATS WHEN THE ACT IS THERE, in every moment alike: an act works no
   * créneau and earns nothing by the hour, so the exploit's quota has nothing to say about it.
   * The régisseur asked for the boxes "de la même façon que le choix des repas pour les orgas
   * pendant le montage", and this is that rule, presence and nothing else.
   */
  if (kind === 'artiste') {
    tickWhere(presence, ['montage', 'exploit', 'demontage']);
    return taken;
  }

  /*
   * SOMEBODY WHO ALSO PLAYS IN AN ACT: "on lui attribue par défaut les effets Artiste, sauf si
   * les tickets sont cumulatifs" (2026-09-13). So by default their plates are the ACT's, and
   * nothing of what their own status would have given them: the orga floor and the tiers say
   * nothing about somebody who is there as an artist. Cumulative is the one case where both
   * statuses count, and even then on the SAME row: the act's services are ticked first and
   * spend the exploit quota below rather than adding a second plate. The act's hours are never
   * added to the worked hours, so the tiers never turn a set into a créneau.
   */
  const acts = actsOfPerson(plan.artists, kind, key);
  for (const { artist } of acts) {
    tickWhere(actPresenceByMoment(plan, artist), ['montage', 'exploit', 'demontage']);
  }
  if (acts.length > 0 && !rules.artistDrinksCumulative) return taken;

  tickWhere(presence, ['montage', 'demontage']);

  const exploitServices = services.filter((s) => s.inMoment.exploit !== undefined);
  const quota = exploitMealsFor(rules, kind, presence.exploit);
  const spent = exploitServices.filter((s) => taken.has(s.key)).length;
  let left = quota - spent;
  if (left <= 0) return taken;

  const ranked = exploitServices
    .filter((s) => !taken.has(s.key))
    .map((s) => ({ service: s, gap: reachTo(presence.exploit, s.inMoment.exploit!) }))
    // Nobody working at all means nothing to be near: the floor alone decides, so the services
    // of the day are taken in clock order.
    .sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0) || a.service.startISO.localeCompare(b.service.startISO));

  for (const row of ranked) {
    if (left <= 0) break;
    taken.add(row.service.key);
    left -= 1;
  }

  return taken;
}

/** The meals the exploit owes somebody: the tiers, never pushed below the orga floor. */
function exploitMealsFor(
  rules: CateringRules,
  kind: PersonKind,
  presence: readonly Window[],
): number {
  const earned = mealsForHours(windowHours(presence), rules.exploitTiers);
  return kind === 'orga' ? Math.max(earned, Math.max(0, Math.round(rules.organiserMeals))) : earned;
}

// ---------------------------------------------------------------------------
// Diets
// ---------------------------------------------------------------------------

const NO_DIET = /^(|non|aucun|aucune|rien|ras|nan|standard|normal|classique|omnivore|tout|de tout|tout me va|sans|sans restriction|sans restrictions|sans regime|pas de regime|aucune restriction)$/;

const flatten = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[.!]/g, '').trim();

/**
 * True when somebody's answer means "the standard plate", whichever way they wrote it.
 *
 * A CLOSED LIST OF NON-ANSWERS, and never a closed list of diets. The point is to keep "Non",
 * "Aucun" and "Sans restriction" out of a table whose whole purpose is the plates that are not
 * standard; anything this list does not recognise is a real answer and is shown as written, even
 * when it is a sentence. A caterer reading one line too many loses a second; a caterer never
 * shown "allergie sévère aux arachides" because a matcher swallowed it is the other kind of bug.
 */
export const isStandardDiet = (text: string): boolean => NO_DIET.test(flatten(text));

/** Same question for an allergy, where "Non" is by far the most common answer. */
export const isNoAllergy = (text: string): boolean => NO_DIET.test(flatten(text));

// ---------------------------------------------------------------------------
// The whole picture
// ---------------------------------------------------------------------------

const personRow = (
  plan: Plan,
  index: PlanIndex,
  services: readonly MealService[],
  overrides: Map<string, boolean>,
  kind: MealPersonKind,
  key: string,
  name: string,
  diet: string,
  allergies: string,
  group = '',
  /** A member's tickets are decided by the act's setting, not by any hour: handed in. */
  fixedDrinks: number | null = null,
): CateringPerson => {
  const rules = plan.catering.rules;
  const presence = presenceByMoment(plan, index, kind, key);
  const hours: Record<MomentId, number> = {
    montage: windowHours(presence.montage),
    exploit: windowHours(presence.exploit),
    demontage: windowHours(presence.demontage),
  };

  const defaults = defaultMealChoices(plan, index, services, kind, key);
  const serviceKeys: string[] = [];
  const handPicked: string[] = [];
  for (const service of services) {
    const override = overrides.get(`${kind}|${key}|${service.key}`);
    const takes = override ?? defaults.has(service.key);
    if (takes) serviceKeys.push(service.key);
    if (override !== undefined && override !== defaults.has(service.key)) handPicked.push(service.key);
  }

  const countedHours =
    hours.exploit + (rules.drinkCountsPhases ? hours.montage + hours.demontage : 0);
  const earnedDrinks = drinksForHours(countedHours, rules.drinkPerHours);
  const ownDrinks =
    fixedDrinks !== null
      ? fixedDrinks
      : kind === 'orga'
        ? Math.max(earnedDrinks, Math.max(0, Math.round(rules.organiserDrinks)))
        : earnedDrinks;

  /*
   * TWO STATUSES, ONE PERSON, and the tickets are the régisseur's call: added up when the event
   * says they are cumulative, otherwise THE ARTIST'S FIGURE, whatever their other status would
   * have earned ("on lui attribue par défaut les effets Artiste"). A person in two acts holds the
   * higher figure of the two acts before either rule applies.
   */
  const acts = kind === 'artiste' ? [] : actsOfPerson(plan.artists, kind, key);
  const actDrinks = acts.reduce((best, { member }) => Math.max(best, artistMemberDrinks(member, rules)), 0);
  const drinks =
    acts.length === 0 ? ownDrinks : rules.artistDrinksCumulative ? ownDrinks + actDrinks : actDrinks;

  return {
    kind,
    key,
    name,
    group: group || acts.map(({ artist }) => artist.name).join(', '),
    diet,
    allergies,
    hours,
    exploitMeals: kind === 'artiste' ? 0 : exploitMealsFor(rules, kind, presence.exploit),
    drinks,
    serviceKeys,
    handPicked,
  };
};

const memberRow = (
  plan: Plan,
  index: PlanIndex,
  services: readonly MealService[],
  overrides: Map<string, boolean>,
  artist: Artist,
  member: ArtistMember,
): CateringPerson =>
  personRow(
    plan,
    index,
    services,
    overrides,
    'artiste',
    member.key,
    artistMemberName(artist, member),
    member.diet,
    member.allergies,
    artist.name,
    artistMemberDrinks(member, plan.catering.rules),
  );

const fullName = (person: Volunteer | Organiser): string =>
  `${person.firstName} ${person.lastName}`.trim() || person.key;

/**
 * Everything the catering screen draws, in one pass over the plan.
 *
 * Built fresh every time rather than cached anywhere, exactly like `validate()`: a stale plate
 * count is worse than none, and the whole computation is a handful of loops over a few hundred
 * people.
 */
export function cateringReport(plan: Plan, index: PlanIndex = new PlanIndex(plan)): CateringReport {
  const services = mealServices(plan);
  const overrides = new Map<string, boolean>();
  for (const choice of plan.catering.choices) {
    overrides.set(`${choice.personKind}|${choice.personKey}|${choice.serviceKey}`, choice.takes);
  }

  const people: CateringPerson[] = [
    ...plan.organisers.map((o) =>
      personRow(plan, index, services, overrides, 'orga', o.key, fullName(o), o.diet, o.allergies),
    ),
    ...plan.volunteers.map((v) =>
      personRow(plan, index, services, overrides, 'benevole', v.key, fullName(v), v.diet, v.allergies),
    ),
    // The acts last, in the order of the line-up: the caterer reads them as a block. A member
    // who is also a bénévole or an orga is NOT here: they are on their own row above, with the
    // act's name beside them, and that row already counts the act's hours. One person, one plate.
    ...[...plan.artists]
      .sort((a, b) => a.start - b.start)
      .flatMap((artist) =>
        artist.members
          .filter((member) => !memberIsLinked(member, plan.organisers, plan.volunteers))
          .map((member) => memberRow(plan, index, services, overrides, artist, member)),
      ),
  ];

  const eating = people.filter((p) => p.serviceKeys.length > 0);

  const fills: ServiceFill[] = services.map((service) => {
    const there = people.filter((p) => p.serviceKeys.includes(service.key));
    return { service, total: there.length, byDiet: countDiets(there) };
  });

  const diets = new Map<string, { label: string; names: string[] }>();
  for (const person of eating) {
    if (isStandardDiet(person.diet)) continue;
    const id = flatten(person.diet);
    const row = diets.get(id) ?? { label: person.diet.trim(), names: [] };
    row.names.push(person.name);
    diets.set(id, row);
  }

  return {
    services,
    people,
    fills,
    diets: [...diets.values()].sort((a, b) => b.names.length - a.names.length || a.label.localeCompare(b.label)),
    allergies: eating
      .filter((p) => !isNoAllergy(p.allergies))
      .map((p) => ({ name: p.name, text: p.allergies.trim() })),
    meals: people.reduce((total, p) => total + p.serviceKeys.length, 0),
    drinks: people.reduce((total, p) => total + p.drinks, 0),
  };
}

function countDiets(people: readonly CateringPerson[]): DietCount[] {
  const counts = new Map<string, DietCount>();
  for (const person of people) {
    if (isStandardDiet(person.diet)) continue;
    const id = flatten(person.diet);
    const row = counts.get(id) ?? { label: person.diet.trim(), count: 0 };
    row.count += 1;
    counts.set(id, row);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * The régisseur ticking or unticking one box, as a new list of stored disagreements.
 *
 * A tick that agrees with the computed default REMOVES the row rather than storing it. Storing
 * an agreement would freeze it: the person's créneau moves, the default moves with it, and a
 * stored "oui" that nobody ever typed would hold the old answer in place. What is kept is only
 * what the régisseur actually decided against the tool.
 */
export function setMealChoice(
  plan: Plan,
  kind: MealPersonKind,
  personKey: string,
  service: string,
  takes: boolean,
  fallback: boolean,
): MealChoice[] {
  const rest = plan.catering.choices.filter(
    (c) => !(c.personKind === kind && c.personKey === personKey && c.serviceKey === service),
  );
  return takes === fallback ? rest : [...rest, { personKind: kind, personKey, serviceKey: service, takes }];
}

// ---------------------------------------------------------------------------
// The file the caterer is sent
// ---------------------------------------------------------------------------

/**
 * One row per person, one column per service, plus what they cannot eat.
 *
 * WHY A LINE PER PERSON AND NOT A LINE PER SERVICE. The caterer counts plates from the totals
 * row, which any spreadsheet gives them; what they cannot get anywhere else is WHO is on a
 * special plate at which service. A per-service count would answer the easy half of the question
 * and lose the half that ends in somebody being handed the wrong meal.
 *
 * People who eat nothing at all are left out. They are in the plan for other reasons and a
 * caterer reading a hundred and twenty names with nothing beside them would stop reading.
 */
export function cateringCsv(plan: Plan, index: PlanIndex = new PlanIndex(plan)): string {
  const result = cateringReport(plan, index);
  const headers = [
    'Nom',
    'Rôle',
    ...result.services.map((s) => s.label),
    'Tickets boisson',
    'Régime alimentaire',
    'Allergies',
  ];

  const rows = result.people
    .filter((person) => person.serviceKeys.length > 0 || person.drinks > 0)
    .map((person) => [
      person.name,
      person.kind === 'orga'
        ? 'Orga'
        : person.kind === 'artiste'
          ? `Artiste (${person.group})`
          : 'Bénévole',
      ...result.services.map((s) => (person.serviceKeys.includes(s.key) ? 'x' : '')),
      String(person.drinks),
      person.diet.trim(),
      person.allergies.trim(),
    ]);

  // The totals, as a last line rather than a first: a spreadsheet sorts the names above it and
  // leaves it where it is, and the caterer reads it as a sum rather than as another person.
  rows.push([
    'TOTAL',
    '',
    ...result.fills.map((f) => String(f.total)),
    String(result.drinks),
    '',
    '',
  ]);

  return toCsv(headers, rows);
}
