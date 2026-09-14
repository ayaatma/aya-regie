/**
 * The validation engine. A pure function over a plan, producing everything shown in red plus
 * everything the dashboard reports.
 *
 * TWO TIERS, decided 2026-09-06. This split is the reason the solver can promise never to
 * return "infeasible".
 *
 *   Tier 1  Illegal. The solver must never produce one, and no re-solve may ever create one.
 *           It can still appear here, because the régisseur can override anything by hand and
 *           the tool must show them what they just did rather than refuse the edit.
 *
 *   Tier 2  Must not happen, but is reported rather than blocking. A shift left unstaffed, a
 *           volunteer under the 4h floor, a shift of nothing but débutants, a volunteer placed
 *           during the artist they asked not to miss. The régisseur wants the least-bad plan
 *           with the problems highlighted, never an error message.
 *
 * Everything soft (choice 1 versus choice 2, buddies, débutant spread, afternoon overflow) is
 * not an issue at all: it lands in the reports and the summary, because it is a quality
 * measure, not a fault.
 *
 * WHICH TIER IS THE EVENT'S TO SAY since 2026-09-13 (Réglages avancés, `constraints.ts`). A
 * criterion set to "block" reports at tier 1 and is refused by `isLegal`; set to "weight" it is
 * allowed, priced in the solver, and a breach of a rule that used to block is still reported at
 * tier 2; set to "off" it says nothing. The CODE of an issue never depends on the mode, only its
 * tier does, so a screen keying on a code keeps working whatever the event decided. Overlaps,
 * over-staffing, duplicates and dangling references are not criteria and stay tier 1 always.
 *
 * validate() never mutates the plan and never throws on bad data: a dangling reference is
 * itself a reported issue.
 */

import {
  demandHours,
  shiftHours,
  type Artist,
  type EventSlot,
  type PreferenceSlot,
  type SchedulingRules,
  type Shift,
  type SlotId,
  type Volunteer,
  type Window,
} from './model.js';
import { fitsAvailability, preferenceMisfit, preferredSlot } from './availability.js';
import { tierOf, type ResolvedConstraints } from './constraints.js';
import {
  PlanIndex,
  buildBlocks,
  fmtHours,
  overlaps,
  type Block,
  type Plan,
} from './plan.js';

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export type Tier = 1 | 2;

export interface ValidationIssue {
  tier: Tier;
  /** Stable kebab-case identifier. The UI keys its colours and filters off this, not the text. */
  code: string;
  /** French, addressed to the régisseur. */
  message: string;
  volunteerKeys: string[];
  shiftKeys: string[];
  poleKey: string | null;
}

/** Tier 1: an assignment that breaks a rule which must never be broken. */
export const TIER1 = {
  referenceInconnue: 'reference-inconnue',
  doublon: 'doublon',
  chevauchement: 'chevauchement',
  poleRefuse: 'pole-refuse',
  trancheRefusee: 'tranche-refusee',
  horsDisponibilite: 'hors-disponibilite',
  dureeConsecutive: 'duree-consecutive',
  tropDeBlocs: 'trop-de-blocs',
  pauseInsuffisante: 'pause-insuffisante',
  volumeDepasse: 'volume-depasse',
  sureffectif: 'sureffectif',
  dejaAffecte: 'deja-affecte',
  /** Only while a ranked event blocks "pas sur le premier choix". Tier 1 then, never otherwise. */
  pasChoix1: 'pas-choix-1',
  /** Only while the event blocks "hors de tous les choix". Tier 1 then, never otherwise. */
  horsChoix: 'hors-choix',
} as const;

/** Tier 2: a real problem, shown in red, that never stops the solver from returning a plan. */
export const TIER2 = {
  sansAffectation: 'sans-affectation',
  plancherNonAtteint: 'plancher-non-atteint',
  creneauVide: 'creneau-vide',
  creneauIncomplet: 'creneau-incomplet',
  queDesDebutants: 'que-des-debutants',
  experienceInsuffisante: 'experience-insuffisante',
  artisteManque: 'artiste-manque',
  creneauTropLong: 'creneau-trop-long',
  reserveInjustifiee: 'reserve-injustifiee',
  reserveAffectee: 'reserve-affectee',
  preferenceContrariee: 'preference-contrariee',
} as const;

/**
 * Issues about a shift as a whole, that no single box is guilty of.
 *
 * A shift of nothing but débutants is a problem with the shift, not with any of the débutants
 * standing in it: none of them did anything wrong, and reddening five boxes says five people are
 * at fault when the answer is to add one experienced person. Same for a shift over its
 * headcount, where the fix is to remove somebody but no box is the one to blame.
 *
 * They still name their assignees on the issue itself, so the dashboard and the gap diagnosis
 * can see who is involved. What they do not do is land in any one person's report: neither on
 * their box on the grid, nor in the list of signalements their panel shows, nor in the colour
 * of their row. Nothing about the individual is wrong, so nothing about the individual changes.
 */
export const SHIFT_SCOPED: ReadonlySet<string> = new Set<string>([
  TIER1.sureffectif,
  TIER2.queDesDebutants,
  TIER2.experienceInsuffisante,
  TIER2.creneauVide,
  TIER2.creneauIncomplet,
  TIER2.creneauTropLong,
]);

/** Codes that mean "this person cannot be here at this hour", whatever the reason. */
const AVAILABILITY_CODES: ReadonlySet<string> = new Set([
  TIER1.trancheRefusee,
  TIER1.horsDisponibilite,
]);

/** Codes that mean "this person is already working as much as the rules allow". */
const SATURATION_CODES: ReadonlySet<string> = new Set([
  TIER1.volumeDepasse,
  TIER1.chevauchement,
  TIER1.dureeConsecutive,
  TIER1.tropDeBlocs,
  TIER1.pauseInsuffisante,
]);

// ---------------------------------------------------------------------------
// The reusable legality predicate
// ---------------------------------------------------------------------------

export interface Blocker {
  code: string;
  message: string;
}

/**
 * The little slice of a plan the tier 1 rules actually read.
 *
 * `PlanIndex` implements it over an immutable plan; the solver's mutable working state
 * implements it too. That is the entire point of the interface: the rules are written once, and
 * the solver physically cannot drift from the validator by reimplementing them over its own
 * data structures. Anything that wants to ask "may this person work this shift" implements
 * these eight members and gets the real answer.
 */
export interface LegalityContext {
  readonly rules: SchedulingRules;
  /** Which criteria block for this event. Read on every placement, so resolved once up front. */
  readonly constraints: ResolvedConstraints;
  /** The preference tranches, for an event that blocks working outside them. */
  readonly preferenceSlots: readonly PreferenceSlot[];
  /** The rank a placement costs as: a position, 0 for all choices when unranked, null outside. */
  rankOf(volunteer: Volunteer, poleKey: string): number | null;
  /** Per day or for the whole event; see `days.ts`. */
  readonly dayMode: boolean;
  dayOf(hour: number): number;
  dayLabel(day: number): string;
  artistsClashing(volunteer: Volunteer, window: Window): Artist[];
  /** The slots the form asks about, so a refusal can be turned into hours. */
  readonly slots: readonly EventSlot[];
  shiftsOf(volunteerKey: string): readonly Shift[];
  assigneeCount(shiftKey: string): number;
  /**
   * The places a créneau still offers a volunteer, orgas standing in it taken out.
   *
   * The only thing the legality rules know about orgas: a créneau whose places are held by
   * orgas is full, and a volunteer placed there is over the effectif like any other.
   */
  headcountOf(shift: Shift): number;
  windowsOf(volunteerKey: string): readonly Window[];
  isUnder(poleKey: string, rootKey: string): boolean;
  polePath(poleKey: string): string;
  shiftLabel(shift: Shift): string;
  label(hours: number): string;
}

/**
 * The slice of a plan the legality rules need beyond the assignments themselves.
 *
 * The refused slots' windows used to be constants here. They are the régisseur's to set now,
 * so they arrive with the context like every other rule.
 */
const slotWindow = (ctx: LegalityContext, id: SlotId): Window | null => {
  const slot = ctx.slots.find((s) => s.id === id);
  return slot ? { start: slot.start, end: slot.end } : null;
};

/**
 * The refused root pole this shift sits under, or null when the volunteer refused none of them.
 *
 * Returns the first match rather than all of them on purpose: the sentence names one pole and
 * one is enough to make the placement illegal. Refusals are a list since 2026-09-08, and reading
 * only the first entry of that list is exactly the bug this replaced.
 */
function refusedRootOf(
  ctx: { isUnder(poleKey: string, rootKey: string): boolean },
  volunteer: Volunteer,
  poleKey: string,
): string | null {
  return volunteer.refusedPoleKeys.find((root) => ctx.isUnder(poleKey, root)) ?? null;
}

/** A violation plus just enough detail to render its sentence later, if anyone asks for one. */
interface Violation {
  code: string;
  /** The artist the shift runs across, for an event that blocks it. */
  artist?: Artist;
  /** The day a per-day rule was broken on, in day mode. */
  day?: number;
  /** The refused root pole this shift turned out to sit under, so the sentence can name it. */
  pole?: string;
  /** The refused slot the shift lands in, so the sentence names the right one of several. */
  slot?: SlotId;
  clash?: Shift;
  hours?: number;
  span?: number;
  blocks?: number;
  gap?: number;
}

/**
 * Why this volunteer cannot work this shift, at this exact moment of the plan.
 *
 * This is the single source of truth for tier 1. validate() uses it to explain an existing
 * assignment, the gap diagnosis uses it to count who could have taken a shift, and the solver
 * calls it before every single placement it makes. They must never drift apart, which is why
 * there is one function and not three.
 *
 * Empty means the placement is legal. Tier 2 is deliberately absent: an artist clash is a cost,
 * not a veto, and a shift must never stay empty to protect someone's set.
 *
 * `stopEarly` is for the solver's hot path, where the only question is yes or no. It changes
 * nothing about which placements are legal, only how much work is done before saying so.
 */
function violationsFor(
  ctx: LegalityContext,
  volunteer: Volunteer,
  shift: Shift,
  stopEarly: boolean,
  /** Which criteria to report: the blocking ones (legality), or the ones that only cost (a warning). */
  level: 'block' | 'weight' = 'block',
): Violation[] {
  const rules = ctx.rules;
  const found: Violation[] = [];
  const current = ctx.shiftsOf(volunteer.key);

  if (current.some((s) => s.key === shift.key)) return level === 'block' ? [{ code: TIER1.dejaAffecte }] : [];

  if (level === 'block' && ctx.assigneeCount(shift.key) >= ctx.headcountOf(shift)) {
    found.push({ code: TIER1.sureffectif });
    if (stopEarly) return found;
  }

  const c = ctx.constraints;

  if (c.refusedPole.mode === level) {
    const refusedRoot = refusedRootOf(ctx, volunteer, shift.poleKey);
    if (refusedRoot) {
      found.push({ code: TIER1.poleRefuse, pole: refusedRoot });
      if (stopEarly) return found;
    }
  }

  if (c.availability.mode === level) {
    const unavailable = availabilityViolation(ctx, volunteer, shift);
    if (unavailable) {
      found.push(unavailable);
      if (stopEarly) return found;
    }
  }

  // The four criteria below are soft on every event that never opened Réglages avancés, which is
  // why each is guarded by its mode before anything is computed: the solver's hot path pays for
  // a rule only on an event that made it one.
  // A rank step is not worth a warning on every choice 2, so only its blocking form is checked;
  // a placement outside all choices is, when it only costs.
  if (level === 'weight' && c.outsideChoices.mode === 'weight' && ctx.rankOf(volunteer, shift.poleKey) === null) {
    found.push({ code: TIER1.horsChoix });
  }

  if (level === 'block' && (c.notChoice1.mode === 'block' || c.outsideChoices.mode === 'block')) {
    // An unranked event has no first choice, so "pas sur le premier choix" cannot block there:
    // `rankOf` answers 0 for every choice and only a placement outside all of them is refused.
    const rank = ctx.rankOf(volunteer, shift.poleKey);
    if (c.notChoice1.mode === 'block' && rank !== 0) {
      found.push({ code: rank === null && c.outsideChoices.mode === 'block' ? TIER1.horsChoix : TIER1.pasChoix1 });
      if (stopEarly) return found;
    } else if (c.outsideChoices.mode === 'block' && rank === null) {
      found.push({ code: TIER1.horsChoix });
      if (stopEarly) return found;
    }
  }

  if (c.preference.mode === level) {
    const preferred = preferredSlot(ctx.preferenceSlots, volunteer.preferredSlotId);
    if (preferred && preferenceMisfit(preferred, shift).against > 1e-9) {
      found.push({ code: TIER2.preferenceContrariee, slot: preferred.id });
      if (stopEarly) return found;
    }
  }

  if (c.artist.mode === level) {
    const artist = ctx.artistsClashing(volunteer, shift)[0];
    if (artist) {
      found.push({ code: TIER2.artisteManque, artist });
      if (stopEarly) return found;
    }
  }

  // Everything below depends on the rest of the volunteer's day, so it is evaluated on the day
  // as it would be with this shift added.
  const projected = [...current, shift];
  // In day mode the volume is a figure per day, and only the day this shift starts in can have
  // gone over it by adding this shift.
  const day = ctx.dayMode ? ctx.dayOf(shift.start) : null;
  const hours = projected.reduce(
    (total, s) => (day === null || ctx.dayOf(s.start) === day ? total + shiftHours(s) : total),
    0,
  );

  if (c.volumeOver.mode === level && hours > volunteer.requestedHours + 1e-9) {
    found.push({ code: TIER1.volumeDepasse, hours, ...(day === null ? {} : { day }) });
    if (stopEarly) return found;
  }

  const clash = current.find((s) => overlaps(s, shift));
  if (clash && level === 'block') {
    found.push({ code: TIER1.chevauchement, clash });
    if (stopEarly) return found;
  }

  for (const violation of blockRuleViolations(buildBlocks(projected), rules, c, level, ctx.dayMode ? ctx.dayOf.bind(ctx) : null)) {
    found.push(violation);
    if (stopEarly) return found;
  }

  return found;
}

/**
 * Whether this person may be at this hour at all, and if not, why.
 *
 * Split out because validate() needs it on an assignment that already exists, where the rest of
 * violationsFor() would answer "déjà affecté" and stop.
 */
function availabilityViolation(
  ctx: LegalityContext,
  volunteer: Volunteer,
  shift: Shift,
): Violation | null {
  // NO RULE READS `preferredSlotId` HERE, AND NONE MAY. Until 2026-09-08 two rules did, and they
  // turned the answer to "Qu'est ce que tu préfères ?" into a veto. It is scored in the solver
  // and reported as a tier 2 signalement; the hard answer about time is the refused slots below.
  //
  // A refusal naming a slot the plan no longer has is simply not a refusal any more. Slots are
  // configuration; a volunteer keeps the answer they gave, and it stops applying.
  for (const id of volunteer.refusedSlotIds) {
    const refused = slotWindow(ctx, id);
    if (refused && overlaps(shift, refused)) return { code: TIER1.trancheRefusee, slot: id };
  }
  if (!fitsAvailability(ctx.windowsOf(volunteer.key), shift)) {
    return { code: TIER1.horsDisponibilite };
  }
  return null;
}

/**
 * The three block rules: 4h in a row, at most 2 blocks, at least 2h of break between them.
 *
 * `only` picks the criteria to check: the legality question wants the blocking ones, the report
 * of an existing day wants every one that is not off, and the caller says which tier each is at.
 */
function blockRuleViolations(
  blocks: readonly Block[],
  rules: SchedulingRules,
  c: ResolvedConstraints,
  only: 'block' | 'weight' | 'reported',
  /** In day mode, the day of an hour: the block count is then per day. Null counts the event. */
  dayOf: ((hour: number) => number) | null = null,
): Violation[] {
  const found: Violation[] = [];
  const checks = (mode: string): boolean => (only === 'reported' ? mode !== 'off' : mode === only);

  if (checks(c.maxConsecutive.mode)) {
    const tooLong = blocks.find((b) => b.end - b.start > rules.maxConsecutiveHours + 1e-9);
    if (tooLong) found.push({ code: TIER1.dureeConsecutive, span: tooLong.end - tooLong.start });
  }

  if (checks(c.maxBlocks.mode)) {
    if (dayOf === null) {
      if (blocks.length > rules.maxBlocks) found.push({ code: TIER1.tropDeBlocs, blocks: blocks.length });
    } else {
      const perDay = new Map<number, number>();
      for (const b of blocks) perDay.set(dayOf(b.start), (perDay.get(dayOf(b.start)) ?? 0) + 1);
      const worst = [...perDay.entries()].find(([, n]) => n > rules.maxBlocks);
      if (worst) found.push({ code: TIER1.tropDeBlocs, blocks: worst[1], day: worst[0] });
    }
  }

  if (checks(c.minBreak.mode)) for (let i = 1; i < blocks.length; i++) {
    const gap = blocks[i]!.start - blocks[i - 1]!.end;
    if (gap < rules.minBreakHours - 1e-9) {
      found.push({ code: TIER1.pauseInsuffisante, gap });
      break;
    }
  }

  return found;
}

/** Renders one violation as the sentence the régisseur reads. */
function describe(
  ctx: LegalityContext,
  volunteer: Volunteer,
  shift: Shift | null,
  violation: Violation,
): string {
  const rules = ctx.rules;
  switch (violation.code) {
    case TIER1.dejaAffecte:
      return 'Ce bénévole occupe déjà ce créneau.';
    case TIER1.sureffectif:
      return `Le créneau est déjà complet (${shift ? ctx.headcountOf(shift) : 0} place(s) pour les bénévoles).`;
    case TIER1.poleRefuse:
      return `Pôle refusé: "${ctx.polePath(shift!.poleKey)}" dépend de ` +
             `"${ctx.polePath(violation.pole!)}".`;
    case TIER1.trancheRefusee: {
      // The label, not the id: the id is what the answer stores, the label is what the form
      // asked and therefore what the régisseur recognises. A slot deleted since keeps its id.
      const slot = ctx.slots.find((s) => s.id === violation.slot);
      return `Tranche refusée: le créneau empiète sur ${slot?.label ?? violation.slot}.`;
    }
    case TIER1.horsDisponibilite:
      return 'Le créneau ne tient dans aucune de ses fenêtres de disponibilité.';
    case TIER1.volumeDepasse:
      return violation.day === undefined
        ? `Dépasse le volume demandé: ${fmtHours(violation.hours!)} pour ${volunteer.requestedHours}h demandées.`
        : `Dépasse le volume demandé le ${ctx.dayLabel(violation.day)}: ${fmtHours(violation.hours!)} pour ` +
          `${volunteer.requestedHours}h demandées par jour.`;
    case TIER1.chevauchement:
      return `Chevauche "${ctx.shiftLabel(violation.clash!)}".`;
    case TIER1.dureeConsecutive:
      return `${fmtHours(violation.span!)} d'affilée pour un maximum de ` +
             `${rules.maxConsecutiveHours}h, pôles confondus.`;
    case TIER1.tropDeBlocs:
      return violation.day === undefined
        ? `${violation.blocks} blocs de travail pour un maximum de ${rules.maxBlocks}.`
        : `${violation.blocks} blocs de travail le ${ctx.dayLabel(violation.day)} pour un maximum de ${rules.maxBlocks} par jour.`;
    case TIER1.pauseInsuffisante:
      return `Pause de ${fmtHours(violation.gap!)} entre deux blocs, minimum ${rules.minBreakHours}h.`;
    case TIER1.pasChoix1:
      return `"${ctx.polePath(shift!.poleKey)}" n'est pas son premier choix, et cet événement n'autorise que le premier choix.`;
    case TIER1.horsChoix:
      return `"${ctx.polePath(shift!.poleKey)}" ne fait partie d'aucun de ses choix, et cet événement ne l'autorise pas.`;
    case TIER2.preferenceContrariee: {
      const slot = ctx.preferenceSlots.find((s) => s.id === violation.slot);
      return `Le créneau sort de la tranche préférée « ${slot?.label ?? violation.slot} » et de son débordement accepté.`;
    }
    case TIER2.artisteManque:
      return `Le créneau tombe pendant ${violation.artist!.name}, cité comme à ne pas manquer.`;
    default:
      return violation.code;
  }
}

/** Every reason this placement is illegal, each with its sentence. Empty means legal. */
export function blockersFor(ctx: LegalityContext, volunteer: Volunteer, shift: Shift): Blocker[] {
  return violationsFor(ctx, volunteer, shift, false).map((v) => ({
    code: v.code,
    message: describe(ctx, volunteer, shift, v),
  }));
}

/**
 * What this placement would COST, as sentences: the criteria it breaches that the event only
 * weighs. Never a reason to refuse; what the grid says under a drop that is allowed but not free,
 * so a régisseur who loosened a rule still sees it being bent. Empty for a placement that costs
 * nothing beyond the ordinary (a second choice, an hour under the volume).
 */
export function costsFor(ctx: LegalityContext, volunteer: Volunteer, shift: Shift): Blocker[] {
  return violationsFor(ctx, volunteer, shift, false, 'weight').map((v) => ({
    code: v.code,
    // The blocking sentence says the event forbids it; here it does not.
    message: v.code === TIER1.horsChoix
      ? `"${ctx.polePath(shift.poleKey)}" ne fait partie d'aucun de ses choix.`
      : describe(ctx, volunteer, shift, v),
  }));
}

/**
 * The same question with a yes-or-no answer and no sentences built. This is what the solver
 * calls, millions of times, and it goes through the very same rules.
 */
export function isLegal(ctx: LegalityContext, volunteer: Volunteer, shift: Shift): boolean {
  return violationsFor(ctx, volunteer, shift, true).length === 0;
}

/** The block rules alone, for a day that already exists rather than one being proposed. */
function blockRuleBlockers(
  ctx: LegalityContext,
  volunteer: Volunteer,
  blocks: readonly Block[],
): Blocker[] {
  return blockRuleViolations(blocks, ctx.rules, ctx.constraints, 'reported', ctx.dayMode ? ctx.dayOf.bind(ctx) : null).map((v) => ({
    code: v.code,
    message: describe(ctx, volunteer, null, v),
  }));
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** The colour a volunteer's row carries on the grid. Red always wins. */
export type VolunteerColour = 'rouge' | 'orange-fonce' | 'orange-clair' | 'aucune';

export interface BuddyOutcome {
  toKey: string;
  toName: string;
  honoured: boolean;
  /** Shifts the two share. Honouring means same shift, which means same sub-pole and same time. */
  sharedShiftKeys: string[];
}

export interface VolunteerReport {
  key: string;
  name: string;
  /** Held in reserve: no shift, on purpose, and not an error. */
  reserve: boolean;
  /** The volume asked for, as answered: per day in day mode. */
  requestedHours: number;
  /** What the plan owes: `requestedHours`, times the days the person can work in day mode. */
  requestedTotalHours: number;
  assignedHours: number;
  /** Hours per day of the event, each shift on the day it starts. One entry for a short event. */
  hoursByDay: number[];
  blocks: Block[];
  colour: VolunteerColour;
  /**
   * The long-day band on its own: 8h, 6h, or neither.
   *
   * `colour` answers "what does this person's row look like", and red wins there, which means a
   * volunteer with any problem at all stops reporting that they are down for eight hours. The
   * grid needs both facts at once, so the band is published separately. It is not a fault and
   * never reads as one.
   */
  volumeBand: Exclude<VolunteerColour, 'rouge'>;
  /**
   * Person-hours by the rank of the choice they honour: index 0 is the first choice, 1 the
   * second, and so on. An unranked event puts every choice at 0. The hours outside all choices
   * are `hoursOutside`. Was `{ choix1, choix2, horsChoix }` until 2026-09-14.
   */
  hoursByRank: number[];
  hoursOutside: number;
  /** Paths of the poles they were placed in without having chosen them. Listed on the dashboard. */
  horsChoixPoles: string[];
  /**
   * Hours that ran past the boundary but stayed inside the overflow the régisseur accepts.
   *
   * Shown, because the régisseur asked to see it, and deliberately not an issue: this is the
   * "ses créneaux pourront dépasser un peu sur la soirée" case working as intended.
   */
  toleratedOverflowHours: number;
  /**
   * Hours worked flatly against what the volunteer said they would rather do.
   *
   * Past the accepted overflow for an "après-midi" answer, or before the boundary for a
   * "soirée" one. Costly in the solver and raised as a tier 2 signalement, never illegal.
   */
  againstPreferenceHours: number;
  buddies: BuddyOutcome[];
  issues: ValidationIssue[];
}

export interface GapDiagnosis {
  missing: number;
  /** Volunteers who could legally take a place on this shift right now. */
  disponibles: number;
  indisponibles: number;
  refusentLePole: number;
  satures: number;
  /** Among the available ones, those who would then miss an artist they named. */
  artisteEnJeu: number;
  /** Volunteers on reserve who could take it. Filling this gap means calling one of them up. */
  enReserve: number;
  /** One French sentence, dominant reason first. This is what the recruitment view shows. */
  raison: string;
}

export interface ShiftReport {
  key: string;
  poleKey: string;
  polePath: string;
  start: number;
  end: number;
  label: string;
  /** What the créneau asks for in total. Orgas standing in it fill some of these places. */
  headcount: number;
  assigned: number;
  /** Places still to fill with volunteers: `headcount` minus the orgas minus the assignees. */
  missing: number;
  /**
   * Orgas the régisseur put in this créneau by hand.
   *
   * Drawn on the grid inside the créneau, above the volunteers, and counted in nothing else: an
   * orga has no level, no volume and no preference to report on. See `OrganiserShift`.
   */
  orgas: Array<{ key: string; name: string; short: string }>;
  /**
   * One entry per assignee, in the order they appear.
   *
   * `level` drives the stars on the grid, and `issues` are the ones that belong to this box and
   * to no other: what makes this person, on this shift, a problem. A volunteer with a clash on
   * their evening shift carries nothing here on their afternoon one.
   */
  stars: Array<{
    volunteerKey: string;
    name: string;
    /**
     * The same person, cut to fit a grid box: their nickname or first name, then only as much of
     * the surname as it takes to tell them apart from everybody else.
     *
     * Never derived from `name` by the screen that draws it. Whether one letter of a surname is
     * enough is a question about the whole roster, and a box knows nothing about the roster.
     * See `display.ts`.
     */
    short: string;
    level: ReturnType<PlanIndex['levelIn']>;
    issues: ValidationIssue[];
  }>;
  gap: GapDiagnosis | null;
  issues: ValidationIssue[];
}

export interface ArtistReport {
  key: string;
  name: string;
  window: string;
  /** Volunteers who asked not to miss this set. */
  namedBy: number;
  /** Of those, the ones the plan places during it. Each is a tier 2 issue. */
  assignedDuring: number;
  /** Person-hours the shifts need while the set runs. High demand plus high naming is the trap. */
  demandHours: number;
}

export interface PlanSummary {
  demandHours: number;
  assignedHours: number;
  offeredHours: number;
  gapHours: number;

  shiftsTotal: number;
  shiftsFilled: number;
  shiftsPartial: number;
  shiftsEmpty: number;

  volunteersTotal: number;
  /** At zero hours without being on reserve, which is the number that needs acting on. */
  volunteersUnassigned: number;
  volunteersOnReserve: number;
  volunteersBelowFloor: number;
  volunteersAtRequested: number;

  /** Person-hours by rank, as `VolunteerReport.hoursByRank`, summed over everybody. */
  hoursByRank: number[];
  hoursHorsChoix: number;
  /** Every volunteer placed outside all their choices. The brief asks for the list, not a count. */
  horsChoix: Array<{ volunteerKey: string; name: string; poles: string[] }>;

  buddyRequests: number;
  buddyHonoured: number;

  /** Missing person-hours per configured slot, in the order the slots are declared. */
  gapsBySlot: Array<{ id: SlotId; label: string; hours: number }>;
  gapsByPole: Array<{ poleKey: string; path: string; gapHours: number }>;

  tier1Count: number;
  tier2Count: number;
  /** Counts per code, both tiers, so the dashboard can rank the problems. */
  byCode: Array<{ tier: Tier; code: string; count: number }>;

  /** Over-recruitment signal: past this many volunteers, somebody necessarily falls under 4h. */
  volunteerCeiling: number;
  overRecruited: boolean;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  volunteers: VolunteerReport[];
  shifts: ShiftReport[];
  artists: ArtistReport[];
  summary: PlanSummary;
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

export function validate(plan: Plan): ValidationResult {
  const index = new PlanIndex(plan);
  const rules = plan.rules;
  const c = index.constraints;
  const issues: ValidationIssue[] = [];

  const add = (
    tier: Tier,
    code: string,
    message: string,
    refs: { volunteers?: string[]; shifts?: string[]; pole?: string | null } = {},
  ): void => {
    issues.push({
      tier,
      code,
      message,
      volunteerKeys: refs.volunteers ?? [],
      shiftKeys: refs.shifts ?? [],
      poleKey: refs.pole ?? null,
    });
  };

  // --- Integrity. Bad references are reported, then left out of everything else. ------------
  for (const a of index.broken) {
    add(1, TIER1.referenceInconnue,
      `Affectation orpheline: bénévole "${a.volunteerKey}" ou créneau "${a.shiftKey}" introuvable.`,
      { volunteers: [a.volunteerKey], shifts: [a.shiftKey] });
  }
  for (const a of index.duplicates) {
    add(1, TIER1.doublon,
      `${index.volunteerName(a.volunteerKey)} apparaît deux fois sur le même créneau.`,
      { volunteers: [a.volunteerKey], shifts: [a.shiftKey] });
  }

  // --- Reference data. A shift longer than the consecutive cap can never be staffed legally. -
  // Only while the cap blocks: priced, a long créneau can be held, at a cost the solver weighs.
  for (const shift of c.maxConsecutive.mode === 'block' ? plan.shifts : []) {
    if (shiftHours(shift) > rules.maxConsecutiveHours + 1e-9) {
      add(2, TIER2.creneauTropLong,
        `Créneau de ${fmtHours(shiftHours(shift))} alors que le maximum d'affilée est ` +
        `${rules.maxConsecutiveHours}h: aucun bénévole ne peut le tenir en entier. À découper.`,
        { shifts: [shift.key], pole: shift.poleKey });
    }
  }

  // --- Per volunteer --------------------------------------------------------------------
  for (const volunteer of plan.volunteers) {
    const shifts = [...index.shiftsOf(volunteer.key)].sort((a, b) => a.start - b.start);
    const hours = index.hoursOf(volunteer.key);
    const name = index.volunteerName(volunteer.key);
    const blocks = buildBlocks(shifts);

    for (const shift of shifts) {
      const refusedRoot = tierOf(c.refusedPole) === null ? null : refusedRootOf(index, volunteer, shift.poleKey);
      if (refusedRoot) {
        add(tierOf(c.refusedPole)!, TIER1.poleRefuse,
          `${name} : placement dans "${index.polePath(shift.poleKey)}", qui dépend du pôle ` +
          `refusé ("${index.polePath(refusedRoot)}").`,
          { volunteers: [volunteer.key], shifts: [shift.key], pole: shift.poleKey });
      }

      const unavailable = tierOf(c.availability) === null ? null : availabilityViolation(index, volunteer, shift);
      if (unavailable) {
        add(tierOf(c.availability)!, unavailable.code,
          `${name} : placement sur "${index.shiftLabel(shift)}". ${describe(index, volunteer, shift, unavailable)}`,
          { volunteers: [volunteer.key], shifts: [shift.key], pole: shift.poleKey });
      }

      const rank = index.rankOf(volunteer, shift.poleKey);
      if (c.outsideChoices.mode === 'block' && rank === null) {
        add(1, TIER1.horsChoix,
          `${name} : placement sur "${index.polePath(shift.poleKey)}", hors de tous ses choix. ` +
          `Cet événement ne l'autorise pas.`,
          { volunteers: [volunteer.key], shifts: [shift.key], pole: shift.poleKey });
      } else if (c.notChoice1.mode === 'block' && rank !== 0) {
        add(1, TIER1.pasChoix1,
          `${name} : placement sur "${index.polePath(shift.poleKey)}", qui n'est pas son premier choix. ` +
          `Cet événement n'autorise que le premier choix.`,
          { volunteers: [volunteer.key], shifts: [shift.key], pole: shift.poleKey });
      }

      for (const artist of tierOf(c.artist) === null ? [] : index.artistsClashing(volunteer, shift)) {
        add(tierOf(c.artist)!, TIER2.artisteManque,
          `${name} rate ${artist.name} (${index.label(artist.start)} -> ${index.label(artist.end)}), ` +
          `artiste cité comme à ne pas manquer.`,
          { volunteers: [volunteer.key], shifts: [shift.key], pole: shift.poleKey });
      }
    }

    // The preference, reported once for the person rather than once per shift: what the
    // régisseur acts on is "this one is working against what they answered", not which hour of
    // it. Only the part beyond the accepted overflow counts. Never tier 1, by construction.
    const preferred = preferredSlot(plan.preferenceSlots, volunteer.preferredSlotId);
    const against = shifts.reduce(
      (total, shift) => total + preferenceMisfit(preferred, shift).against,
      0,
    );
    if (preferred && against > 1e-9 && tierOf(c.preference) !== null) {
      const band = preferred.overflowHours > 0
        ? `, au-delà du débordement accepté de ${fmtHours(preferred.overflowHours)}`
        : '';
      add(tierOf(c.preference)!, TIER2.preferenceContrariee,
        `${name} a répondu préférer « ${preferred.label} » (${index.label(preferred.start)} -> ` +
        `${index.label(preferred.end)}) et travaille ${fmtHours(against)} en dehors${band}.`,
        { volunteers: [volunteer.key], shifts: shifts.map((s) => s.key) });
    }

    // Overlaps are reported per pair, on the sorted list, so each pair is named once.
    for (let i = 0; i < shifts.length; i++) {
      for (let j = i + 1; j < shifts.length; j++) {
        const a = shifts[i]!;
        const b = shifts[j]!;
        if (!overlaps(a, b)) break;
        add(1, TIER1.chevauchement,
          `${name} est sur deux créneaux en même temps: "${index.shiftLabel(a)}" et ` +
          `"${index.shiftLabel(b)}".`,
          { volunteers: [volunteer.key], shifts: [a.key, b.key] });
      }
    }

    for (const blocker of blockRuleBlockers(index, volunteer, blocks)) {
      const criterion = blocker.code === TIER1.dureeConsecutive ? c.maxConsecutive
        : blocker.code === TIER1.tropDeBlocs ? c.maxBlocks
        : c.minBreak;
      add(tierOf(criterion)!, blocker.code, `${name}: ${blocker.message}`,
        { volunteers: [volunteer.key], shifts: shifts.map((s) => s.key) });
    }

    const byDay = index.hoursByDay(shifts);
    if (tierOf(c.volumeOver) !== null) {
      if (!index.dayMode && hours > volunteer.requestedHours + 1e-9) {
        add(tierOf(c.volumeOver)!, TIER1.volumeDepasse,
          `${name} totalise ${fmtHours(hours)} pour ${volunteer.requestedHours}h demandées.`,
          { volunteers: [volunteer.key], shifts: shifts.map((s) => s.key) });
      }
      if (index.dayMode) byDay.forEach((dayHours, day) => {
        if (dayHours <= volunteer.requestedHours + 1e-9) return;
        add(tierOf(c.volumeOver)!, TIER1.volumeDepasse,
          `${name} totalise ${fmtHours(dayHours)} le ${index.dayLabel(day)} pour ${volunteer.requestedHours}h demandées par jour.`,
          { volunteers: [volunteer.key], shifts: shifts.filter((s) => index.dayOf(s.start) === day).map((s) => s.key) });
      });
    }

    if (index.isReserve(volunteer.key)) {
      // Zero hours is the whole point of being on reserve, so it is never an error here.
      // Holding a shift while on reserve is, because the two states contradict each other.
      if (shifts.length > 0) {
        add(2, TIER2.reserveAffectee,
          `${name} est en réserve mais occupe ${shifts.length} créneau(x). À sortir de la réserve.`,
          { volunteers: [volunteer.key], shifts: shifts.map((s) => s.key) });
      }
    } else if (shifts.length === 0) {
      add(2, TIER2.sansAffectation,
        `${name} n'a aucun créneau et n'est pas en réserve. Personne ne doit finir à 0h par accident.`,
        { volunteers: [volunteer.key] });
    } else if (c.floor.mode !== 'off' && !index.dayMode && hours < rules.minHoursPerPerson - 1e-9) {
      add(2, TIER2.plancherNonAtteint,
        `${name} totalise ${fmtHours(hours)}, sous le plancher de ${rules.minHoursPerPerson}h.`,
        { volunteers: [volunteer.key], shifts: shifts.map((s) => s.key) });
    } else if (c.floor.mode !== 'off' && index.dayMode) {
      // Per day, and only on a day somebody works: a day off is not a day under the floor.
      byDay.forEach((dayHours, day) => {
        if (dayHours <= 1e-9 || dayHours >= rules.minHoursPerPerson - 1e-9) return;
        add(2, TIER2.plancherNonAtteint,
          `${name} totalise ${fmtHours(dayHours)} le ${index.dayLabel(day)}, sous le plancher de ${rules.minHoursPerPerson}h par jour.`,
          { volunteers: [volunteer.key], shifts: shifts.filter((s) => index.dayOf(s.start) === day).map((s) => s.key) });
      });
    }
  }

  // --- Per shift -------------------------------------------------------------------------
  for (const shift of plan.shifts) {
    const assignees = index.assigneesOf(shift.key);
    const pole = index.poleByKey.get(shift.poleKey);
    const where = index.shiftLabel(shift);

    /*
     * The places left for volunteers, orgas standing in the créneau taken out. An orga put on the
     * bar at 2h by hand means the bar needs one volunteer fewer there, and every count below says
     * so: no gap that is already covered, no "incomplet" on a créneau that is in fact full.
     */
    const wanted = index.headcountOf(shift);
    const orgas = index.orgasOn(shift.key);
    const withOrgas = orgas.length === 0 ? '' : ` (${orgas.length} orga(s) sur place)`;

    if (assignees.length > wanted) {
      add(1, TIER1.sureffectif,
        `"${where}" compte ${assignees.length} bénévoles pour ${wanted} place(s)${withOrgas}.`,
        { shifts: [shift.key], volunteers: assignees.map((v) => v.key), pole: shift.poleKey });
    }

    if (wanted === 0 && assignees.length === 0) {
      // Held entirely by orgas: nothing to pourvoir and nothing wrong. Saying "vide" here would
      // put a red line on the dashboard for a créneau the régisseur has just staffed by hand.
    } else if (assignees.length === 0) {
      add(2, TIER2.creneauVide,
        `"${where}" est vide: ${wanted} place(s) à pourvoir${withOrgas}.`,
        { shifts: [shift.key], pole: shift.poleKey });
    } else if (assignees.length < wanted) {
      add(2, TIER2.creneauIncomplet,
        `"${where}": ${assignees.length} bénévole(s) sur ${wanted}${withOrgas}.`,
        { shifts: [shift.key], volunteers: assignees.map((v) => v.key), pole: shift.poleKey });
    } else {
      // Experience is only judged on a full shift. An incomplete one is already red for being
      // incomplete, and its missing people may well be the experienced ones. Reporting both
      // would put three red rows on the dashboard for a single problem.
      const experienced = assignees.filter((v) => {
        const level = index.levelIn(v, shift.poleKey);
        return level === 'intermediaire' || level === 'expert';
      });

      if (experienced.length === 0 && !pole?.allowAllDebutants && c.allDebutants.mode !== 'off') {
        add(2, TIER2.queDesDebutants,
          `"${where}" ne compte que des débutants (${assignees.length} personnes).`,
          { shifts: [shift.key], volunteers: assignees.map((v) => v.key), pole: shift.poleKey });
      }

      const required = pole?.minExperienced ?? 0;
      if (experienced.length < required && c.minExperienced.mode !== 'off') {
        add(2, TIER2.experienceInsuffisante,
          `"${where}" demande ${required} bénévole(s) expérimenté(s) et n'en a que ${experienced.length}.`,
          { shifts: [shift.key], volunteers: assignees.map((v) => v.key), pole: shift.poleKey });
      }
    }
  }

  // A reserve list only makes sense while there is nothing to give those people. The moment a
  // gap appears that one of them could legally fill, the list is stale and someone should be
  // called up. This is what catches a reserve built before shifts were added or before a
  // cancellation freed room.
  for (const volunteer of plan.volunteers) {
    if (!index.isReserve(volunteer.key)) continue;
    const opening = plan.shifts.find(
      (s) => index.assigneeCount(s.key) < index.headcountOf(s) && isLegal(index, volunteer, s),
    );
    if (opening) {
      add(2, TIER2.reserveInjustifiee,
        `${index.volunteerName(volunteer.key)} est en réserve alors que ` +
        `"${index.shiftLabel(opening)}" manque de monde et lui conviendrait. À rappeler.`,
        { volunteers: [volunteer.key], shifts: [opening.key], pole: opening.poleKey });
    }
  }

  return buildResult(index, issues);
}

// ---------------------------------------------------------------------------
// Reports and summary
// ---------------------------------------------------------------------------

function diagnoseGap(index: PlanIndex, shift: Shift, missing: number): GapDiagnosis {
  let disponibles = 0;
  let indisponibles = 0;
  let refusentLePole = 0;
  let satures = 0;
  let artisteEnJeu = 0;
  let enReserve = 0;

  const assigned = new Set(index.assigneesOf(shift.key).map((v) => v.key));

  for (const volunteer of index.plan.volunteers) {
    if (assigned.has(volunteer.key)) continue;
    const codes = new Set(blockersFor(index, volunteer, shift).map((b) => b.code));

    // Priority is deliberate and is what makes the answer useful for recruitment: "nobody is
    // available at that hour" is a different problem from "everybody available vetoed the pole",
    // which is different again from "everybody available is already full".
    if ([...codes].some((c) => AVAILABILITY_CODES.has(c))) indisponibles++;
    else if (codes.has(TIER1.poleRefuse)) refusentLePole++;
    else if ([...codes].some((c) => SATURATION_CODES.has(c))) satures++;
    else if (index.isReserve(volunteer.key)) enReserve++;
    else {
      disponibles++;
      if (index.artistsClashing(volunteer, shift).length > 0) artisteEnJeu++;
    }
  }

  const detail = `${indisponibles} indisponibles à cette heure, ${refusentLePole} refusent ce pôle, ` +
                 `${satures} déjà au maximum de leurs heures`;

  return {
    missing,
    disponibles,
    indisponibles,
    refusentLePole,
    satures,
    artisteEnJeu,
    enReserve,
    raison: gapReason({ disponibles, indisponibles, refusentLePole, satures, artisteEnJeu, enReserve, detail }),
  };
}

/**
 * The sentence the recruitment view shows, and the only part of the diagnosis that makes a
 * judgement call.
 *
 * The dominant reason is NOT the biggest number. Under a shortage almost everyone is at their
 * maximum, so saturation wins every count while explaining nothing: it is the background state,
 * not a cause. The reasons are ranked by how specific a lever they hand the régisseur instead,
 * from narrowest to broadest, and the narrowest one that accounts for a real share of the
 * blocked pool wins.
 *
 *   indisponible     recruit for this time slot, nothing else will do
 *   refus de pôle    this pole is shunned, recruit for it or make it less unattractive
 *   saturé           recruit anybody at all
 */
const MATERIAL_SHARE = 0.25;

function gapReason(parts: {
  disponibles: number;
  indisponibles: number;
  refusentLePole: number;
  satures: number;
  artisteEnJeu: number;
  enReserve: number;
  detail: string;
}): string {
  const { disponibles, indisponibles, refusentLePole, satures, artisteEnJeu, enReserve, detail } = parts;

  // The reserve comes first whatever else is true: it is the one gap with a phone number
  // attached to it, and the régisseur can close it this afternoon.
  if (enReserve > 0) {
    return `${enReserve} bénévole(s) en réserve peuvent le prendre: c'est le moment de les rappeler. ` +
           `Par ailleurs ${detail}.`;
  }

  if (disponibles > 0) {
    const extra = artisteEnJeu > 0
      ? ` Dont ${artisteEnJeu} qui rateraient un artiste qu'ils ont cité.`
      : '';
    return `${disponibles} bénévole(s) pourraient le prendre: la contrainte est ailleurs dans le plan. ` +
           `Par ailleurs ${detail}.${extra}`;
  }

  const blocked = indisponibles + refusentLePole + satures;
  if (blocked === 0) return 'Aucun bénévole inscrit ne peut être évalué sur ce créneau.';

  const material = (n: number) => n / blocked >= MATERIAL_SHARE;
  const largest = Math.max(indisponibles, refusentLePole, satures);

  if (material(indisponibles) || indisponibles === largest) {
    return `Personne ne peut le prendre, d'abord par indisponibilité horaire: ${detail}. ` +
           `C'est un manque de bénévoles sur cette tranche, aucun plan ne le corrigera.`;
  }
  if (material(refusentLePole) || refusentLePole === largest) {
    return `Personne ne peut le prendre, et le refus de pôle pèse lourd: ${detail}. ` +
           `Ce pôle est boudé autant qu'il est mal placé dans l'horaire.`;
  }
  return `Personne ne peut le prendre: tout le monde est déjà au maximum (${detail}). ` +
         `Il manque des heures, pas des disponibilités.`;
}

function buildResult(index: PlanIndex, issues: ValidationIssue[]): ValidationResult {
  const plan = index.plan;
  const rules = plan.rules;

  const issuesByVolunteer = new Map<string, ValidationIssue[]>();
  const issuesByShift = new Map<string, ValidationIssue[]>();
  /**
   * Issues down to the individual box: this volunteer, on this shift.
   *
   * The grid draws one box per volunteer needed, and a problem belongs to the box it is about.
   * Someone placed during a set they asked not to miss has a problem with that evening shift,
   * not with the afternoon one they are also down for, and colouring both would send the
   * régisseur looking for a fault that is not there. Every tier 1 rule already names the shifts
   * it implicates, including the whole-day ones, which name all of them because the whole day
   * really is at fault.
   *
   * `SHIFT_SCOPED` codes are deliberately left out: they are about the shift, and marking every
   * box in it would accuse five people of a problem that belongs to the shift's composition.
   */
  const issuesByBox = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const volunteerKeys = new Set(issue.volunteerKeys);
    const shiftKeys = new Set(issue.shiftKeys);
    for (const key of shiftKeys) {
      issuesByShift.set(key, [...(issuesByShift.get(key) ?? []), issue]);
    }
    // A shift-wide problem is not something wrong with the people standing in it, so it stays
    // out of their reports too. It would otherwise turn every volunteer on an all-débutants
    // shift red and fill their panel with a signalement they can do nothing about.
    if (SHIFT_SCOPED.has(issue.code)) continue;
    for (const key of volunteerKeys) {
      issuesByVolunteer.set(key, [...(issuesByVolunteer.get(key) ?? []), issue]);
    }
    for (const volunteerKey of volunteerKeys) {
      for (const shiftKey of shiftKeys) {
        const box = `${volunteerKey}|${shiftKey}`;
        issuesByBox.set(box, [...(issuesByBox.get(box) ?? []), issue]);
      }
    }
  }

  // --- Volunteers ------------------------------------------------------------------------
  const buddiesFrom = new Map<string, string[]>();
  for (const pair of plan.buddies) {
    buddiesFrom.set(pair.fromKey, [...(buddiesFrom.get(pair.fromKey) ?? []), pair.toKey]);
  }

  const longDay = {
    long: plan.constraints?.longDayHours ?? 6,
    very: plan.constraints?.veryLongDayHours ?? 8,
  };
  const volunteers: VolunteerReport[] = plan.volunteers.map((volunteer) => {
    const shifts = [...index.shiftsOf(volunteer.key)].sort((a, b) => a.start - b.start);
    const assignedHours = index.hoursOf(volunteer.key);
    const own = issuesByVolunteer.get(volunteer.key) ?? [];

    const hoursByRank: number[] = [];
    let hoursOutside = 0;
    const horsChoixPoles = new Set<string>();
    let toleratedOverflowHours = 0;
    let againstPreferenceHours = 0;

    const preferred = preferredSlot(plan.preferenceSlots, volunteer.preferredSlotId);
    for (const shift of shifts) {
      const rank = index.rankOf(volunteer, shift.poleKey);
      if (rank === null) {
        hoursOutside += shiftHours(shift);
        horsChoixPoles.add(index.polePath(shift.poleKey));
      } else {
        while (hoursByRank.length <= rank) hoursByRank.push(0);
        hoursByRank[rank]! += shiftHours(shift);
      }
      const misfit = preferenceMisfit(preferred, shift);
      toleratedOverflowHours += misfit.tolerated;
      againstPreferenceHours += misfit.against;
    }

    const buddies: BuddyOutcome[] = (buddiesFrom.get(volunteer.key) ?? []).map((toKey) => {
      const theirs = new Set(index.shiftsOf(toKey).map((s) => s.key));
      const shared = shifts.filter((s) => theirs.has(s.key)).map((s) => s.key);
      return {
        toKey,
        toName: index.volunteerName(toKey),
        honoured: shared.length > 0,
        sharedShiftKeys: shared,
      };
    });

    // Where a day reads long is the event's since 2026-09-13: 6 h and 8 h were the Loto Tekno
    // form's own volumes. See `ConstraintSettings.longDayHours`.
    // A long DAY: on an event counted per day, the longest of them.
    const hoursByDay = index.hoursByDay(shifts);
    const dayLength = index.dayMode ? Math.max(0, ...hoursByDay) : assignedHours;
    const band: Exclude<VolunteerColour, 'rouge'> =
      dayLength >= longDay.very - 1e-9 ? 'orange-fonce'
      : dayLength >= longDay.long - 1e-9 ? 'orange-clair'
      : 'aucune';
    const colour: VolunteerColour = own.length > 0 ? 'rouge' : band;

    return {
      key: volunteer.key,
      name: index.volunteerName(volunteer.key),
      reserve: index.isReserve(volunteer.key),
      requestedHours: volunteer.requestedHours,
      requestedTotalHours: index.requestedTotalOf(volunteer),
      assignedHours,
      hoursByDay,
      blocks: buildBlocks(shifts),
      colour,
      volumeBand: band,
      hoursByRank,
      hoursOutside,
      horsChoixPoles: [...horsChoixPoles],
      toleratedOverflowHours,
      againstPreferenceHours,
      buddies,
      issues: own,
    };
  });

  // --- Shifts ----------------------------------------------------------------------------
  const shifts: ShiftReport[] = plan.shifts.map((shift) => {
    const assignees = index.assigneesOf(shift.key);
    // What is left for volunteers, orgas taken out. `headcount` stays the créneau's own figure,
    // because the grid draws that many rows: the orgas fill some of them.
    const missing = Math.max(0, index.headcountOf(shift) - assignees.length);
    return {
      key: shift.key,
      poleKey: shift.poleKey,
      polePath: index.polePath(shift.poleKey),
      start: shift.start,
      end: shift.end,
      label: index.shiftLabel(shift),
      headcount: shift.headcount,
      assigned: assignees.length,
      missing,
      orgas: index.orgasOn(shift.key).map((o) => ({
        key: o.key,
        name: `${o.firstName} ${o.lastName}`.trim(),
        short: index.organiserShortName(o.key),
      })),
      stars: assignees.map((v) => ({
        volunteerKey: v.key,
        name: index.volunteerName(v.key),
        short: index.volunteerShortName(v.key),
        level: index.levelIn(v, shift.poleKey),
        issues: issuesByBox.get(`${v.key}|${shift.key}`) ?? [],
      })),
      gap: missing > 0 ? diagnoseGap(index, shift, missing) : null,
      issues: issuesByShift.get(shift.key) ?? [],
    };
  });

  // --- Artists ---------------------------------------------------------------------------
  const artists: ArtistReport[] = plan.artists.map((artist) => {
    const namedBy = plan.volunteers.filter((v) => v.artistKeys.includes(artist.key));
    const assignedDuring = namedBy.filter((v) =>
      index.shiftsOf(v.key).some((s) => overlaps(s, artist)),
    );
    const demand = plan.shifts.reduce((total, s) => {
      const cover = Math.min(s.end, artist.end) - Math.max(s.start, artist.start);
      return cover > 0 ? total + cover * index.headcountOf(s) : total;
    }, 0);
    return {
      key: artist.key,
      name: artist.name,
      window: `${index.label(artist.start)} -> ${index.label(artist.end)}`,
      namedBy: namedBy.length,
      assignedDuring: assignedDuring.length,
      demandHours: demand,
    };
  });

  // --- Summary ---------------------------------------------------------------------------
  const gapsBySlotId = new Map<SlotId, number>(plan.slots.map((s) => [s.id, 0]));
  const gapsByPoleKey = new Map<string, number>();
  for (const report of shifts) {
    if (report.missing === 0) continue;
    const hours = (report.end - report.start) * report.missing;
    gapsByPoleKey.set(report.poleKey, (gapsByPoleKey.get(report.poleKey) ?? 0) + hours);
    for (const slot of plan.slots) {
      const cover = Math.min(report.end, slot.end) - Math.max(report.start, slot.start);
      if (cover > 0) {
        gapsBySlotId.set(slot.id, (gapsBySlotId.get(slot.id) ?? 0) + cover * report.missing);
      }
    }
  }

  const codeCounts = new Map<string, { tier: Tier; count: number }>();
  for (const issue of issues) {
    const entry = codeCounts.get(issue.code) ?? { tier: issue.tier, count: 0 };
    entry.count++;
    codeCounts.set(issue.code, entry);
  }

  const demand = demandHours(plan.shifts);
  const offered = volunteers.reduce((total, v) => total + v.requestedTotalHours, 0);
  const assignedHours = volunteers.reduce((total, v) => total + v.assignedHours, 0);
  const buddyOutcomes = volunteers.flatMap((v) => v.buddies);
  const ceiling = Math.floor(demand / rules.minHoursPerPerson);

  const summary: PlanSummary = {
    demandHours: demand,
    assignedHours,
    offeredHours: offered,
    gapHours: demand - assignedHours,

    shiftsTotal: shifts.length,
    shiftsFilled: shifts.filter((s) => s.missing === 0).length,
    shiftsPartial: shifts.filter((s) => s.missing > 0 && s.assigned > 0).length,
    shiftsEmpty: shifts.filter((s) => s.assigned === 0).length,

    volunteersTotal: volunteers.length,
    volunteersUnassigned: volunteers.filter((v) => v.assignedHours === 0 && !v.reserve).length,
    volunteersOnReserve: volunteers.filter((v) => v.reserve).length,
    volunteersBelowFloor: volunteers.filter(
      (v) => !v.reserve && v.assignedHours < rules.minHoursPerPerson,
    ).length,
    volunteersAtRequested: volunteers.filter((v) => v.assignedHours >= v.requestedTotalHours - 1e-9).length,

    hoursByRank: volunteers.reduce<number[]>((sum, v) => {
      v.hoursByRank.forEach((h, i) => { sum[i] = (sum[i] ?? 0) + h; });
      return sum;
    }, []),
    hoursHorsChoix: volunteers.reduce((t, v) => t + v.hoursOutside, 0),
    horsChoix: volunteers
      .filter((v) => v.horsChoixPoles.length > 0)
      .map((v) => ({ volunteerKey: v.key, name: v.name, poles: v.horsChoixPoles })),

    buddyRequests: buddyOutcomes.length,
    buddyHonoured: buddyOutcomes.filter((b) => b.honoured).length,

    gapsBySlot: plan.slots.map((s) => ({ id: s.id, label: s.label, hours: gapsBySlotId.get(s.id) ?? 0 })),
    gapsByPole: [...gapsByPoleKey.entries()]
      .map(([poleKey, gapHours]) => ({ poleKey, path: index.polePath(poleKey), gapHours }))
      .sort((a, b) => b.gapHours - a.gapHours),

    tier1Count: issues.filter((i) => i.tier === 1).length,
    tier2Count: issues.filter((i) => i.tier === 2).length,
    byCode: [...codeCounts.entries()]
      .map(([code, { tier, count }]) => ({ tier, code, count }))
      .sort((a, b) => a.tier - b.tier || b.count - a.count),

    volunteerCeiling: ceiling,
    overRecruited: plan.volunteers.length > ceiling,
  };

  return { issues, volunteers, shifts, artists, summary };
}
