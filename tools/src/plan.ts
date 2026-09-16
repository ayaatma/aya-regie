/**
 * The plan: the whole state the validation engine reads, and the state the solver will write.
 *
 * A Plan is the reference data (poles, shifts, line-up, volunteers, resolved buddy requests)
 * plus the assignments. It carries no derived value: everything derived is computed by
 * PlanIndex or by validate(), so a plan can be serialised, sent over the wire and rebuilt
 * without any risk of a stale cache.
 *
 * Time is decimal hours from the event start throughout, as everywhere else in this package.
 */

import {
  type Artist,
  type PoleChoice,
  type Pole,
  type SchedulingRules,
  type Shift,
  type SkillLevel,
  type EventSlot,
  type PreferenceSlot,
  type CateringSettings,
  type TicketingSettings,
  type TravelRates,
  type Organiser,
  type LeaderRole,
  type OrganiserShift,
  type Volunteer,
  type Window,
  type ApplicationStep,
  type SkillTag,
  type Team,
  type SideActivity,
  type EquipmentItem,
} from './model.js';
import { DEFAULT_APPLICATION_STEPS, DEFAULT_CATERING, DEFAULT_RULES, DEFAULT_TICKETING, DEFAULT_TRAVEL_RATES, toLabel } from './model.js';
import { type Phase, alignPhase, defaultPhase, defaultPhaseStart } from './phase.js';
import { refusedWindows, usableWindows } from './availability.js';
import { shortNames } from './display.js';
import { EMPTY_FORM_MAPPING, type FormMapping } from './form-mapping.js';
import { DEFAULT_VOLUME, dayIndexAt, dayLabel, eventDays, firstBoundary, type VolumeSettings } from './days.js';
import {
  DEFAULT_CONSTRAINTS,
  resolveConstraints,
  type ConstraintSettings,
  type ResolvedConstraints,
} from './constraints.js';

/**
 * The shape of the document, as a number.
 *
 * WHAT IT PROTECTS AGAINST. A save rewrites the plan whole, from the JSON a browser sends, and
 * that browser rebuilds the JSON field by field from what its own build knows about
 * (`normalise.ts`, written that way on purpose). So a tab left open across a deploy silently
 * strips every field it has never heard of and writes the result over everybody's: add a field,
 * deploy, and yesterday's tab wipes it for a hundred and twenty people without a word.
 *
 * Every writer states this number, and the database refuses anything older than it requires. The
 * tool then says "rechargez la page" instead of losing an afternoon of answers.
 *
 * INCREMENT IT WHENEVER A FIELD IS ADDED TO OR REMOVED FROM THE PLAN, in the same commit, and
 * raise `min_plan_format` in `app_setting` in the migration that goes with it. A number that
 * is bumped late protects nothing; a number that is never bumped is a comment.
 *
 * 1: 2026-09-08, the shape at the first deploy.
 * 2: 2026-09-09, pole organisers split in two. `Plan.organisers` was one row per person per pole and
 *    is now the people themselves, carrying their form answers and an access code;
 *    `Plan.leaderRoles` carries which poles each of them runs and when. A plan written by an
 *    older build has neither shape, which is exactly what this number is for.
 * 3: 2026-09-09, `Volunteer.nickname`. The form's "Surnom" answer, thrown away until now. A
 *    build that has never heard of it would write every volunteer back without one and wipe the
 *    answer for everybody who gave it.
 * 4: 2026-09-10, the two free-text answers of the form: `Volunteer.availabilityNote`, the raw
 *    pole answers, the corrections and the review flags, and `Plan.sheetUrl`.
 * 5: 2026-09-10, the montage and the démontage. `Plan.montage` and `Plan.demontage` carry two
 *    whole grids, `Organiser` carries when each orga is on site and where, and every volunteer
 *    carries their answer to the two new questions. A build that predates this writes a plan
 *    back with neither phase, which is every setup decision and every hand-made placement of
 *    both of them gone at once. See `.claude/memory/feature_montage_demontage.md`.
 * 6: 2026-09-12, `Pole.leaderSupportOnly`. Whether a pole's responsable stays in support and
 *    takes no créneau in it. One boolean per pole, and a build that predates it writes every pole
 *    back without the flag, which loses the distinction on all fifteen of them at once.
 * 7: 2026-09-12, the catering. `Plan.catering` carries the meal and drink-ticket rules and every
 *    box the régisseur ticked against them, and every bénévole carries the diet and the allergy
 *    they declared on the form. A build that predates this writes the plan back with no catering
 *    at all, which is the whole of the caterer's count and every hand-ticked meal gone at once.
 * 8: 2026-09-13, the event stops being the Loto Tekno. `Plan.address`, the venue;
 *    `Plan.preferenceSlots`, the tranches somebody may prefer, each with its overflow;
 *    `Volunteer.preferredSlotId` names one of them where `halfPreference` used to name a half,
 *    and the two rules that gave that half its hours (`eveningStartsAt`,
 *    `afternoonOverflowUntil`) are gone. A build that predates this writes every volunteer back
 *    with a preference the base no longer has a column for, and no preference tranche at all.
 * 9: 2026-09-13, the acts become files. `Artist` carries its size, its changement de plateau,
 *    its balances, its défraiement, its members and their meals and tickets, and
 *    `CateringRules.artistDrinks` says what a member is handed. A build that predates this
 *    writes every act back as a name and two hours, which is every member, every trajet and
 *    every ticked plate of the line-up gone at once.
 * 10: 2026-09-13, la billetterie. `Plan.ticketing` (ticket types, bracelets, extra people,
 *    hand-picked tickets and bracelets), and the acts' invitations become NAMES: a member's
 *    `guests` and an act's `extraGuests` replace `invited` and `extraInvitations`. A build
 *    that predates this writes the plan back with no billetterie and every guest gone.
 * 11: 2026-09-13, the door edits a drink figure and a remark on anybody (`TicketingChoice`
 *    gains `drinkTickets` and `note`, `ExtraPerson` loses its own note), `Plan.travel` carries
 *    the fuel and toll rates, an act its ticket costs and contact phone, a trip its distance
 *    and cost. A build that predates this drops all of them on its next save.
 * 12: 2026-09-13, les Réglages avancés. `Plan.constraints` says, per event, which rule blocks,
 *    which one costs and how much, and where a day reads long. A build that predates this writes
 *    the plan back without them, which silently puts every rule the régisseur loosened back to
 *    blocking and every weight back to its default.
 * 13: 2026-09-14, the tool stops assuming the Loto Tekno's form. `Volunteer.choices` replaces
 *    the two flat choices, `Plan.poleChoicesRanked` says whether their order means anything,
 *    `Plan.volume` says whether a volume is per day and where a day begins, and
 *    `Plan.formMapping` remembers the import's columns and answers. A build that predates this
 *    writes every volunteer back with no choice at all.
 * 14: 2026-09-15, `Volunteer.enteredByHand`: a bénévole the régisseur made out of an orga on the
 *    Personnes tab. A build that predates this writes them back as if they came from the form,
 *    and the next import ticks them for removal like somebody who withdrew.
 * 15: 2026-09-15, `TicketingSettings.reserveOnDoorList`: whether the bénévoles in reserve are on
 *    the door's export. A build that predates this writes the setting back as off.
 * 16: 2026-09-15, application tracking. `Volunteer.status`, `statusSteps`, `regieNote`,
 *    `registeredAt`, `backup` (the new Réserve) and `energy`, and `Plan.applicationSteps`. A build
 *    that predates this writes every bénévole back as a fresh candidature with nothing ticked.
 * 17: 2026-09-15, `Volunteer.avoidedSlotIds`, the tranches somebody would rather avoid. A build
 *    that predates this writes every bénévole back as avoiding nothing.
 * 18: 2026-09-15, `Volunteer.unavailable`, availability day by day. A build that predates this
 *    writes every bénévole back as present from the first hour to the last.
 * 19: 2026-09-15, competences: `Plan.skills`, `Volunteer.skills` and `skillsNote`,
 *    `Organiser.skills`, `Pole.requiredSkills`, `PhasePole.requiredSkills`. A build that predates
 *    this writes every tag and every requirement away.
 * 20: 2026-09-15, field data: `emergencyContact` and `healthNote` on bénévoles and orgas, `minor`
 *    and `nicknameMatters` on bénévoles. A build that predates this erases them on its next save.
 * 21: 2026-09-15, `Volunteer.imposedPoleKey`, the pole a responsable sent somebody to. A build
 *    that predates this frees everybody from it on its next save.
 * 22: 2026-09-15, teams: `Plan.teamsEnabled`, `Plan.teams`, `Volunteer.teamKey`. A build that
 *    predates this dissolves every team on its next save.
 * 23: 2026-09-15, side activities: `Plan.sideActivities`, `sideActivityKeys` on bénévoles and
 *    orgas. A build that predates this empties every list on its next save.
 * 24: 2026-09-15, le Magasin: `Plan.equipment` and `Volunteer.equipmentNote`. A build that
 *    predates this empties the store on its next save.
 * 25: 2026-09-17, `Plan.defaultShiftHours`, the event's default length of a créneau, which a
 *    pole follows unless it was set by hand. A build that predates this forgets it on its next save.
 */
export const PLAN_FORMAT = 25;

/** How an assignment came to exist. A locked one never moves in a re-solve. */
export type AssignmentSource = 'solver' | 'manual';

export interface Assignment {
  volunteerKey: string;
  shiftKey: string;
  locked: boolean;
  source: AssignmentSource;
}

/**
 * A buddy request, always one-way and always pairwise. Never a transitive group: a chain
 * "A wants B, B wants C" stays two independent requests, so it can never create an
 * unplaceable three-person block.
 */
export interface BuddyPair {
  fromKey: string;
  toKey: string;
  /**
   * Added by hand on a fiche rather than read from the form, since 2026-09-14. A re-import keeps
   * it: the export knows nothing about it, and dropping it would undo a decision in silence.
   */
  manual?: boolean;
}

export interface Plan {
  name: string;
  startISO: string;
  /**
   * How long the event runs, in hours from its start. 18 for 12h to 06h.
   *
   * Explicit rather than derived from the last shift. The grid spans the event, not the shifts:
   * without this, adding an artist at 17h to an event whose last shift ends at 16h would leave
   * the line-up hanging off the right edge, and an event with a hole at the end would silently
   * shrink. The régisseur sets it, the screens read it, and no rule depends on it.
   */
  lengthHours: number;
  /**
   * Where it happens, as the régisseur would write it on a poster. Free text, empty until typed.
   *
   * On the plan since 2026-09-13 because several things to come need it (a trajet that starts
   * "au lieu de l'événement", a sheet handed to a traiteur), and none of them should each ask
   * for it again.
   */
  address: string;
  /**
   * The Google Sheet the answers are exported to, remembered after the first import.
   *
   * ON THE PLAN AND NOT IN A BROWSER, like a pole’s colour and for the same reason: it is a
   * fact about this event, not about one régisseur’s laptop. The second régisseur opening the
   * import screen finds the link already there, and so does the first one on another machine.
   *
   * Empty until somebody imports from a sheet. A file import never sets it: a CSV somebody
   * downloaded once is not a source the tool can go back to on its own.
   */
  sheetUrl: string;
  rules: SchedulingRules;
  /**
   * Which rule blocks, which one costs and how much, for this event. The Réglages avancés card.
   *
   * Sparse: only what the régisseur changed. Read it through `PlanIndex.constraints`, which is
   * the resolved table, never field by field. See `constraints.ts`.
   */
  constraints: ConstraintSettings;
  /**
   * Whether a volunteer's pole choices are an order of preference, or a set of equals.
   *
   * RANKED, the Loto Tekno form: "choix principal", then "deuxième choix". Each rank further down
   * costs the solver one more step of « Pas sur le premier choix ». UNRANKED, a form that ticks a
   * box per pole: every choice is as good as any other, and only « Hors de tous les choix » is
   * priced. The list keeps its order either way. See `PoleChoice`.
   */
  poleChoicesRanked: boolean;
  /** Whether volumes are for the event or per day, where a day begins, and the options offered. See `days.ts`. */
  volume: VolumeSettings;
  /**
   * Which column of the form's export answers what, and what the closed answers mean, as the
   * régisseur decided on the import screen. Sparse; see `form-mapping.ts`.
   */
  formMapping: FormMapping;
  /**
   * The slots the form asks about, and their hours.
   *
   * Configuration, not a constant: the form is the régisseur's to word, and every volunteer's
   * `refusedSlotIds` names some of these by id.
   */
  slots: readonly EventSlot[];
  /**
   * The answers to "Qu'est ce que tu préfères ?", each a stretch of the event with its own
   * tolerated overflow. Every volunteer's `preferredSlotId` names one of these or none. Kept
   * apart from `slots` because these may overlap and nothing that tiles the event reads them.
   */
  preferenceSlots: readonly PreferenceSlot[];
  poles: readonly Pole[];
  shifts: readonly Shift[];
  artists: readonly Artist[];
  /** Whoever runs a pole, as people. Never assigned, never scheduled. */
  organisers: readonly Organiser[];
  /**
   * Which poles each of them runs, and when.
   *
   * Kept beside the people rather than inside them for the same reason `assignments` is kept
   * beside the volunteers: it is a relation, both ends of it are edited from different screens,
   * and deleting a pole has to be able to cut the link without touching the person.
   */
  leaderRoles: readonly LeaderRole[];
  volunteers: readonly Volunteer[];
  buddies: readonly BuddyPair[];
  /**
   * Pairs read from the form that the régisseur removed by hand. Nothing plans with them; they
   * exist so the next re-import of the same answer does not put the pair back.
   */
  dismissedBuddies: readonly BuddyPair[];
  assignments: readonly Assignment[];
  /**
   * Volunteers held in reserve, by key.
   *
   * A reserve volunteer has no shift at all, on purpose. The event has more registrations than
   * it has hours to offer, and the honest answer is to tell those people they are the backup
   * rather than to hand them a token 2h so the plan looks tidy. Being at zero hours is what
   * makes "we did not need you in the end" a sentence someone can actually say.
   *
   * This is validated state, like an assignment: the solver proposes a reserve list, the
   * régisseur accepts it. Never a silent demotion.
   *
   * « LISTE D'ATTENTE » ON EVERY SCREEN SINCE 2026-09-15. The régisseur found it used for people
   * with no créneau who will probably not be taken, which is a waiting list; « Réserve » now names
   * `Volunteer.backup`, validated people ready to do more. The identifier stayed, the words moved.
   */
  reserve: readonly string[];
  /**
   * The messages and checks ticked per bénévole, in order (« Mail de confirmation envoyé »...).
   * The event's own sequence; see `ApplicationStep`.
   */
  applicationSteps: readonly ApplicationStep[];
  /** The competences this event names, in order. See `SkillTag`. Since 2026-09-15. */
  skills: readonly SkillTag[];
  /**
   * « Fonctionnement en équipe », since 2026-09-15: whether this event keeps teams together. Off,
   * the teams below are kept and simply not scored.
   */
  teamsEnabled: boolean;
  teams: readonly Team[];
  /** Pré-montage, weekends: activities with a list of volunteers and no grid. Since 2026-09-15. */
  sideActivities: readonly SideActivity[];
  /** « Magasin »: the equipment, lent or owned, and where each piece is. Since 2026-09-15. */
  equipment: readonly EquipmentItem[];
  /**
   * How long a new créneau lasts, in hours, for every pole that was not given its own length by
   * hand (`Pole.defaultShiftHours`). Since 2026-09-17: changing it here moves every pole that
   * follows it, and none that the régisseur set. Two hours, as every pole had before.
   */
  defaultShiftHours: number;
  /**
   * Orgas standing in créneaux of the exploit, placed by hand and by hand only.
   *
   * Beside `assignments` rather than inside it, because an orga is exempt from every rule an
   * assignment is subject to. See `OrganiserShift`.
   */
  organiserShifts: readonly OrganiserShift[];
  /**
   * The two phases around the event: the setup and the teardown.
   *
   * ALWAYS PRESENT, AND OFF UNTIL THE RÉGISSEUR TURNS THEM ON. A plan built before 2026-09-10
   * opens with both of them disabled and carrying their defaults, so nothing about it moves and
   * no screen has to ask whether a phase exists before reading it.
   *
   * Each of them is a world of its own: its own origin, its own poles, its own placements. The
   * fields above this line are the exploit's and the exploit's only, which is what keeps the
   * rules, the solver and the proposals untouched by any of this.
   */
  montage: Phase;
  demontage: Phase;
  /**
   * The meals and the drink tickets: what the rules are, and which boxes were ticked by hand.
   *
   * OFF UNTIL THE RÉGISSEUR TURNS IT ON, like the two phases above and for the same reason: a
   * plan built before 2026-09-12 opens carrying the defaults and shows nothing anywhere.
   *
   * Nothing derived lives here. Who eats at which service is worked out from the plan every time
   * it is read, and only the disagreements with that reading are stored. See `MealChoice`.
   */
  catering: CateringSettings;
  /**
   * La billetterie: the ticket types, the bracelets, the people known only to the door, and
   * the few tickets or bracelets the régisseur chose by hand. The list of who gets in is derived
   * from everything else, every time. See `ticketing.ts`.
   */
  ticketing: TicketingSettings;
  /** What a car journey is reimbursed at: fuel prices and a toll rate. See `TravelRates`. */
  travel: TravelRates;
}

/**
 * One organiser, on one pole, for one window: the two halves of the split put back together.
 *
 * What every screen that draws organisers actually wants. Neither half is enough on its own, since
 * the name lives on the person and the hours live on the role.
 */
export interface LeaderOnPole {
  organiser: Organiser;
  role: LeaderRole;
}

/** A maximal run of touching or overlapping shifts worked by one volunteer. */
export interface Block {
  start: number;
  end: number;
  shiftKeys: string[];
}

export const overlaps = (a: Window, b: Window): boolean => a.start < b.end && b.start < a.end;

/** "4h", "2h30". Durations are shown to the régisseur, so they are formatted in French. */
export function fmtHours(hours: number): string {
  const whole = Math.floor(hours + 1e-9);
  const minutes = Math.round((hours - whole) * 60);
  return minutes === 0 ? `${whole}h` : `${whole}h${String(minutes).padStart(2, '0')}`;
}

/**
 * Merges a volunteer's shifts into blocks. Touching shifts (one ends exactly where the next
 * starts) merge, which is the whole point: the 4h consecutive cap is counted across poles, so
 * two adjacent 2h shifts in two different poles are one 4h block.
 */
export function buildBlocks(shifts: readonly Shift[]): Block[] {
  const sorted = [...shifts].sort((a, b) => a.start - b.start || a.end - b.end);
  const blocks: Block[] = [];

  for (const shift of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && shift.start <= last.end) {
      last.end = Math.max(last.end, shift.end);
      last.shiftKeys.push(shift.key);
    } else {
      blocks.push({ start: shift.start, end: shift.end, shiftKeys: [shift.key] });
    }
  }

  return blocks;
}

/**
 * Lookups and derived views over a plan. Built once, read many times. Nothing here validates
 * anything; it only answers "what is where", so that validate() and the solver agree on the
 * same picture of the state.
 */
export class PlanIndex {
  readonly plan: Plan;
  readonly rules: SchedulingRules;
  readonly slots: readonly EventSlot[];
  readonly preferenceSlots: readonly PreferenceSlot[];
  /** Every criterion's mode and weight for this event, defaults filled in. */
  readonly constraints: ResolvedConstraints;
  readonly volume: VolumeSettings;
  /** The event's days, as windows of event hours. One day for a short event. See `days.ts`. */
  readonly days: readonly Window[];
  private readonly dayBoundary: number;
  private readonly availableDays = new Map<string, number[]>();
  readonly poleByKey = new Map<string, Pole>();
  readonly shiftByKey = new Map<string, Shift>();
  readonly volunteerByKey = new Map<string, Volunteer>();
  readonly artistByKey = new Map<string, Artist>();
  readonly organiserByKey = new Map<string, Organiser>();
  /** Orgas standing in a créneau, by shift key, in plan order. */
  private readonly orgasByShift = new Map<string, Organiser[]>();
  private readonly shiftsByOrganiser = new Map<string, Shift[]>();

  /** Assignments whose two references both resolve. The rest are reported, then ignored. */
  readonly valid: Assignment[] = [];
  readonly broken: Assignment[] = [];
  readonly duplicates: Assignment[] = [];

  private readonly byVolunteer = new Map<string, Shift[]>();
  private readonly byShift = new Map<string, Volunteer[]>();
  private readonly windows = new Map<string, Window[]>();
  private readonly reserved: ReadonlySet<string>;
  private readonly leafKeys = new Set<string>();
  /** Roles by the pole they are held on, in plan order. A role whose organiser is gone is dropped. */
  private readonly rolesByPole = new Map<string, LeaderRole[]>();
  /** Short display labels, built on first use. See `labels()` at the bottom of the class. */
  private shortLabels: { volunteers: Map<string, string>; organisers: Map<string, string> } | null =
    null;

  constructor(plan: Plan) {
    this.plan = plan;
    this.rules = plan.rules;
    this.slots = plan.slots;
    this.preferenceSlots = plan.preferenceSlots;
    this.constraints = resolveConstraints(plan.constraints);
    this.volume = plan.volume ?? DEFAULT_VOLUME;
    this.dayBoundary = firstBoundary(plan.startISO, this.volume.dayStartHour);
    this.days = eventDays(plan.startISO, plan.lengthHours, this.volume.dayStartHour);
    this.reserved = new Set(plan.reserve);
    for (const p of plan.poles) this.poleByKey.set(p.key, p);
    for (const s of plan.shifts) this.shiftByKey.set(s.key, s);
    for (const v of plan.volunteers) this.volunteerByKey.set(v.key, v);
    for (const a of plan.artists) this.artistByKey.set(a.key, a);
    for (const l of plan.organisers) this.organiserByKey.set(l.key, l);

    /*
     * A role pointing at a organiser who is no longer there is skipped rather than reported. It is
     * not the same kind of thing as a broken assignment: nothing is scheduled here, nothing can
     * be lost, and the only consequence of a dangling role is a band on the grid with no name
     * under it. Deleting a organiser cuts their roles in `setupEdits`, so this is the belt to that
     * pair of braces, and it also covers a plan restored from an older version.
     */
    for (const role of plan.leaderRoles) {
      if (!this.organiserByKey.has(role.organiserKey)) continue;
      this.rolesByPole.set(role.poleKey, [...(this.rolesByPole.get(role.poleKey) ?? []), role]);
    }

    /*
     * An orga standing in a créneau. A row naming an orga or a shift that is not in the plan is
     * skipped rather than reported: nothing is scheduled here, so nothing can be lost, and the
     * only consequence is one name fewer on a box.
     */
    for (const row of plan.organiserShifts) {
      const organiser = this.organiserByKey.get(row.organiserKey);
      const shift = this.shiftByKey.get(row.shiftKey);
      if (!organiser || !shift) continue;
      this.orgasByShift.set(row.shiftKey, [...(this.orgasByShift.get(row.shiftKey) ?? []), organiser]);
      this.shiftsByOrganiser.set(
        row.organiserKey,
        [...(this.shiftsByOrganiser.get(row.organiserKey) ?? []), shift],
      );
    }

    for (const p of plan.poles) this.leafKeys.add(p.key);
    for (const p of plan.poles) if (p.parentKey) this.leafKeys.delete(p.parentKey);

    const seen = new Set<string>();
    for (const a of plan.assignments) {
      const volunteer = this.volunteerByKey.get(a.volunteerKey);
      const shift = this.shiftByKey.get(a.shiftKey);
      if (!volunteer || !shift) {
        this.broken.push(a);
        continue;
      }
      const pairKey = `${a.volunteerKey}|${a.shiftKey}`;
      if (seen.has(pairKey)) {
        this.duplicates.push(a);
        continue;
      }
      seen.add(pairKey);
      this.valid.push(a);
      this.byVolunteer.set(a.volunteerKey, [...(this.byVolunteer.get(a.volunteerKey) ?? []), shift]);
      this.byShift.set(a.shiftKey, [...(this.byShift.get(a.shiftKey) ?? []), volunteer]);
    }

    for (const v of plan.volunteers) {
      this.windows.set(
        v.key,
        // The refused tranches and, since 2026-09-15, the hours they are not there at all.
        usableWindows([...refusedWindows(plan.slots, v.refusedSlotIds), ...(v.unavailable ?? [])], plan.lengthHours),
      );
    }
  }

  /** True when volumes, floors and block counts are per day on this event. */
  get dayMode(): boolean {
    return this.volume.scope === 'day';
  }

  /** The day an hour of the event falls in, clamped to the event's days. */
  dayOf(hour: number): number {
    return Math.min(this.days.length - 1, Math.max(0, dayIndexAt(this.dayBoundary, hour)));
  }

  dayLabel(day: number): string {
    const window = this.days[day];
    return window ? dayLabel(this.plan.startISO, window) : `jour ${day + 1}`;
  }

  /** Hours per day of the event for these shifts, each shift counted whole on the day it starts. */
  hoursByDay(shifts: readonly Shift[]): number[] {
    const out = this.days.map(() => 0);
    for (const s of shifts) out[this.dayOf(s.start)]! += s.end - s.start;
    return out;
  }

  /**
   * The days this volunteer could be asked to work: those where their availability leaves at
   * least the floor, or their own volume when that is smaller. All of them on an event counted
   * as a whole, where the question does not arise. See `days.ts`.
   */
  availableDaysOf(volunteer: Volunteer): number[] {
    const cached = this.availableDays.get(volunteer.key);
    if (cached) return cached;
    const need = Math.min(volunteer.requestedHours, this.rules.minHoursPerPerson);
    const windows = this.windowsOf(volunteer.key);
    const days = this.days
      .map((day, i) => {
        let free = 0;
        for (const w of windows) free += Math.max(0, Math.min(w.end, day.end) - Math.max(w.start, day.start));
        return free + 1e-9 >= need ? i : -1;
      })
      .filter((i) => i >= 0);
    this.availableDays.set(volunteer.key, days);
    return days;
  }

  /** What the plan owes this volunteer in total: their volume, times their days in day mode. */
  requestedTotalOf(volunteer: Volunteer): number {
    return this.dayMode ? volunteer.requestedHours * this.availableDaysOf(volunteer).length : volunteer.requestedHours;
  }

  /** True when this volunteer is held in reserve, and so carries no shift on purpose. */
  isReserve(volunteerKey: string): boolean {
    return this.reserved.has(volunteerKey);
  }

  /** The orgas standing in this créneau, in plan order. */
  orgasOn(shiftKey: string): readonly Organiser[] {
    return this.orgasByShift.get(shiftKey) ?? [];
  }

  /** Every créneau of the exploit this orga was put in. Never counted against anything. */
  shiftsOfOrganiser(organiserKey: string): readonly Shift[] {
    return this.shiftsByOrganiser.get(organiserKey) ?? [];
  }

  /**
   * How many volunteers this créneau still asks for, orgas already standing in it taken out.
   *
   * THE ONE PLACE THE EXPLOIT KNOWS ORGAS EXIST. Every rule, the solver and the gap counts read
   * this rather than `shift.headcount`, so an orga put on the bar at 2h means the bar needs one
   * volunteer fewer there, and nothing else in the engine has to know why.
   *
   * Never negative: three orgas in a two-place créneau is a decision the régisseur took, and it
   * asks for nobody rather than for minus one.
   */
  headcountOf(shift: Shift): number {
    return Math.max(0, shift.headcount - this.orgasOn(shift.key).length);
  }

  /**
   * Orgas standing in two créneaux that overlap.
   *
   * Reported, never refused, like everything else in this tool: the régisseur is shown what they
   * did rather than stopped from doing it. This is the one rule an orga is still subject to, by
   * the decision of 2026-09-10, and it is the only one.
   */
  organiserClashes(): Array<{ organiser: Organiser; first: Shift; second: Shift }> {
    const found: Array<{ organiser: Organiser; first: Shift; second: Shift }> = [];
    for (const [organiserKey, shifts] of this.shiftsByOrganiser) {
      const organiser = this.organiserByKey.get(organiserKey);
      if (!organiser) continue;
      const sorted = [...shifts].sort((a, b) => a.start - b.start);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (overlaps(sorted[i]!, sorted[j]!)) {
            found.push({ organiser, first: sorted[i]!, second: sorted[j]! });
          }
        }
      }
    }
    return found;
  }

  /**
   * Responsables holding a créneau of a pole whose responsable is supposed to stay in support.
   *
   * ONE POLE, ONE ANSWER, and the answer is the pole's: see `Pole.leaderSupportOnly`. On a pole
   * where the two jobs fit into one pair of hands nothing is reported at all, which is the
   * default and was the whole of the behaviour before 2026-09-12.
   *
   * THE ROLE'S OWN HOURS NARROW IT. Somebody responsable of the bar from 14h to 18h who works a
   * créneau there at 22h is not doing two jobs at once, so that is not a breach: they are simply
   * a volunteer of the bar that evening. A role with no hours set covers the whole event, since
   * that is what an unset window means everywhere else it is read.
   *
   * REPORTED AND NEVER REFUSED, like `organiserClashes` beside it. `validate.ts` does not read
   * this and the solver cannot produce it: only the régisseur can, by hand, and they may have
   * meant it.
   */
  supportOnlyBreaches(): Array<{ organiser: Organiser; pole: Pole; shift: Shift; role: LeaderRole }> {
    const found: Array<{ organiser: Organiser; pole: Pole; shift: Shift; role: LeaderRole }> = [];
    for (const role of this.plan.leaderRoles) {
      const pole = this.poleByKey.get(role.poleKey);
      if (!pole || pole.leaderSupportOnly !== true) continue;
      const organiser = this.organiserByKey.get(role.organiserKey);
      if (!organiser) continue;

      for (const held of this.plan.organiserShifts) {
        if (held.organiserKey !== role.organiserKey) continue;
        const shift = this.shiftByKey.get(held.shiftKey);
        // The pole itself, or anything under it: a responsable of the bar covers its sub-poles.
        if (!shift || !this.isUnder(shift.poleKey, pole.key)) continue;
        const covered =
          role.start === null || role.end === null
            ? true
            : overlaps(shift, { start: role.start, end: role.end });
        if (covered) found.push({ organiser, pole, shift, role });
      }
    }
    return found;
  }

  isLeaf(poleKey: string): boolean {
    return this.leafKeys.has(poleKey);
  }

  /** The competences a pole needs, its own and every parent's, in first-seen order. */
  requiredSkillsOf(poleKey: string): readonly string[] {
    const out: string[] = [];
    let current = this.poleByKey.get(poleKey);
    while (current) {
      for (const k of current.requiredSkills ?? []) if (!out.includes(k)) out.push(k);
      current = current.parentKey ? this.poleByKey.get(current.parentKey) : undefined;
    }
    return out;
  }

  /** The competences this pole needs that this person does not hold. Empty when none. */
  missingSkillsOf(volunteer: Volunteer, poleKey: string): readonly string[] {
    const needed = this.requiredSkillsOf(poleKey);
    if (needed.length === 0) return needed;
    const held = volunteer.skills ?? [];
    return needed.filter((k) => !held.includes(k));
  }

  skillLabel(key: string): string {
    return this.plan.skills?.find((s) => s.key === key)?.label ?? key;
  }

  /** True when `poleKey` is `rootKey` or sits anywhere under it. A veto covers the subtree. */
  isUnder(poleKey: string, rootKey: string): boolean {
    let current = this.poleByKey.get(poleKey);
    while (current) {
      if (current.key === rootKey) return true;
      current = current.parentKey ? this.poleByKey.get(current.parentKey) : undefined;
    }
    return false;
  }

  /**
   * Who runs this pole, with the window each of them holds it for.
   *
   * One person can appear twice, holding two windows on the same pole, and two people can hold
   * windows that overlap. Both are legitimate answers rather than mistakes, so nothing here
   * merges or dedupes: the caller draws what it is given.
   */
  leadersOn(poleKey: string): readonly LeaderOnPole[] {
    return (this.rolesByPole.get(poleKey) ?? []).map((role) => ({
      organiser: this.organiserByKey.get(role.organiserKey)!,
      role,
    }));
  }

  /** Every pole this person runs, in plan order. */
  polesLedBy(organiserKey: string): readonly LeaderRole[] {
    return this.plan.leaderRoles.filter((r) => r.organiserKey === organiserKey);
  }

  polePath(poleKey: string): string {
    return this.poleByKey.get(poleKey)?.path ?? poleKey;
  }

  shiftsOf(volunteerKey: string): readonly Shift[] {
    return this.byVolunteer.get(volunteerKey) ?? [];
  }

  assigneesOf(shiftKey: string): readonly Volunteer[] {
    return this.byShift.get(shiftKey) ?? [];
  }

  assigneeCount(shiftKey: string): number {
    return this.byShift.get(shiftKey)?.length ?? 0;
  }

  windowsOf(volunteerKey: string): readonly Window[] {
    return this.windows.get(volunteerKey) ?? [];
  }

  hoursOf(volunteerKey: string): number {
    return this.shiftsOf(volunteerKey).reduce((total, s) => total + (s.end - s.start), 0);
  }

  blocksOf(volunteerKey: string): Block[] {
    return buildBlocks(this.shiftsOf(volunteerKey));
  }

  /**
   * The level a volunteer declared for this pole, or null when they never declared one.
   *
   * A volunteer only states a level for the poles they chose. Placed anywhere else, their
   * experience there is unknown, and the experience rules treat unknown as inexperienced:
   * there is no evidence to the contrary, and this is a safety rule. The exact pole wins over a
   * parent, so a level given for "Bar / Service" is not overruled by one given for "Bar".
   */
  levelIn(volunteer: Volunteer, poleKey: string): SkillLevel | null {
    const exact = volunteer.choices.find((c) => c.poleKey === poleKey);
    if (exact) return exact.level;
    return this.matchingChoice(volunteer, poleKey)?.level ?? null;
  }

  /**
   * Where this placement falls in the volunteer's choices: the position of the first choice it
   * honours (0 is the first), or null when it honours none of them.
   *
   * The POSITION, whatever the event says about order: `rankOf` is the question with the
   * setting applied.
   */
  choiceIndexOf(volunteer: Volunteer, poleKey: string): number | null {
    const at = volunteer.choices.findIndex((c) => c.poleKey !== '' && this.isUnder(poleKey, c.poleKey));
    return at < 0 ? null : at;
  }

  /**
   * The rank this placement costs as, with the event's setting applied: the position in a ranked
   * list, 0 for every choice in an unranked one, null outside all of them.
   */
  rankOf(volunteer: Volunteer, poleKey: string): number | null {
    // The pole a responsable sent them to is their first choice, whatever the form said.
    if (volunteer.imposedPoleKey && this.isUnder(poleKey, volunteer.imposedPoleKey)) return 0;
    const at = this.choiceIndexOf(volunteer, poleKey);
    return at === null ? null : this.plan.poleChoicesRanked === false ? 0 : at;
  }

  private matchingChoice(volunteer: Volunteer, poleKey: string): PoleChoice | null {
    const at = this.choiceIndexOf(volunteer, poleKey);
    return at === null ? null : volunteer.choices[at]!;
  }

  /** The artists this volunteer asked not to miss whose set overlaps the given window. */
  artistsClashing(volunteer: Volunteer, window: Window): Artist[] {
    return volunteer.artistKeys
      .map((k) => this.artistByKey.get(k))
      .filter((a): a is Artist => a !== undefined && overlaps(a, window));
  }

  label(hours: number): string {
    return toLabel(this.plan.startISO, hours);
  }

  /** "Bar / Service, 13/03 22:00 -> 14/03 00:00", the way a shift is named in a message. */
  shiftLabel(shift: Shift): string {
    return `${this.polePath(shift.poleKey)}, ${this.label(shift.start)} -> ${this.label(shift.end)}`;
  }

  volunteerName(volunteerKey: string): string {
    const v = this.volunteerByKey.get(volunteerKey);
    return v ? `${v.firstName} ${v.lastName}` : volunteerKey;
  }

  /**
   * The label a person is drawn under where the whole name does not fit: their nickname or first
   * name, then as much of the surname as it takes to tell them apart. See `display.ts`.
   *
   * Computed once for volunteers and organisers together, because they are named on the same
   * screens and one label has to mean one human. Built on first use rather than in the
   * constructor: most of what builds a PlanIndex never draws anything.
   */
  private labels(): { volunteers: Map<string, string>; organisers: Map<string, string> } {
    if (this.shortLabels) return this.shortLabels;
    const people = [...this.plan.volunteers, ...this.plan.organisers];
    const labels = shortNames(people);
    const volunteers = new Map<string, string>();
    const organisers = new Map<string, string>();
    this.plan.volunteers.forEach((v, i) => volunteers.set(v.key, labels[i] ?? ''));
    this.plan.organisers.forEach((l, i) =>
      organisers.set(l.key, labels[this.plan.volunteers.length + i] ?? ''),
    );
    this.shortLabels = { volunteers, organisers };
    return this.shortLabels;
  }

  volunteerShortName(volunteerKey: string): string {
    return this.labels().volunteers.get(volunteerKey) ?? volunteerKey;
  }

  organiserShortName(organiserKey: string): string {
    return this.labels().organisers.get(organiserKey) ?? organiserKey;
  }
}

/**
 * A NEW EVENT, neutral, since 2026-09-14.
 *
 * Until then a new planning was an empty object run through the normaliser, which fills every
 * missing field with the Loto Tekno's: the 13 March 2027 at noon, eighteen hours, three refusable
 * tranches of six hours and the two preference tranches « Loto » and « Concerts ». Right for a plan
 * written before a field existed, which is what the normaliser is for; wrong for an event nobody
 * has described yet, which then opened already speaking of a loto.
 *
 * What stays is what any event needs to be usable at once and is not about any one event: the
 * scheduling thresholds and the criteria (Réglages avancés), the volume options and a day that
 * changes at noon, the catering switched off. What goes is everything that names a moment of an
 * event: no tranche of either kind, no pole, no line-up. The start is the next full day at noon,
 * the length twelve hours, both for the régisseur to change first.
 */
export function newEventPlan(name: string, now: Date = new Date()): Plan {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0);
  const startISO = start.toISOString();
  return emptyPlan({
    name,
    startISO,
    lengthHours: 12,
    address: '',
    sheetUrl: '',
    rules: { ...DEFAULT_RULES },
    slots: [],
    preferenceSlots: [],
    poles: [],
    shifts: [],
    artists: [],
    volunteers: [],
  });
}

/**
 * The plan with both phases' derived edges written from the event. See `alignPhase`.
 *
 * Run by every writer that moves the event or a phase, and once on load, so that "the montage
 * ends when the event starts" is true of every plan a screen ever sees rather than a rule each
 * screen re-derives. Returns the same plan when nothing needs changing.
 */
export function alignPhases(plan: Plan): Plan {
  const montage = alignPhase(plan.montage, plan.startISO, plan.lengthHours);
  const demontage = alignPhase(plan.demontage, plan.startISO, plan.lengthHours);
  return montage === plan.montage && demontage === plan.demontage
    ? plan
    : { ...plan, montage, demontage };
}

/** A plan with no assignments yet. The starting point for the solver and for the fixtures. */
export function emptyPlan(
  parts: Omit<
    Plan,
    | 'assignments'
    | 'buddies'
    | 'reserve'
    | 'organisers'
    | 'leaderRoles'
    | 'organiserShifts'
    | 'montage'
    | 'demontage'
    | 'catering'
    | 'ticketing'
    | 'travel'
    | 'constraints'
    | 'poleChoicesRanked'
    | 'volume'
    | 'formMapping'
    | 'dismissedBuddies'
    | 'applicationSteps'
    | 'skills'
    | 'teamsEnabled'
    | 'teams'
    | 'sideActivities'
    | 'equipment'
    | 'defaultShiftHours'
  > & {
    buddies?: readonly BuddyPair[];
    organisers?: readonly Organiser[];
    leaderRoles?: readonly LeaderRole[];
    montage?: Phase;
    demontage?: Phase;
  },
): Plan {
  return {
    ...parts,
    buddies: parts.buddies ?? [],
    dismissedBuddies: [],
    organisers: parts.organisers ?? [],
    leaderRoles: parts.leaderRoles ?? [],
    assignments: [],
    reserve: [],
    organiserShifts: [],
    // Both off, the montage over the two days before the event and the démontage over the two
    // days after it. A plan with no phases configured is the normal state of every plan built
    // before they existed, and of every new one.
    montage: parts.montage ?? defaultPhase('montage', defaultPhaseStart('montage', parts.startISO, parts.lengthHours)),
    demontage: parts.demontage ?? defaultPhase('demontage', defaultPhaseStart('demontage', parts.startISO, parts.lengthHours)),
    // Off, with the Loto Tekno figures already in it. Same doctrine as the two phases.
    catering: DEFAULT_CATERING,
    ticketing: DEFAULT_TICKETING,
    travel: DEFAULT_TRAVEL_RATES,
    constraints: DEFAULT_CONSTRAINTS,
    poleChoicesRanked: true,
    volume: DEFAULT_VOLUME,
    formMapping: EMPTY_FORM_MAPPING,
    applicationSteps: DEFAULT_APPLICATION_STEPS,
    skills: [],
    teamsEnabled: false,
    teams: [],
    sideActivities: [],
    equipment: [],
    defaultShiftHours: 2,
  };
}
