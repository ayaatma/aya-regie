/**
 * Domain types for the Loto Tekno planning tool.
 *
 * Time is expressed as decimal hours from the start of the event, so 0 is 12:00 on the event
 * day and 18 is 06:00 the next morning. Everything downstream converts to real timestamps at
 * the last moment. This keeps the scheduling rules free of timezone and midnight-rollover
 * arithmetic, which is where this kind of code usually goes wrong.
 */

export type SkillLevel = 'debutant' | 'intermediaire' | 'expert';

/**
 * One pole a volunteer asked for, with the level they declared there.
 *
 * A LIST SINCE 2026-09-14, in the order given. Until then a volunteer had exactly two choices,
 * `choice1*` and `choice2*`, which was the Loto Tekno form's shape: another event asks for
 * one, or five, or ticks a box per pole with no order at all. Whether the order means anything
 * is the event's to say (`Plan.poleChoicesRanked`); the list keeps the order either way, so
 * switching the setting back loses nothing.
 *
 * `raw` is the answer as typed. It matters because a form offers an "Autre" box beside the list
 * of poles, and what was typed there arrives in the same column: an answer naming a pôle the form
 * never listed arrives as prose. The importer matches what it can and flags the rest for review,
 * and the prose stays so the régisseur can read what the person actually asked for. `poleKey`
 * is empty when nothing could be resolved.
 */
export interface PoleChoice {
  poleKey: string;
  raw: string;
  level: SkillLevel;
  /**
   * « Tous les pôles acceptés », since 2026-10-22: this choice honours every pole, at its rank.
   * `poleKey` is then ''. Bar first and « peu importe » second is the Bar wanted, and anything
   * else at the price of a second choice rather than of a placement outside every choice.
   */
  anyPole?: boolean;
}

/** How a choice is named on a screen: its pole, « Tous les pôles acceptés », or the sentence. */
export const ANY_POLE_LABEL = 'Tous les pôles acceptés';
export function choicePoleLabel(choice: PoleChoice, polePath: (key: string) => string): string {
  if (choice.anyPole) return ANY_POLE_LABEL;
  return choice.poleKey !== '' ? polePath(choice.poleKey) : `« ${choice.raw.trim()} »`;
}

/**
 * Which of the two people files somebody is in.
 *
 * Born in `phase.ts` and moved here on 2026-09-12, because the catering settings at the bottom
 * of this file name it too and this file imports nothing from anywhere. `phase.ts` re-exports
 * it, so every import written against it still reads.
 */
export type PersonKind = 'orga' | 'benevole';

/*
 * What the volunteer answered to "Qu'est ce que tu préfères ?" is a SLOT, since 2026-09-13.
 *
 * It used to be `HalfPreference`, one of 'afternoon' | 'evening' | 'any', and the two hours that
 * gave those words a meaning (where the loto hands over to the concerts, how far a loto answer
 * may overflow) were rules of the event. That baked the Loto Tekno into the type: another event
 * has no loto, and a régisseur could not rename the halves, add a third or move the overflow to
 * the other side without a developer. The answer now names one of the event's own
 * `PreferenceSlot`s by id, the way a refusal names an `EventSlot`, and the tranche carries its
 * own tolerated overflow. See `Volunteer.preferredSlotId`.
 *
 * A PREFERENCE, NEVER A RULE. Before 2026-09-08 this was a hard availability answer, which
 * refused placements the volunteer would have accepted without a murmur. Nothing in
 * `validate.ts` may ever consult it. It is scored by the solver and reported to the régisseur,
 * and that is the whole of its power. The hard answer about time is `refusedSlotIds`, which is a
 * different question with a different meaning.
 */

/**
 * A time slot the form asks about, by id.
 *
 * A plain string, not a union, since 2026-09-07. The three slots used to be baked into the type,
 * which meant the form's wording was baked into the compiler: changing a question meant changing
 * the code. They are configuration now, and this id is whatever the régisseur's form calls that
 * slot. It is stored on every volunteer in `refusedSlotIds`, so renaming one is a change to
 * data people have already answered, not just to a label.
 */
export type SlotId = string;

/** A half-open interval of decimal hours from the event start. */
export interface Window {
  start: number;
  end: number;
}

/**
 * One of the slots the form offers as "which one can you not do".
 *
 * `start` and `end` are decimal hours from the event start, like everything else. `label` is what
 * the régisseur sees and, crucially, what the import matches the CSV answers against: change the
 * question in the form and change this to match, and re-importing keeps working.
 *
 * TOGETHER THEY TILE THE EVENT, and two things depend on that: the free-text availability parser
 * turns "pas avant 18h" into the tranches it overlaps, and the summary splits every missing hour
 * across the tranche it falls in. A tranche somebody would rather work is a different thing with
 * a different shape, `PreferenceSlot` below, and the two are never in one list.
 */
export interface EventSlot {
  id: SlotId;
  label: string;
  start: number;
  end: number;
}

/**
 * The Loto Tekno slots: three six-hour blocks over an event running midday to six.
 *
 * The labels are the real form's four answers, word for word, minus "Aucune, tout me va !"
 * which is the absence of a refusal rather than a slot. That is not a coincidence and not a
 * style: the label is what the import matches a CSV answer against, so it has to be the
 * question's own wording or a re-import silently stops recognising the answers.
 *
 * They read a little tersely in Réglages, and that is the right trade. The ids are what a
 * volunteer's stored answer points at and never change with the wording.
 */
export const DEFAULT_SLOTS: readonly EventSlot[] = [
  { id: '12h-18h', label: 'de 12h à 18h', start: 0, end: 6 },
  { id: '18h-00h', label: 'de 18h à 00h', start: 6, end: 12 },
  { id: '00h-06h', label: 'de 00h à 06h', start: 12, end: 18 },
];

/**
 * One of the answers to "Qu'est ce que tu préfères ?": a stretch of the event somebody would
 * rather work, since 2026-09-13.
 *
 * Until then the answer was one of two words, 'afternoon' and 'evening', and the hours behind
 * them (`eveningStartsAt`, `afternoonOverflowUntil`) were rules of the event, with "loto" and
 * "concerts" written into the code. Another event has no loto. These are rows the régisseur
 * edits now, in the same card as the refusable tranches and matched by the import the same
 * way: "Travailler pendant le loto" contains "loto", and that is the whole of the match.
 *
 * Not an `EventSlot`, on purpose: they may overlap each other and need not cover the event, so
 * nothing that tiles the event with tranches may ever read them.
 */
export interface PreferenceSlot {
  id: SlotId;
  label: string;
  start: number;
  end: number;
  /**
   * "Débordement accepté": how far past either edge a placement may run before it counts as
   * going AGAINST the preference rather than merely stretching it. In hours, applied before the
   * start and after the end alike. Zero means the edges are the line. `preferenceMisfit` in
   * `availability.ts` is the one reader.
   */
  overflowHours: number;
}

/**
 * The Loto Tekno answers: the loto, which runs to 20h and may overflow two hours into the
 * concerts, and the concerts, which start at 20h and tolerate nothing before. The asymmetry is
 * the régisseur's own ("elle commencera à partir de 20h"), and it is two numbers now, not a rule.
 */
export const DEFAULT_PREFERENCE_SLOTS: readonly PreferenceSlot[] = [
  { id: 'loto', label: 'Loto', start: 0, end: 8, overflowHours: 2 },
  { id: 'concerts', label: 'Concerts', start: 8, end: 18, overflowHours: 0 },
];

/**
 * The rules every placement is checked against, and none of them names a moment of the event.
 *
 * Two used to: `eveningStartsAt` and `afternoonOverflowUntil`, the line where the loto handed
 * over to the concerts and how far a "loto" answer might run past it. Both left on 2026-09-13
 * for `PreferenceSlot.overflowHours`: the preference is scored against the tranche the volunteer
 * named, and the tolerated overflow is a property of that tranche rather than of the event. Nothing here
 * makes a placement illegal on account of a preference; a shift about to be left short outranks
 * every preference, which is the point.
 */
export interface SchedulingRules {
  maxConsecutiveHours: number;
  maxBlocks: number;
  minBreakHours: number;
  minHoursPerPerson: number;
}

/** The Loto Tekno figures. */
export const DEFAULT_RULES: SchedulingRules = {
  maxConsecutiveHours: 4,
  maxBlocks: 2,
  minBreakHours: 2,
  minHoursPerPerson: 4,
};

/**
 * LES REPAS ET LES TICKETS BOISSON, et why every number of them is configuration.
 *
 * The caterer asks two questions and only two: how many people eat at each service, and what
 * they cannot eat. Everything in this block exists to answer those, and nothing here is a rule
 * anybody is held to: a meal is never refused, never taken away and never assigned in silence.
 *
 * WHY TIERS AND NOT A FORMULA. The régisseur's own words on 2026-09-12: "travailler 4h donne
 * droit à 1 repas, travailler 6h ou 8h donne droit à 2 repas". That is a step function with two
 * steps, and the next event will have different steps, or three of them, or one. A formula
 * (hours / 4, rounded down, capped) would fit this year and be wrong the next, and the régisseur
 * would have no way to say so without a developer. A list of "à partir de X h, N repas" says
 * exactly what was decided, in the words it was decided in.
 *
 * The drink tickets earn their own field because they are earned continuously rather than in
 * steps: "chaque tranche de 2 h travaillé donne droit à 1 ticket boisson".
 */
export interface MealWindow {
  /** Stable id, part of a service's key, so renaming the label never moves a ticked box. */
  key: string;
  /** What the régisseur and the caterer call it. "Midi", "Soir". */
  label: string;
  /**
   * The clock hours the service is served between, local time, on the day it belongs to.
   *
   * A CLOCK RATHER THAN AN OFFSET, alone in this codebase, and on purpose: a meal is at 12h30
   * every day of the montage, it is not at "hour 37 of the montage". An end at or before the
   * start means the service runs past midnight, which is how a 23h to 01h night service is
   * written down.
   */
  fromHour: number;
  toHour: number;
}

/** "À partir de `fromHours` travaillées, `meals` repas." Read as a step, highest match wins. */
export interface MealTier {
  fromHours: number;
  meals: number;
}

export interface CateringRules {
  /**
   * Whether this event feeds anybody at all.
   *
   * Off is the state every plan written before 2026-09-12 opens in, and the state of a new plan
   * until the régisseur says otherwise. Nothing is drawn, nothing is counted, no screen asks.
   */
  enabled: boolean;
  /** The services of a day, in clock order. Two by default: midi and soir. */
  services: readonly MealWindow[];
  /**
   * What the hours worked during the exploit earn, as steps.
   *
   * THE EXPLOIT ONLY. The montage and the démontage do not work this way and never did: there,
   * somebody on site at the hour of a meal eats, which is a presence and not an entitlement.
   * See `defaultMealChoices` in `catering.ts` for the two rules side by side.
   */
  exploitTiers: readonly MealTier[];
  /** One drink ticket per this many hours worked. Zero means the event hands out none. */
  drinkPerHours: number;
  /** True when the montage and démontage hours count towards the drink tickets as well. */
  drinkCountsPhases: boolean;
  /**
   * What an orga is due on the exploit whatever they worked there, and it is a FLOOR.
   *
   * "Les orgas ont droit aux 2 repas même s'ils ne travaillent pas pendant l'exploit, et ont 2
   * tickets boissons." An orga who does work a créneau keeps whatever the tiers give them when
   * that is more: the floor lifts, it never caps.
   */
  organiserMeals: number;
  organiserDrinks: number;
  /**
   * Since 2026-10-22, off by default: an orga (a responsable included) is handed exactly
   * `organiserDrinks` tickets, whatever the hours, rather than that figure as a floor under
   * the hourly rule. The régisseur then sets a different figure person by person in Personnes.
   */
  organiserDrinksFixed: boolean;
  /**
   * Since 2026-10-23, off by default: the Staff (Responsables included) are given exactly
   * `organiserMeals` services of the exploit, whatever the hours, rather than that as a floor.
   * Absent reads as off.
   */
  organiserMealsFixed?: boolean;
  /**
   * What a member of an act is handed, whatever the hours: an act works no créneau and earns
   * nothing by the hour. A member's own `drinkTickets` overrides this for that one person.
   */
  artistDrinks: number;
  /**
   * What a member of an act who is ALSO a bénévole or an orga gets: both figures added, or the
   * higher of the two. "Les tickets boissons peuvent ne pas être cumulatifs", the régisseur's
   * words, and which of the two the association means is theirs to tick. Off by default: one
   * person, one status, the better one.
   */
  artistDrinksCumulative: boolean;
}

/**
 * Who a meal choice can name: the two people files, and since 2026-09-13 a member of an act.
 *
 * Wider than `PersonKind` rather than a widening of it, because `PersonKind` is what the phases
 * place and an artist is never placed on a phase: every grid, pool and drag payload that reads
 * `PersonKind` would otherwise have to learn a third kind it can do nothing with.
 */
export type MealPersonKind = PersonKind | 'artiste';

/**
 * One box the régisseur ticked or unticked, against what the tool worked out on its own.
 *
 * ONLY THE DISAGREEMENTS ARE STORED, never the whole grid of checkboxes. A stored default is a
 * frozen default: move somebody's créneau, open one more day of the montage to the bénévoles, or
 * change the tiers in Réglages, and every box saved from yesterday's picture would stay as it
 * was, silently, with nothing on screen saying it had stopped following the plan.
 *
 * So a row here means "the régisseur decided this one themselves", which is exactly the thing
 * that must survive a re-solve, and everything else is recomputed from the plan every time.
 */
export interface MealChoice {
  personKind: MealPersonKind;
  personKey: string;
  /** The service, by its key. See `serviceKey` in `catering.ts`. */
  serviceKey: string;
  takes: boolean;
}

export interface CateringSettings {
  rules: CateringRules;
  choices: readonly MealChoice[];
}

/**
 * The Loto Tekno figures, as the régisseur stated them on 2026-09-12.
 *
 * `enabled` is false: the numbers are right, and whether this event feeds anybody is still the
 * régisseur's to say. Turning it on in Réglages is one click and one save.
 */
export const DEFAULT_CATERING: CateringSettings = {
  rules: {
    enabled: false,
    services: [
      { key: 'midi', label: 'Midi', fromHour: 12, toHour: 14 },
      { key: 'soir', label: 'Soir', fromHour: 19, toHour: 21 },
    ],
    exploitTiers: [
      { fromHours: 4, meals: 1 },
      { fromHours: 6, meals: 2 },
    ],
    drinkPerHours: 2,
    drinkCountsPhases: false,
    organiserMeals: 2,
    organiserDrinks: 2,
    organiserDrinksFixed: false,
    artistDrinks: 2,
    artistDrinksCumulative: false,
  },
  choices: [],
};

/**
 * Where a piece of equipment stands, since 2026-09-15:
 *   attendu     promised (somebody said they would bring it), not on site yet
 *   stock       on site, free
 *   sorti       taken out, `holder` says by whom or where
 *   rendu       given back to whoever lent it: the loan is closed
 */
export type EquipmentStatus = 'attendu' | 'stock' | 'sorti' | 'rendu';

export const EQUIPMENT_STATUSES: readonly EquipmentStatus[] = ['attendu', 'stock', 'sorti', 'rendu'];

export const EQUIPMENT_STATUS_LABEL: Record<EquipmentStatus, string> = {
  attendu: 'Attendu',
  stock: 'En stock',
  sorti: 'Sorti',
  rendu: 'Rendu',
};

/**
 * One line of « Magasin », since 2026-09-15: the equipment of the event, the association's own or
 * lent by somebody. A lender who is a bénévole or an orga of the plan is named by key, so their
 * fiche can say what they brought; anybody else is a free label. Nothing is derived: the régisseur
 * types what is there and what went where.
 */
export interface EquipmentItem {
  key: string;
  name: string;
  quantity: number;
  /** Empty for the association's own; a name otherwise (« Mairie », a bénévole's name). */
  lender: string;
  lenderKind: 'benevole' | 'orga' | null;
  lenderKey: string | null;
  status: EquipmentStatus;
  /** Who or where it is while `sorti` (« Bar », « Camille »). */
  holder: string;
  note: string;
}

/**
 * Something around the event that has no grid, since 2026-09-15: a pré-montage the week before, a
 * weekend preparing the site, a weekend of déco. What the régisseur needs is the list of people
 * keen on it, not a schedule. `when` is free text (« 10 au 12 septembre »).
 */
export interface SideActivity {
  key: string;
  label: string;
  when: string;
}

/**
 * A team kept together across the créneaux, since 2026-09-15: a festival places groups of four to
 * six bénévoles as one crew on a pole's roulement. `poleKey` is where the team usually works, for
 * the régisseur's reading only; nothing forces a member there.
 */
/** The moment a timeline marker sits on, each with its own clock. */
export type MarkerMoment = 'exploit' | 'montage' | 'demontage';

/**
 * A repère on a timeline, since 2026-10-23: something worth seeing above the grid that nobody is
 * placed on, « Pause entre le loto et les concerts », « Ouverture des portes ». Informative only:
 * no rule, no solver term, no créneau reads it.
 *
 * `start` and `end` are hours from the start of its own moment (the exploit's, or the phase's),
 * like everything else drawn there. `end` null is an instant, drawn as a mark rather than a band.
 */
export interface TimelineMarker {
  key: string;
  label: string;
  moment: MarkerMoment;
  start: number;
  end: number | null;
}

export interface Team {
  key: string;
  name: string;
  poleKey: string | null;
}

/**
 * A competence the event cares about: « Permis B », « CACES », « Conduite d'engins », « Secourisme ».
 * Since 2026-09-15. The event's own list (`Plan.skills`), so a festival and a loto each name what
 * matters to them; a stable key so renaming a tag never untags anybody.
 */
export interface SkillTag {
  key: string;
  label: string;
}

export interface Pole {
  key: string;
  name: string;
  /**
   * The `SkillTag` keys a person needs to work here, since 2026-09-15. A sub-pole also needs its
   * parents' (`PlanIndex.requiredSkillsOf`). Scored or blocking as the criterion `missingSkill`
   * says. Absent means none.
   */
  requiredSkills?: string[];
  parentKey: string | null;
  /** Full display name, "Bar / Service" for a sub-pole. */
  path: string;
  allowAllDebutants: boolean;
  minExperienced: number;
  /**
   * The colour this pole is drawn in on the grid, as `#rrggbb`.
   *
   * Presentation only. Nothing in the engine reads it, and no rule depends on it: it is here
   * rather than in the UI because the régisseur chooses it and it has to travel with the plan.
   * Absent means the screen picks one from its default palette, so an older plan still opens.
   */
  colour?: string;
  /**
   * When true, the solver leaves this pole and its sub-poles exactly as they are.
   *
   * A DIFFERENT THING FROM `Assignment.locked`, and deliberately so. A locked box is pinned
   * against everybody, the solver and the régisseur alike. A locked pole is aimed at the solver
   * only: it says "I have balanced the bar by hand, a re-solve must not undo it", while leaving
   * the régisseur free to keep adjusting it themselves.
   *
   * It never writes anything into the boxes. Locking a pole and unlocking it again leaves every
   * `Assignment.locked` flag exactly as it was, because the two decisions are not the same
   * decision and merging them would lose one of them.
   */
  locked?: boolean;
  /**
   * How many volunteers a shift of this pole needs, unless the shift says otherwise.
   *
   * This is a starting value for the admin screen, not a rule: it is copied into a shift when
   * the shift is created, and never read again afterwards. Raising it later must not silently
   * rewrite the shifts the régisseur has already tuned by hand.
   */
  defaultHeadcount: number;
  /**
   * How many Staff places a new shift of this pole has, unless the shift says otherwise. Since
   * 2026-10-24; absent means 0.
   *
   * Copied into a shift when it is created and never read again, like `defaultHeadcount`. A pole
   * held by the Staff (Régie générale, Technique) is 0 bénévoles and N Staff; a pole with a
   * bénévole runner beside its techs is both. See `Shift.staffHeadcount`.
   */
  defaultStaffHeadcount?: number;
  /**
   * How long a new shift of this pole lasts, in hours, WHEN THE RÉGISSEUR SET IT BY HAND.
   *
   * Read when a créneau is created, and never again: changing it must not touch a single existing
   * shift. It is per pole because shift length is a property of the job. Propreté goes round
   * every two hours; Accueil artistes is a four-hour post, and that difference is the main lever
   * on whether a volunteer works four hours in one place or two here and two there.
   *
   * ABSENT MEANS « FOLLOWS THE EVENT » since 2026-09-17: `Plan.defaultShiftHours` decides, and
   * changing the event's value moves this pole with it. Present is a choice made for this pole,
   * drawn in green in Réglages, and the event's value no longer reaches it.
   */
  defaultShiftHours?: number;
  /**
   * True when whoever runs this pole is expected to stay in support, and take no créneau in it.
   *
   * WHY IT IS A PROPERTY OF THE POLE. The régisseur put it plainly on 2026-09-12: "selon les
   * pôles, soit il y a besoin qu'il reste en support, donc sans créneau, et sur d'autre pôle il
   * peut prendre un créneau en même temps car peut faire les deux en même temps". Whether the two
   * jobs fit into one pair of hands is a fact about the job, not about the person doing it, so it
   * belongs beside `minExperienced` and not on the `LeaderRole`.
   *
   * IT IS NEVER A REFUSAL. Nothing in `validate.ts` reads it and the solver never places an orga
   * at all; `PlanIndex.supportOnlyBreaches` reports it, on the box and in the panel, in orange.
   * A responsable who ends up holding a créneau on a support pole is a thing the régisseur may
   * well have decided on the night, and the tool's job is to say so out loud, not to undo it.
   *
   * Absent, and false, means "may hold a créneau", which is what the tool did before this
   * existed: a default that flags nothing on a plan written before the field.
   */
  leaderSupportOnly?: boolean;
}

export interface Shift {
  key: string;
  poleKey: string;
  start: number;
  end: number;
  /**
   * The number of volunteers this particular shift needs, which is the only figure anything
   * downstream reads. It starts from the pole's default and is then adjusted per shift, so a
   * rush hour can carry more people than a quiet one in the same pole.
   */
  headcount: number;
  /**
   * The Staff places of this créneau, since 2026-10-24. Absent means 0.
   *
   * WHY A SECOND FIGURE. Some créneaux are not the bénévoles' at all: the régie générale from the
   * doors to the end, the techs doing ten hours in a row. Written as bénévole places they were a
   * long gap nobody could fill, counted in every « à pourvoir » of the Suivi. A Staff place is a
   * post to find somebody for, drawn on the grid, never offered to a bénévole by the solver, and
   * counted apart, in posts rather than hours.
   *
   * WHO FILLS IT. Any `OrganiserShift` on the créneau, Staff or Responsable, fills the Staff places
   * first; one beyond them takes a bénévole place, as before this field existed (a Staff on the
   * bar at 2h is one bénévole fewer). See `seatsOf`.
   *
   * `headcount + staffHeadcount` is at least 1: a créneau needing nobody is not one.
   */
  staffHeadcount?: number;
}

/** A créneau's Staff places, absent read as 0. */
export const staffSeatsOf = (shift: Pick<Shift, 'staffHeadcount'>): number => shift.staffHeadcount ?? 0;

/**
 * How a créneau's places are held, given how many orgas stand in it.
 *
 * THE ONE RULE, kept here so the engine and the grid cannot disagree: the orgas fill the Staff
 * places first, and each one beyond them takes a bénévole place.
 *
 *   staffMissing   Staff places nobody holds yet.
 *   overflow       orgas standing in bénévole places.
 *   benevoleSeats  bénévole places left for bénévoles, never negative.
 *   orgaRows       rows the orgas' part of the créneau draws: held places plus Staff holes.
 */
export function seatsOf(
  shift: Pick<Shift, 'headcount' | 'staffHeadcount'>,
  orgas: number,
): { staffMissing: number; overflow: number; benevoleSeats: number; orgaRows: number } {
  const staff = staffSeatsOf(shift);
  const overflow = Math.max(0, orgas - staff);
  return {
    staffMissing: Math.max(0, staff - orgas),
    overflow,
    benevoleSeats: Math.max(0, shift.headcount - overflow),
    orgaRows: Math.max(staff, orgas),
  };
}

/**
 * An orga: somebody who runs the event rather than signs up for a shift of it.
 *
 * THE SECOND KIND OF PERSON, and the one the volunteers' rules do not apply to. An orga has no
 * hour ceiling, no pole preference, no time preference and no score: nothing in `validate.ts`
 * or in the solver weighs them. What they declare instead is when they arrive for the montage,
 * until when they stay for the démontage, and the pole they work in during those two phases.
 *
 * A RESPONSABLE IS AN ORGA HOLDING A `LeaderRole`, and that is the whole of the difference.
 * Every responsable is an orga; most orgas are not responsables. The régisseur picks one from
 * this list rather than typing a name twice, which is what makes "qui est responsable du bar"
 * and "comment je le joins" the same row.
 *
 * Called `Leader` until 2026-09-10, when the form it is imported from turned out to be the orga
 * form rather than a responsables form. The rename is deliberate: the type means "somebody who
 * filled in the orga form", and `LeaderRole` alone means being in charge of a pole.
 *
 * The fields past the name come from that form. They are deliberately the ones a régisseur
 * needs on the night or at the table: how to reach somebody and what they can eat.
 */
export interface Organiser {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /**
   * The credential. Same idea as `Volunteer.accessCode` and deliberately longer, because this
   * one opens the whole planning rather than one person's shifts. See `feature_leader_access.md`.
   *
   * ISSUED TO EVERY ORGA SINCE 2026-09-10, not only to those in charge of a pole: they all work
   * on the event and they all need to read the grid. The cost, accepted then as it was in
   * September for the responsables, is that one forwarded code is the whole address book.
   */
  accessCode: string;
  /** Free text, as answered. "Végétarien", "Sans porc", "Sans restriction". */
  diet: string;
  /** Free text, as answered. Kept apart from the diet because a caterer reads them differently. */
  allergies: string;
  note: string;
  /**
   * When they arrive for the montage, in decimal hours from the MONTAGE's own start, or null
   * when they are not there at all.
   *
   * An arrival rather than a window, because that is the question the form asks: "à partir de
   * quand es-tu là ?". Somebody who has to leave in the middle of the montage is written down
   * by the régisseur as an explicit placement, which is the exception rather than the shape of
   * the answer.
   */
  montageFrom: number | null;
  /** When they leave the démontage, in hours from the DÉMONTAGE's start. Null: not there. */
  demontageUntil: number | null;
  /**
   * The phase poles they work in, by key, one list per phase.
   *
   * The first of them is where the tool draws them when nothing else has been decided for a
   * given half-day; the others are recorded so the régisseur knows where else this person is
   * useful. Empty means Général, which is where an orga with no declared pole belongs.
   */
  montagePoleKeys: string[];
  demontagePoleKeys: string[];
  /** The `SkillTag` keys this orga holds, set by hand. Since 2026-09-15; absent means none. */
  skills?: string[];
  /** Who to call if something happens to them, as typed. See `Volunteer.emergencyContact`. */
  emergencyContact?: string;
  /** What they cannot do or need, as typed. See `Volunteer.healthNote`. */
  healthNote?: string;
  /** The side activities this orga is keen on, ticked by hand. Since 2026-09-15. */
  sideActivityKeys?: string[];
  /**
   * Where this orga stands, as for a bénévole (`Volunteer.status`). Since 2026-10-22; absent
   * means « inscription ». Informs and marks, never blocks: an orga is subject to no rule.
   */
  applicationStatus?: ApplicationStatus;
  /**
   * Staff or Responsable, since 2026-10-23: what the screens called an « orga » is one of the
   * two, and the word « orga » left the tool. Absent means Responsable, which is what everybody
   * imported before became. Both are on site without a créneau being owed, both are handed the
   * Staff's fixed tickets; a Responsable may hold poles (`LeaderRole`) and has bracelets of its
   * own. See `organiserRoleOf`.
   */
  role?: OrganiserRole;
  /**
   * The bénévole fiche this person had, kept whole when they became Staff or Responsable, and
   * put back if they become a bénévole again. Since 2026-10-24: the way back used to start a
   * blank fiche, so the volume, the pole choices, the refused slots and every hand correction
   * were typed a second time. Read by nothing else: no rule of a bénévole applies to an orga.
   * Absent: never a bénévole in this plan. See `convertPerson`.
   */
  asVolunteer?: Volunteer;
}

/** Staff or Responsable. See `Organiser.role`. */
export type OrganiserRole = 'responsable' | 'staff';

export const ORGANISER_ROLE_LABEL: Record<OrganiserRole, string> = {
  responsable: 'Responsable',
  staff: 'Staff',
};

/** An organiser's role, absent read as Responsable. */
export const organiserRoleOf = (o: Pick<Organiser, 'role'>): OrganiserRole => o.role ?? 'responsable';

/**
 * An orga standing in a créneau of the exploit.
 *
 * NOT AN `Assignment`, and the difference is the whole design. An assignment is a volunteer
 * placed under every rule in this project: their hours are counted, their refusals honoured,
 * their preferences scored, and the solver moves them. An orga is subject to none of that, by
 * the régisseur's decision of 2026-09-10: no hour ceiling, no volume, no preference, and the
 * solver never places one. Putting them in the same list would have meant teaching every rule
 * in `validate.ts` to ask "is this one exempt", on twelve occasions, forever.
 *
 * WHAT THE ENGINE DOES KNOW ABOUT THEM IS ONE THING: they take a place. `PlanIndex.headcountOf`
 * subtracts them from what a créneau still needs, so the solver stops filling a seat that is
 * already held and the gap counts tell the truth. That single hook is deliberate: everything
 * else about an orga is recorded, not scheduled.
 *
 * Placed by hand, always. Nothing in this codebase creates one of these on its own.
 */
export interface OrganiserShift {
  key: string;
  organiserKey: string;
  shiftKey: string;
}

/**
 * Whether somebody is on site for one of the two phases, and when.
 *
 * THE SAME THREE-PART SHAPE AS THE FREE-TEXT ANSWERS OF THE FORM, for the same reason: the
 * question is asked in prose ("je peux venir vendredi après-midi et samedi"), the importer's
 * reading of it is a guess, and a guess has to stay checkable against what the person actually
 * wrote. So the sentence is kept verbatim beside the reading, and the reading is correctable.
 *
 * `windows` empty while `present` is true is not a missing answer: it means "there, hours not
 * stated", and the tool then takes the whole window the régisseur opened to the bénévoles for
 * that phase. That is exactly what the régisseur asked for, and it is why the empty list is a
 * legitimate value rather than a hole to fill in.
 */
export interface PhasePresence {
  present: boolean;
  /** The sentence, exactly as typed. Empty when the question was left blank. */
  note: string;
  /** The importer's reading, in decimal hours from that phase's start. Correctable by hand. */
  windows: Window[];
}

export const absentFromPhase = (): PhasePresence => ({ present: false, note: '', windows: [] });

/**
 * One pole somebody runs, and when.
 *
 * The hours are the useful part on the night: knowing the bar has nobody in charge between 02h
 * and 04h is exactly the kind of hole the grid is for. So the window is optional, drawn on the
 * grid above its pole, and read by no rule whatsoever.
 *
 * NOTHING HERE IS CHECKED AGAINST ANYTHING. Two roles held by one person may overlap in time,
 * on purpose: somebody can watch the bar and the plonge over the same two hours, and saying so
 * is the point rather than a mistake to catch. No volume, no minimum, no rest between two
 * windows. A organiser is not scheduled, they are recorded.
 *
 * A person may hold several roles on the SAME pole, which is how a organiser present from 14h to
 * 18h and again from 22h to 02h is written down. So the key is the row's, not the pair's.
 */
export interface LeaderRole {
  key: string;
  organiserKey: string;
  poleKey: string;
  /** Decimal hours from the event start, or null when their hours are not settled yet. */
  start: number | null;
  end: number | null;
}

/*
 * The line-up, since 2026-09-13 a file on every act rather than a name and two hours.
 *
 * WHAT THE FIRST SHAPE WAS. `Artist` was `{key, name, start, end}`: enough for the one rule that
 * reads it (a bénévole who asked not to miss a set is flagged when placed across it) and for the
 * band under the exploit's ruler. The régisseur then asked for everything else they know about
 * an act and have nowhere to write down: who is in it, when they arrive for the balances, how
 * long the changement de plateau takes, what they eat, how they are paid and how they travel.
 *
 * WHAT STAYS TRUE. `key`, `name`, `start` and `end` mean exactly what they meant. Every hour in
 * this block counts from the event's start, including the balances, WHICH MAY BE NEGATIVE: a
 * soundcheck the afternoon before the doors open falls in the montage, and it is drawn there,
 * converted into the montage's own axis at the last moment (see `artistMoments` in
 * `artists.ts`). Nothing in the phases stores it: an act's balances are the act's, never a
 * `PhaseEvent`.
 *
 * NOTHING HERE IS A RULE. The solver and the validator read `start` and `end` and nothing else.
 * The rest is recorded for the régisseur, the caterer and the person booking the trains.
 */

/** What somebody does in the act. A technicien eats and travels like a musicien. */
export type ArtistMemberRole = 'musicien' | 'technicien';

/** How this person is paid: en liquide, sur la facture globale du groupe, ou déclaré. */
export type ArtistPayment = 'cash' | 'facture' | 'declare';

export type FuelKind = 'essence' | 'diesel' | 'electrique' | 'gpl' | 'autre';

/**
 * One person of the act.
 *
 * `drinkTickets` NULL MEANS "FOLLOW THE SETTING". The régisseur asked that changing the event's
 * figure (`CateringRules.artistDrinks`) update every member "même si déjà importé", and the way
 * to make a setting reach a hundred rows is not to copy it into them. A number here is the one
 * case the régisseur decided by hand for this person, and it survives the setting moving.
 *
 * The meals are NOT here: they are `MealChoice` rows with `personKind` 'artiste', computed from
 * the act's hours on site and overridable per service exactly as an orga's are. See `catering.ts`.
 */
export interface ArtistMember {
  /** Unique across the whole plan, not only within the act: a meal choice points at it alone. */
  key: string;
  firstName: string;
  lastName: string;
  role: ArtistMemberRole;
  /** Free text, as for a bénévole. "Végétarien", "Sans porc". */
  diet: string;
  allergies: string;
  drinkTickets: number | null;
  payment: ArtistPayment;
  /**
   * The people this member may bring in, by name, since 2026-09-13. "Ce ne doit pas être une
   * checkbox, mais un nom et un prénom": the billetterie reads names off a list, and a tick
   * would have told them nothing. `TicketingRules.guestsPerArtist` is the number each member is
   * entitled to; a longer list is a signalement, never a refusal.
   */
  guests: Guest[];
  /**
   * The bénévole or the orga this member ALSO is, since 2026-09-13, or null for nobody.
   *
   * ONE PERSON, ONE ROW, ONE PLATE. A régisseur who plays in a band and runs the bar is on the
   * caterer's sheet once: the person's own row absorbs the act's hours on the venue (see
   * `defaultMealChoices`), the member is left off the list, and the drink tickets are settled
   * by `CateringRules.artistDrinksCumulative`. A link to somebody the plan no longer holds reads
   * as no link at all.
   */
  linkedKind: PersonKind | null;
  linkedKey: string;
  /** Where the validation mail goes. Typed by hand. Since 2026-10-22. */
  email: string;
  /** As `Organiser.applicationStatus`. Since 2026-10-22; absent means « inscription ». */
  applicationStatus?: ApplicationStatus;
}

/**
 * One car journey the association reimburses.
 *
 * `fromVenue` / `toVenue` true means "le lieu de l'événement", and the address is then read from
 * `Plan.address` at the moment it is shown rather than copied here: the venue may be typed in
 * after the trip is, and a copy would keep whatever it was that day.
 */
export interface CarTrip {
  key: string;
  fromAddress: string;
  fromVenue: boolean;
  toAddress: string;
  toVenue: boolean;
  fuel: FuelKind;
  /** Litres, or kWh for an electric car, per 100 km. */
  consumptionPer100: number;
  tolls: boolean;
  /** As computed or typed, in km. Null until either happens. */
  distanceKm: number | null;
  /** What the journey cost or will cost, in euros. Null until computed or typed. */
  cost: number | null;
}

export interface Artist {
  key: string;
  /** The act's name, as on the poster. */
  name: string;
  /** The set, in hours from the event's start. Read by the validator and the solver. */
  start: number;
  end: number;
  /**
   * How many people travel with the act, musiciens and techniciens together.
   *
   * A NUMBER OF ITS OWN AND NOT `members.length`, because the régisseur knows "ils sont cinq"
   * weeks before they know a single name, and the caterer needs the five. The fiche says how
   * many of them are named so far.
   */
  size: number;
  /** The changement de plateau, in hours, on each side of the set. Zero is "none", the default. */
  changeoverBefore: number;
  changeoverAfter: number;
  /** Défraiement: the train and plane tickets to book, and whether that is done. */
  trainTickets: number;
  trainDone: boolean;
  /** What the train tickets cost, in euros, all of them together. */
  trainCost: number;
  planeTickets: number;
  planeDone: boolean;
  planeCost: number;
  carTrips: CarTrip[];
  /** The number to call about the act: the tour manager's, or the drummer's. */
  contactPhone: string;
  /** Free text: "2 DI, 1 retour casque". */
  technicalNeeds: string;
  /** Lines on the patch list, a whole number. */
  patchSize: number;
  notes: string;
  /**
   * The balances. `soundcheckNeeded` false means the three fields below are not read at all;
   * the hours are kept so a régisseur who unticks and ticks again gets them back.
   * Hours from the event's start, and NEGATIVE when the balances fall before it.
   */
  soundcheckNeeded: boolean;
  soundcheckStart: number;
  soundcheckEnd: number;
  /** Whether an ingé son has to be there for the balances. */
  soundcheckEngineer: boolean;
  members: ArtistMember[];
  /** The people the act invites beyond what each member brings, by name. */
  extraGuests: Guest[];
}

/**
 * Somebody let in on an act's word: a member's guest, or one of the act's own.
 *
 * A name and nothing else, on purpose. They eat nothing and are handed nothing unless the
 * régisseur decides so on the billetterie, where they are a row like everybody else.
 */
export interface Guest {
  /** Unique across the whole plan, like a member's: a ticket or a bracelet points at it. */
  key: string;
  firstName: string;
  lastName: string;
}

/**
 * An act with nothing decided yet beyond what is given. The one place the defaults are written:
 * no changeover, no balances, nobody named, nothing to book.
 */
export function makeArtist(
  given: Pick<Artist, 'key' | 'name' | 'start' | 'end'> & Partial<Artist>,
): Artist {
  return {
    size: 1,
    changeoverBefore: 0,
    changeoverAfter: 0,
    trainTickets: 0,
    trainDone: false,
    trainCost: 0,
    planeTickets: 0,
    planeDone: false,
    planeCost: 0,
    carTrips: [],
    contactPhone: '',
    technicalNeeds: '',
    patchSize: 0,
    notes: '',
    soundcheckNeeded: false,
    soundcheckStart: given.start,
    soundcheckEnd: given.end,
    soundcheckEngineer: false,
    members: [],
    extraGuests: [],
    ...given,
  };
}

export function makeArtistMember(
  given: Pick<ArtistMember, 'key'> & Partial<ArtistMember>,
): ArtistMember {
  return {
    firstName: '',
    lastName: '',
    role: 'musicien',
    diet: '',
    allergies: '',
    drinkTickets: null,
    payment: 'cash',
    guests: [],
    linkedKind: null,
    linkedKey: '',
    email: '',
    ...given,
  };
}

export function makeCarTrip(given: Pick<CarTrip, 'key'> & Partial<CarTrip>): CarTrip {
  return {
    fromAddress: '',
    fromVenue: false,
    toAddress: '',
    toVenue: true,
    fuel: 'essence',
    consumptionPer100: 7,
    tolls: true,
    distanceKm: null,
    cost: null,
    ...given,
  };
}

export interface Volunteer {
  key: string;
  firstName: string;
  lastName: string;
  /**
   * "Surnom (si tu préfères qu'on t'appelle par celui-ci)", as answered. Empty when it was not.
   *
   * It is what their team will call them on the night, so it replaces the first name in every
   * short label the tool draws, and nowhere else: see `display.ts`. The welcome desk's list, the
   * exports and anything the association has to check a person against keep the registered name.
   */
  nickname: string;
  email: string;
  phone: string;
  accessCode: string;
  /**
   * "Ton régime alimentaire", as answered. Empty when the question was left blank.
   *
   * READ SINCE 2026-09-12 AND NOT BEFORE. The form has asked it since the first export and the
   * importer threw the column away, because nothing downstream had any use for it. The catering
   * screen does: a caterer counts plates, and the ones that are not the standard plate are the
   * whole of what they need told. See `.claude/memory/feature_catering.md`.
   *
   * Free text on purpose, exactly like `Organiser.diet` beside it. "Végétarien", "Sans porc",
   * "Végétalien sauf le miel": a closed list would have to be invented here, and the answer that
   * did not fit it would be the one that mattered.
   */
  diet: string;
  /** "As-tu une allergie…", as answered. Kept apart from the diet: a caterer reads them apart. */
  allergies: string;
  /**
   * The hours asked for: for the whole event, or for each day, as `Plan.volume.scope` says. Any
   * figure since 2026-09-14; the options a form offers are `Plan.volume.options`.
   */
  requestedHours: number;
  /**
   * The `PreferenceSlot` they would rather work, by id, or null for "peu importe". Scored, never
   * enforced: see `preferenceMisfit`. An id naming a tranche the plan no longer has is kept as
   * they gave it and simply stops costing anything.
   */
  preferredSlotId: SlotId | null;
  /**
   * The slots this person cannot work. Empty means they can work all of them.
   *
   * A LIST SINCE 2026-09-10, when the form stopped asking this as a single choice and started
   * asking it as a sentence. "Je ne peux pas avant 18h et je pars à 2h" is two slots, and the
   * single id kept here before could only ever hold one of them: the other refusal would have
   * been dropped in silence, and this is a hard rule, so a dropped refusal is somebody standing
   * in a place they wrote down that they could not stand in.
   *
   * Read `availabilityNote` beside it. This field is an interpretation of that sentence, made by
   * the importer or corrected by the régisseur; the sentence itself is what the person said.
   */
  refusedSlotIds: SlotId[];
  /**
   * The slots this person would rather not work, without refusing them: « oui, mais je préfère
   * ne pas en faire si possible ». Since 2026-09-15. The same tranches as `refusedSlotIds` (the
   * night is one tranche, refused by some and avoided by others), scored per hour by the criterion
   * `avoidedSlot` and never enforced. Absent means none.
   */
  avoidedSlotIds?: SlotId[];
  /**
   * Windows of the event this person is not there, on top of the refused tranches: an arrival, a
   * departure, a day off. Since 2026-09-15, edited day by day on the fiche and read from the
   * arrival and departure questions of a form. Subtracted by `PlanIndex.windowsOf`, so a
   * placement inside one is `hors-disponibilite`. Absent means none. See `presence-days.ts`.
   */
  unavailable?: Window[];
  /** The `SkillTag` keys this person holds. An answer read from `skillsNote`, correctable. */
  skills?: string[];
  /**
   * « Quelles sont tes compétences / permis / CACES / ton métier ? », as typed. Since 2026-09-15.
   * The tags above are what the importer recognised in it; this is what the person said.
   */
  skillsNote?: string;
  /**
   * « Tu veux qu'on appelle qui en cas d'urgence ? », as typed: a name and a number. Since
   * 2026-09-15. FIELD DATA: shown to the régie and to responsables, stripped from the plan an orga
   * without a pole reads (`get_organiser_planning`), never in a volunteer's own view or an export.
   */
  emergencyContact?: string;
  /**
   * Health problems or specific needs, as typed: the tasks they cannot do, what they need. Since
   * 2026-09-15. Special-category data under the GDPR: the same visibility as `emergencyContact`,
   * and nothing in the tool reads it but a human.
   */
  healthNote?: string;
  /**
   * Under 18 on the first day of the event, worked out at import from a birth date that is NOT
   * kept (data minimisation: the tool needs the fact, not the date). Null when not asked.
   */
  minor?: boolean | null;
  /**
   * « Est-ce important pour toi qu'on t'appelle par ton surnom ? ». False shows the first name on
   * the grid and the documents even when a nickname was given; true or absent keeps the nickname,
   * which is what the tool did before the question existed.
   */
  nicknameMatters?: boolean | null;
  /**
   * The pole a responsable sent this person to (« envoyé·e par un·e respo sur un poste précis »),
   * set by the régisseur. Since 2026-09-15. It counts as their first choice wherever they are
   * placed in it, and anywhere else costs the criterion `imposedPole` (or is refused, when the
   * event blocks it). The régisseur can still place them anywhere by hand. Null means none.
   */
  imposedPoleKey?: string | null;
  /**
   * The `Team` this person belongs to, set by the régisseur, or null. Since 2026-09-15. Not an
   * answer: carried whole across re-imports like the status.
   */
  teamKey?: string | null;
  /**
   * The `SideActivity` keys this person is keen on. An answer: a yes to a form question naming the
   * activity, correctable on the fiche. Since 2026-09-15.
   */
  sideActivityKeys?: string[];
  /**
   * « Peux-tu ramener du matos à toi ? Si oui quoi ? », as typed. Since 2026-09-15. Read on the
   * Magasin tab, where one click turns it into an expected item lent by this person.
   */
  equipmentNote?: string;
  /**
   * The time constraint, in the volunteer's own words, exactly as they typed it.
   *
   * KEPT VERBATIM AND NEVER REWRITTEN. `refusedSlotIds` is a guess about this sentence, and a
   * guess about a sentence has to be checkable against the sentence: "je finis le service à 19h"
   * could mean they arrive at 19h or leave at 19h, and only the régisseur reading the original
   * can tell. Empty when the question was left blank.
   */
  availabilityNote: string;
  /**
   * Root pole keys, one per pole ruled out. Refusing a pole refuses its whole subtree.
   *
   * A LIST SINCE 2026-09-08, and it has to be. The form asks this with checkboxes, so somebody
   * can rule out three poles; the single key kept here before dropped the other two silently,
   * and this is a hard rule, so a dropped refusal is somebody standing in a pole they wrote
   * down that they would not work. Empty means they refused none.
   */
  refusedPoleKeys: string[];
  /** The poles asked for, in the order given. See `PoleChoice`. Empty when none was. */
  choices: PoleChoice[];
  artistKeys: string[];
  /** What the volunteer typed, not a resolved reference. Typos and nicknames are on purpose. */
  buddyRawNames: string[];
  /**
   * Answers the régisseur corrected by hand, by field name.
   *
   * THE ONE THING A RE-IMPORT MUST NOT UNDO. The form is exported again every few days, and
   * without this list every correction made on a fiche would last until the next import and
   * then quietly go back to whatever the parser first thought. A field named here keeps its
   * corrected value; every other field on the same person is still updated from the export.
   *
   * When the raw answer behind a corrected field changes in a later export, the correction is
   * kept and the fiche goes back to `needsReview`: the person has said something new, and the
   * correction was made against what they used to say. See `reconcile.ts`.
   */
  manualFields: EditableField[];
  /**
   * The form's own answers behind each correctable field, as the last import read them: the raw
   * cells joined, keyed by field. Since 2026-10-23 (PLAN_FORMAT 30).
   *
   * What a re-import compares a hand correction against. Comparing the correction with the
   * form's READING flagged it on every import, since a correction differs from the reading by
   * definition; comparing the raw answers flags it only when the person changed what they said.
   * Absent on a fiche imported before, or entered by hand: nothing to compare, nothing flagged.
   * `photo` is the form's upload answer, kept so a photo that failed to come can be asked again
   * from the fiche (2026-10-23); it is never compared.
   */
  formAnswers?: Partial<Record<FormAnswerKey, string>>;
  /**
   * True when somebody has to read this fiche before trusting it.
   *
   * Set by the importer whenever it had to interpret prose and is not certain of its reading:
   * an "Autre" pôle it could not match, a time constraint it could not parse, a sentence it
   * parsed one way when another was possible. Cleared only by a human validating the fiche,
   * never by the tool itself.
   */
  needsReview: boolean;
  /** Why, in French, one line per doubt. Shown on the fiche and in the review queue. */
  reviewReasons: string[];
  /**
   * Whether this bénévole comes to the montage, and to the démontage, and when.
   *
   * A bénévole is not an orga: they are only on site during the days the régisseur opened to
   * them, `Phase.volunteersFrom` to `Phase.volunteersUntil`. Saying yes without stating hours
   * means the whole of that opening, which is the default the régisseur asked for.
   */
  montage: PhasePresence;
  demontage: PhasePresence;
  /**
   * Written by the régisseur rather than read from the form, since 2026-09-15: an orga turned
   * into a bénévole on the Personnes tab. See `convert.ts`.
   *
   * WHAT IT PROTECTS. The form's export has no row for this person, so the next import would list
   * them among the « Absents de l'export », ticked for removal like somebody who withdrew. A person
   * who never filled the form in has not withdrawn from it: the import screen offers them ticked
   * to keep instead, and still lets the régisseur untick. Optional because every fixture and every
   * import predates it; absent means false.
   */
  enteredByHand?: boolean;
  /**
   * Where this application stands, set by the régisseur, never by an import. See
   * `ApplicationStatus`. Absent means 'candidature', which is every fiche written before
   * 2026-09-15 and every fresh row of an export.
   */
  status?: ApplicationStatus;
  /** The `ApplicationStep` keys ticked for this person, by the régisseur or a later form. */
  statusSteps?: string[];
  /** The régisseur's own note on the fiche. Not an answer, so no import ever touches it. */
  regieNote?: string;
  /**
   * When they first answered the form, as the export writes it ("15/09/2026 17:11:42"). The
   * earliest of their answers when they answered several times, since that is their place in the
   * queue for a waiting list. Empty when the export has no timestamp column.
   */
  registeredAt?: string;
  /**
   * « Réserve » since 2026-09-15: ready to come and reinforce a short créneau beyond their own
   * volume, when rested. NOT `Plan.reserve`, which the screens call « Liste d'attente » since the
   * same day (people with no créneau, kept until the plan is settled). An answer, correctable.
   */
  backup?: boolean;
  /** How they describe their stamina, or null when not asked. An answer, correctable. */
  energy?: EnergyProfile | null;
}

/**
 * Where an application stands. The waiting list is NOT a status: it is `Plan.reserve`, which the
 * solver fills and empties itself, and a second source of truth for it would disagree with the
 * first on the first re-solve. The screens show « Liste d'attente » from that list instead.
 *
 *   candidature   registered, not decided yet. Placeable, as every bénévole was before.
 *   valide        accepted by the régisseur. Placeable.
 *   annule        withdrew or was withdrawn. Never placed: a placement becomes a tier 1 issue
 *                 (`candidature-annulee`) and a re-solve proposes its removal. Nothing is removed
 *                 silently: the fiche offers to free the places, as one edit the régisseur makes.
 */
export type ApplicationStatus = 'candidature' | 'valide' | 'annule';

export const APPLICATION_STATUSES: readonly ApplicationStatus[] = ['candidature', 'valide', 'annule'];

/** Gender-neutral on purpose: half the bénévoles are women. */
export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  // « Inscription » on screen since 2026-10-22, the régisseur's word for somebody entered and
  // not decided yet; the identifier stayed.
  candidature: 'Inscription',
  valide: 'Validée',
  annule: 'Annulée',
};

export const statusOf = (volunteer: Pick<Volunteer, 'status'>): ApplicationStatus =>
  volunteer.status ?? 'candidature';

/** The same for an orga, a member of an act or an extra person, whose field has another name. */
export const applicationStatusOf = (person: { applicationStatus?: ApplicationStatus }): ApplicationStatus =>
  person.applicationStatus ?? 'candidature';

/**
 * One step of the follow-up of a bénévole after their validation. A setting per event, because
 * every event runs its own sequence; the key is stable so renaming a step never unticks anybody.
 *
 * Since 2026-10-22 a step may carry a MAIL (`StepMail`): it is then a grouped sending from the
 * Mails tab, to the validated bénévoles its target names, and possibly a question they answer
 * from their personal page. A step without one is still a box ticked by hand, for what happens
 * outside the tool. See `followup.ts`.
 */
export interface ApplicationStep {
  key: string;
  label: string;
  mail?: StepMail;
}

/**
 * What a bénévole is asked by a step's mail. `confirmer` is one button (« Je confirme mes
 * horaires »), `oui-non` two. The answer is given from the personal page the mail links to.
 */
export type StepReply = 'aucune' | 'confirmer' | 'oui-non';

export const STEP_REPLIES: readonly StepReply[] = ['aucune', 'confirmer', 'oui-non'];

export const STEP_REPLY_LABEL: Record<StepReply, string> = {
  aucune: 'Aucune réponse attendue',
  confirmer: 'Un bouton « Je confirme »',
  'oui-non': 'Oui ou non',
};

export interface StepMail {
  subject: string;
  body: string;
  /** Only the bénévoles placed somewhere: a créneau, or a box on the montage or the démontage. */
  placedOnly: boolean;
  /** Only those who asked for at least this many hours; zero means every validated bénévole. */
  minRequestedHours: number;
  reply: StepReply;
  /** The question on their page, `{heures}` filled with their hours. Unused without a reply. */
  question: string;
  /**
   * The kinds of person the step goes to (`MailAudience`), since 2026-10-22. ABSENT MEANS THE
   * BÉNÉVOLES ONLY, what every step did before. Only a bénévole can answer by the link: anybody
   * else is sent the mail and nothing is asked of them.
   */
  audiences?: string[];
  /**
   * Another text for some of those kinds: the orgas told their montage and démontage hours,
   * without being asked to confirm on a page they do not have. A kind on no variant gets the
   * step's own text.
   */
  variants?: StepMailVariant[];
}

/** See `StepMail.variants`. */
export interface StepMailVariant {
  audiences: string[];
  subject: string;
  body: string;
}

/*
 * The defaults of a new event, since 2026-10-22: the Loto Tekno's sequence, written so that any
 * event can keep it. « Mail de confirmation envoyé » is gone: the validation mail is recorded by
 * itself. The keys of the 2026-09-15 defaults that survive (`infos`) are kept, so an event that
 * ticked them by hand finds its ticks again.
 */
export const DEFAULT_APPLICATION_STEPS: readonly ApplicationStep[] = [
  {
    key: 'heures-supp',
    label: 'Heures supplémentaires',
    mail: {
      subject: '{evenement} : tu confirmes tes {heures} h ?',
      body:
        'Bonjour {prenom},\n\n' +
        'Dans le formulaire, tu as proposé de donner {heures} h pendant {evenement} ({date}). Merci, ça nous aide énormément !\n\n' +
        "Avant de construire les plannings, on préfère vérifier que c'est toujours bon pour toi. Un clic suffit pour répondre :\n" +
        '{lien}\n\n' +
        'À très vite,\n' +
        "L'équipe d'organisation",
      placedOnly: false,
      minRequestedHours: 6,
      reply: 'oui-non',
      question: 'Tu confirmes vouloir faire {heures} h ?',
    },
  },
  {
    key: 'planning',
    label: 'Planning',
    mail: {
      // The orgas too since 2026-10-22, with their own words: they confirm nothing by a link.
      audiences: ['benevole', 'orga', 'responsable'],
      variants: [
        {
          audiences: ['orga', 'responsable'],
          subject: '{evenement} : tes horaires',
          body:
            'Bonjour {prenom},\n\n' +
            'Voici tes horaires pour {evenement}, montage et démontage compris :\n\n' +
            '{planning}\n\n' +
            "S'il y a quelque chose qui ne va pas, dis-le nous vite.\n\n" +
            'Merci !\n' +
            "L'équipe d'organisation",
        },
      ],
      subject: '{evenement} : ton planning bénévole',
      body:
        'Bonjour {prenom},\n\n' +
        'Voici tes créneaux pour {evenement} :\n\n' +
        '{planning}\n\n' +
        "Peux-tu nous confirmer qu'ils te conviennent ? Un clic suffit :\n" +
        '{lien}\n\n' +
        "Le planning peut encore bouger un peu : si c'est le cas, on t'enverra la nouvelle version.\n\n" +
        'Merci !\n' +
        "L'équipe d'organisation",
      placedOnly: true,
      minRequestedHours: 0,
      reply: 'confirmer',
      question: 'Je confirme mes horaires',
    },
  },
  {
    key: 'infos',
    label: 'Infos pratiques',
    mail: {
      audiences: ['benevole', 'orga', 'responsable'],
      subject: '{evenement} : infos pratiques et planning définitif',
      body:
        'Bonjour {prenom},\n\n' +
        "C'est bientôt ! Voici ton planning définitif pour {evenement} ({date}, {lieu}) :\n\n" +
        '{planning}\n\n' +
        'Infos pratiques :\n' +
        '(à compléter : accès, parking, repas, tenue, contact le jour J)\n\n' +
        'Ton planning reste consultable à tout moment ici :\n' +
        '{lien}\n\n' +
        'À très vite,\n' +
        "L'équipe d'organisation",
      placedOnly: true,
      minRequestedHours: 0,
      reply: 'aucune',
      question: '',
    },
  },
];

/**
 * Who a mail speaks to: a kind of person, because a bénévole is told something else than a band.
 * A responsable is an orga holding a pole. SINCE 2026-10-22 A GUEST TYPE'S KEY IS ONE TOO (see
 * `GuestType`): « prestataire » and « autre » were fixed kinds before, and are now the keys of
 * two default guest types.
 */
export type MailAudience = string;

/** The kinds the tool computes. The event's guest types come after them. */
export const BUILT_IN_AUDIENCES: readonly MailAudience[] = ['benevole', 'orga', 'responsable', 'artiste'];

/** The fixed kinds of before 2026-10-22, read from a stored plan that still has them. */
export const MAIL_AUDIENCES: readonly MailAudience[] = ['benevole', 'orga', 'responsable', 'artiste', 'prestataire', 'autre'];

/** What a mail is sent for, from a fiche: the validation, and since 2026-10-22 the cancellation. */
export type MailKind = 'validation' | 'annulation';

/**
 * One message and the kinds of person it goes to, since 2026-10-22. One mail may serve several
 * kinds (« Partenaire » and « Autre invitation »), and each kind has its own if the régisseur
 * wants: a kind is on one mail of a list at most.
 */
export interface AudienceMail {
  key: string;
  audiences: MailAudience[];
  subject: string;
  body: string;
}

/**
 * The event's mails by what they are sent for. A list ABSENT IS THE DEFAULTS, so a better default
 * text reaches every event that never touched it; once touched, the list is stored whole.
 */
export interface MailSet {
  validation?: AudienceMail[];
  annulation?: AudienceMail[];
}

/** One message, with `{prenom}`-style blanks filled at sending time. See `registration.ts`. */
export interface MailTemplate {
  subject: string;
  body: string;
}

/**
 * Stamina, as a form asks it ("je fonce", "je gère mon rythme"...). Shown on the fiche beside the
 * hours given, and read before drawing somebody from the Réserve. Informs, never scores.
 */
export type EnergyProfile = 'fonce' | 'regulier' | 'fatigable' | 'premiere';

export const ENERGY_PROFILES: readonly EnergyProfile[] = ['fonce', 'regulier', 'fatigable', 'premiere'];

export const ENERGY_LABEL: Record<EnergyProfile, string> = {
  fonce: 'Fonce, récupère après',
  regulier: 'Gère son rythme, habitude',
  fatigable: 'Fatigue vite',
  premiere: 'Première expérience',
};

/**
 * The answers a régisseur may correct on a fiche, and therefore the ones a re-import can be
 * told to leave alone.
 *
 * Deliberately not every field of `Volunteer`. A key is an identity, an access code is ours,
 * and the raw answers are what the person said: none of those is an interpretation, so none of
 * them is correctable. What is left is exactly the interpretations.
 */
export const EDITABLE_FIELDS = [
  'firstName',
  'lastName',
  'nickname',
  'email',
  'phone',
  'requestedHours',
  'preferredSlotId',
  'refusedSlotIds',
  'avoidedSlotIds',
  'unavailable',
  'skills',
  // Field data, 2026-09-15: correctable like any answer, for the day somebody calls to change it.
  'emergencyContact',
  'healthNote',
  'minor',
  'nicknameMatters',
  'imposedPoleKey',
  'sideActivityKeys',
  'refusedPoleKeys',
  // The whole list, since 2026-09-14: correcting one choice is correcting the reading of the
  // answers, and a list edited entry by entry would let a re-import reorder half of it.
  'choices',
  'artistKeys',
  'buddyRawNames',
  // The diet and the allergies, added 2026-09-12. Correctable because a caterer reads them and
  // acts on them: "végé", "vegetarien" and "pas de viande" are one plate, and the régisseur is
  // the one who can say so. The raw answer is not kept beside them, unlike the pole and time
  // questions, because there is no reading to check against: what is stored IS the sentence.
  'diet',
  'allergies',
  // The two phase answers, added 2026-09-10. Correctable for the same reason the time
  // constraint is: they arrive as a sentence and the tool's reading of one can be wrong.
  'montage',
  'demontage',
  // Two answers added 2026-09-15, both correctable like any other: the reinforcement answer and
  // the stamina one.
  'backup',
  'energy',
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** What `Volunteer.formAnswers` is keyed by: a correctable field, or the photo upload. */
export type FormAnswerKey = EditableField | 'photo';

export interface SyntheticEvent {
  name: string;
  startISO: string;
  lengthHours: number;
  rules: SchedulingRules;
  poles: Pole[];
  shifts: Shift[];
  artists: Artist[];
  volunteers: Volunteer[];
}

export const shiftHours = (shift: Shift): number => shift.end - shift.start;

export const demandHours = (shifts: readonly Shift[]): number =>
  shifts.reduce((total, s) => total + shiftHours(s) * s.headcount, 0);

/** Converts decimal hours from the event start into a real ISO timestamp. */
export function toIso(startISO: string, hours: number): string {
  const base = new Date(startISO).getTime();
  return new Date(base + hours * 3600_000).toISOString();
}

/**
 * The real moment an hour offset lands on, in the reader's own timezone.
 *
 * This used to add a fixed +01:00, on the grounds that the event was 13 March 2027 and never
 * crossed a DST boundary. That stopped being true the moment the régisseur could edit the start
 * date: an event moved to July would have had every label an hour out, silently. The runtime's
 * own timezone is right for everyone who reads these, since the association, the event and the
 * browser are in the same country.
 */
const atHour = (startISO: string, hours: number): Date =>
  new Date(new Date(startISO).getTime() + hours * 3600_000);

/** "13/03 22:30", the form the régisseur reads. */
export function toLabel(startISO: string, hours: number): string {
  const d = atHour(startISO, hours);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "22:00": `toLabel` without its date, for an exploit too short for an hour to fall twice. */
export function toTimeOfDay(startISO: string, hours: number): string {
  const d = atHour(startISO, hours);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "22h" or "22h30": the hour alone, for an axis where the day is obvious.
 *
 * Derived from the event's real start, never from an assumed one. The grid ruler used to compute
 * the hour as midday plus the offset, which was exact for an event starting at noon and wrong by
 * the difference for any other, across every hour label, every artist window and every organiser
 * band at once.
 */
export function toClock(startISO: string, hours: number): string {
  const d = atHour(startISO, hours);
  const minutes = d.getMinutes();
  return minutes === 0 ? `${d.getHours()}h` : `${d.getHours()}h${String(minutes).padStart(2, '0')}`;
}

/*
 * LA BILLETTERIE: who gets in without a ticket, and what they are handed at the door.
 *
 * The régisseur's brief of 2026-09-13: the people at the entrance need one list of everybody
 * the tool knows (bénévoles, orgas, artistes, their guests, prestataires, other invitations),
 * with the drink and meal tickets to hand each of them, the kind of ticket their entry is worth
 * and the bracelet to put on their wrist. See `ticketing.ts` for the list; what is here is the
 * configuration behind it and the few decisions the régisseur takes by hand.
 *
 * NOTHING DERIVED IS STORED, the doctrine of every other part of this plan. The list itself is
 * computed every time from the people, the acts and the catering; a ticket or a bracelet is
 * stored only where the régisseur chose one other than the default (`TicketingChoice`).
 */

/**
 * What somebody is, to the door. One person may be several: an orga who plays in a band is an
 * orga AND an artiste, and the list says both.
 */
export type PersonStatus =
  | 'benevole'
  | 'orga'
  | 'responsable'
  | 'artiste'
  | 'invite-artiste'
  | 'prestataire'
  | 'autre';

export const PERSON_STATUS_LABEL: Record<PersonStatus, string> = {
  benevole: 'Bénévole',
  // The key stays « orga » in stored bracelets and mails; what it names is the Staff (2026-10-23).
  orga: 'Staff',
  responsable: 'Responsable',
  artiste: 'Artiste',
  'invite-artiste': "Invité d'artiste",
  prestataire: 'Prestataire',
  autre: 'Autre invitation',
};

/**
 * A kind of entry, and the stretch of the event it opens: "Loto seulement" to 20h, "Soirée" from
 * 20h, "Pass complet". Hours from the event's start, like a créneau. The type covering the most
 * of the event is what everybody gets unless the régisseur says otherwise; a meal served outside
 * somebody's ticket is reported as an incohérence and never refused.
 */
export interface TicketType {
  key: string;
  label: string;
  start: number;
  end: number;
  /**
   * The wristband this entry is worth at the door, « Bracelet Loto + Concerts », since
   * 2026-10-22. Empty when the entry is not a wristband. Every other bracelet is an access that
   * adds to it (`BraceletType`).
   */
  bracelet: string;
}

/**
 * A kind of guest the door knows, since 2026-10-22: « Partenaire », « Prestataire », and
 * whatever the event invites. An extra person is one of them. The figures are what a new person
 * of that kind starts with; each is changed on their own fiche. A guest of an act is not one of
 * these: they belong to the act.
 */
export interface GuestType {
  key: string;
  label: string;
  drinkTickets: number;
  mealTickets: number;
}

/** What every event starts with. The keys of the two old fixed kinds are kept. */
export const DEFAULT_GUEST_TYPES: readonly GuestType[] = [
  { key: 'partenaire', label: 'Partenaire', drinkTickets: 0, mealTickets: 0 },
  { key: 'prestataire', label: 'Prestataire', drinkTickets: 0, mealTickets: 0 },
  { key: 'autre', label: 'Autre invitation', drinkTickets: 0, mealTickets: 0 },
];

/**
 * The statuses known whatever the event: those the tool computes. A guest type's key is a
 * status too, on its own people, and a bracelet may name either.
 */
export const BUILT_IN_STATUSES: readonly PersonStatus[] = ['benevole', 'orga', 'responsable', 'artiste', 'invite-artiste'];

/** The label of a status, a guest type's included. */
export function statusLabel(status: string, guestTypes: readonly GuestType[]): string {
  return (
    guestTypes.find((g) => g.key === status)?.label ??
    (PERSON_STATUS_LABEL as Record<string, string>)[status] ??
    status
  );
}

/**
 * A wristband that gives an access, and who gets it by default: « Backstage » for the orgas and
 * the artistes, « Prix spécial au bar » for whoever works. CUMULATIVE SINCE 2026-10-22: somebody
 * holds every bracelet one of their statuses is named on, and the régisseur sets another list
 * person by person. The entry's own wristband is `TicketType.bracelet`.
 *
 * `defaultFor` holds statuses: one of `BUILT_IN_STATUSES` or a guest type's key.
 */
export interface BraceletType {
  key: string;
  label: string;
  defaultFor: string[];
}

/**
 * Somebody the tool knows only through the billetterie: a prestataire, a guest of the
 * association. No form, no créneau, no act. What they are handed is typed here by hand, since
 * no rule of the event applies to them.
 */
export interface ExtraPerson {
  key: string;
  firstName: string;
  lastName: string;
  /** The key of their `GuestType`. Since 2026-10-22; « prestataire » or « autre » before. */
  status: string;
  phone: string;
  drinkTickets: number;
  mealTickets: number;
  /** Where the validation mail goes. Since 2026-10-22; absent means none typed. */
  email?: string;
  /**
   * As `Organiser.applicationStatus`. NOT `status`, which already says prestataire or autre.
   * Since 2026-10-22; absent means « inscription ».
   */
  applicationStatus?: ApplicationStatus;
}

/**
 * Who a row of the billetterie is: the two people files, a member of an act, somebody's guest,
 * or an extra person. Wider than `MealPersonKind` by the last two, which eat nothing on their own.
 */
export type TicketPersonKind = MealPersonKind | 'invite' | 'extra';

/**
 * What the régisseur decided about one person on the billetterie, beyond the defaults: a ticket
 * or a bracelet other than the default, a number of drink tickets other than the computed one,
 * a remark for the door. Null means "the default"; a row with nothing in it is not stored.
 */
export interface TicketingChoice {
  personKind: TicketPersonKind;
  personKey: string;
  ticketTypeKey: string | null;
  /**
   * The bracelets chosen by hand, the whole list, or null for the defaults. Since 2026-10-22; a
   * single `braceletKey` before, read as a list of one.
   */
  braceletKeys: string[] | null;
  /** The drink tickets to hand, when not the computed figure. */
  drinkTickets: number | null;
  note: string;
}

/**
 * What a car journey costs to reimburse, as the association reckons it: a fuel price per
 * litre (or kWh) by kind, and a toll price per kilometre on the motorway.
 *
 * SETTINGS, NOT A LIVE PRICE. "Calculer automatiquement" fetches the distance from the map; the
 * price of a litre is the association's own figure, typed once in Réglages, because the pump
 * price on the day of the reimbursement is not something a tool should guess from the web.
 */
export interface TravelRates {
  fuelPrices: Record<FuelKind, number>;
  tollPerKm: number;
}

/** The French figures of autumn 2026, roughly. The régisseur corrects them. */
export const DEFAULT_TRAVEL_RATES: TravelRates = {
  fuelPrices: { essence: 1.75, diesel: 1.7, electrique: 0.22, gpl: 0.95, autre: 1.75 },
  tollPerKm: 0.1,
};

export interface TicketingSettings {
  /** How many named guests each member of an act may bring. */
  guestsPerArtist: number;
  /**
   * Whether the bénévoles in reserve are on the door's export (`ticketingCsv`). Since 2026-09-15,
   * off by default: somebody in reserve does zero hours and is normally not on site. The Personnes
   * tab lists them apart either way.
   */
  reserveOnDoorList: boolean;
  /**
   * Whether a Responsable is also given, by default, the bracelets given to the Staff, since
   * 2026-10-23 (« un responsable est un Staff »). Absent reads as on.
   */
  responsablesGetStaffBracelets?: boolean;
  ticketTypes: readonly TicketType[];
  bracelets: readonly BraceletType[];
  /** Since 2026-10-22. See `GuestType`. */
  guestTypes: readonly GuestType[];
  extras: readonly ExtraPerson[];
  choices: readonly TicketingChoice[];
}

/** Nothing configured: no ticket type, no bracelet, one guest per artist, nobody extra. */
export const DEFAULT_TICKETING: TicketingSettings = {
  guestsPerArtist: 1,
  reserveOnDoorList: false,
  ticketTypes: [],
  bracelets: [],
  guestTypes: DEFAULT_GUEST_TYPES,
  extras: [],
  choices: [],
};
