/**
 * Making a plan from outside safe to render.
 *
 * A plan that has been sitting in storage was written by an older version of this code, and the
 * shape has moved since. `Plan.organisers` was added on 2026-09-07, and every plan saved before
 * that lacks it: the settings screen read `plan.organisers.length`, threw, and took the entire app
 * down with it, nav included. A blank page, from one missing array.
 *
 * So everything crossing the persistence boundary comes through here first. The stores call it,
 * and the one that talks to Supabase will call it too.
 *
 * WRITTEN OUT FIELD BY FIELD ON PURPOSE. A spread with a couple of fallbacks would compile
 * happily the next time a field is added to `Plan`, and the next régisseur would meet the same
 * blank page. Naming every field means adding one to the type puts a compile error right here,
 * which is the only reliable reminder.
 */

import {
  APPLICATION_STATUSES,
  DEFAULT_APPLICATION_STEPS,
  ENERGY_PROFILES,
  type ApplicationStatus,
  type ApplicationStep,
  type EnergyProfile,
  CRITERIA,
  DEFAULT_CONSTRAINTS,
  type PoleChoice,
  type SkillLevel,
  DEFAULT_VOLUME,
  type VolumeSettings,
  MAPPED_FIELDS,
  type FormMapping,
  type ConstraintSettings,
  type CriterionOverride,
  DEFAULT_CATERING,
  DEFAULT_TICKETING,
  DEFAULT_TRAVEL_RATES,
  PERSON_STATUS_LABEL,
  makeArtist,
  makeArtistMember,
  makeCarTrip,
  type Artist,
  type ArtistMember,
  type CarTrip,
  type Guest,
  type MealPersonKind,
  type PersonStatus,
  type TicketPersonKind,
  type TicketingSettings,
  type TravelRates,
  type FuelKind,
  DEFAULT_PREFERENCE_SLOTS,
  DEFAULT_RULES,
  DEFAULT_SLOTS,
  alignPhases,
  defaultPhaseStart,
  EDITABLE_FIELDS,
  absentFromPhase,
  defaultPhase,
  GENERAL_POLE_KEY,
  generalPole,
  type Phase,
  type PhaseAssignment,
  type PhaseEvent,
  type PhaseId,
  type PhasePole,
  type PhasePresence,
  type OrganiserShift,
  type PersonKind,
  type Window,
  type CateringSettings,
  type EditableField,
  type PreferenceSlot,
  type MealChoice,
  type MealTier,
  type MealWindow,
  type Organiser,
  type LeaderRole,
  type BuddyPair,
  type Plan,
  type Volunteer,
} from '../engine.ts';

/** Whatever JSON came back. Assuming it is a `Plan` is what caused the bug in the first place. */
type Loose = Partial<Record<keyof Plan, unknown>>;

const array = <T,>(value: unknown): readonly T[] => (Array.isArray(value) ? (value as T[]) : []);

const hours = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const text = (field: unknown): string => (typeof field === 'string' ? field : '');

/**
 * Organisers are normalised element by element, not just as an array.
 *
 * The same failure one level down: `start` and `end` were added after organisers themselves, so a
 * organiser saved in between has neither, and `undefined` is not `null`. A window of `undefined` to
 * `undefined` would draw a band on the grid at NaN pixels rather than no band at all.
 */
const keys = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : [];

const organiser = (value: unknown): Organiser => {
  const loose = (value ?? {}) as Partial<Record<keyof Organiser, unknown>>;
  return {
    key: text(loose.key),
    firstName: text(loose.firstName),
    lastName: text(loose.lastName),
    email: text(loose.email),
    phone: text(loose.phone),
    accessCode: text(loose.accessCode),
    diet: text(loose.diet),
    allergies: text(loose.allergies),
    note: text(loose.note),
    // Absent from anything written before 2026-09-10. Null is the right answer for both: an
    // orga who has not told us when they arrive is not on site, and inventing a presence here
    // would draw somebody on a montage they never said they were coming to.
    montageFrom: hours(loose.montageFrom),
    demontageUntil: hours(loose.demontageUntil),
    montagePoleKeys: keys(loose.montagePoleKeys),
    demontagePoleKeys: keys(loose.demontagePoleKeys),
  };
};

/** A window, or nothing. A half-written one is nothing: NaN pixels are worse than no box. */
const window = (value: unknown): Window | null => {
  const loose = (value ?? {}) as Record<string, unknown>;
  const start = hours(loose.start);
  const end = hours(loose.end);
  return start === null || end === null || end <= start ? null : { start, end };
};

/**
 * A bénévole's answer about one phase.
 *
 * `present` false with a sentence still in it is a legitimate state: the importer read a refusal
 * out of prose, and the sentence is what lets the régisseur see whether it read it right.
 */
const presence = (value: unknown): PhasePresence => {
  const loose = (value ?? {}) as Record<string, unknown>;
  return {
    present: loose.present === true,
    note: text(loose.note),
    windows: (Array.isArray(loose.windows) ? loose.windows : [])
      .map(window)
      .filter((w): w is Window => w !== null),
  };
};

const organiserShift = (value: unknown): OrganiserShift => {
  const loose = (value ?? {}) as Record<string, unknown>;
  return {
    key: text(loose.key),
    organiserKey: text(loose.organiserKey),
    shiftKey: text(loose.shiftKey),
  };
};

const phasePole = (value: unknown): PhasePole => {
  const loose = (value ?? {}) as Record<string, unknown>;
  const colour = text(loose.colour);
  return {
    key: text(loose.key),
    name: text(loose.name),
    ...(colour === '' ? {} : { colour }),
  };
};

const phaseEvent = (value: unknown): PhaseEvent => {
  const loose = (value ?? {}) as Record<string, unknown>;
  return {
    key: text(loose.key),
    label: text(loose.label),
    start: hours(loose.start) ?? 0,
    end: hours(loose.end) ?? 0,
    headcount: Math.max(0, Math.round(hours(loose.headcount) ?? 0)),
  };
};

const phaseAssignment = (value: unknown): PhaseAssignment => {
  const loose = (value ?? {}) as Record<string, unknown>;
  return {
    key: text(loose.key),
    personKind: loose.personKind === 'benevole' ? 'benevole' : ('orga' as PersonKind),
    personKey: text(loose.personKey),
    poleKey: text(loose.poleKey),
    eventKey: text(loose.eventKey),
    start: hours(loose.start) ?? 0,
    end: hours(loose.end) ?? 0,
  };
};

/**
 * A whole phase, over the defaults it would have had if it had never been saved.
 *
 * GÉNÉRAL IS PUT BACK IF IT IS MISSING, always, and first in the list. It is where everybody on
 * site with nothing decided for them is drawn, so a phase without it would silently stop showing
 * a good half of the people who said they were coming.
 */
const phase = (
  value: unknown,
  id: PhaseId,
  eventStartISO: string,
  eventLengthHours: number,
): Phase => {
  const fallback = defaultPhase(id, defaultPhaseStart(id, eventStartISO, eventLengthHours));
  const loose = (value ?? {}) as Record<string, unknown>;
  if (Object.keys(loose).length === 0) return fallback;

  const poles = (Array.isArray(loose.poles) ? loose.poles : [])
    .map(phasePole)
    .filter((p) => p.key !== '');
  const length = hours(loose.lengthHours);

  return {
    id,
    enabled: loose.enabled === true,
    label: text(loose.label) || fallback.label,
    startISO: text(loose.startISO) || fallback.startISO,
    lengthHours: length !== null && length > 0 ? length : fallback.lengthHours,
    offStartHour: hours(loose.offStartHour) ?? fallback.offStartHour,
    offEndHour: hours(loose.offEndHour) ?? fallback.offEndHour,
    dayPartSplitHour: hours(loose.dayPartSplitHour) ?? fallback.dayPartSplitHour,
    volunteersAllowed: loose.volunteersAllowed === true,
    volunteersFrom: hours(loose.volunteersFrom) ?? 0,
    volunteersUntil: hours(loose.volunteersUntil) ?? fallback.lengthHours,
    poles: poles.some((p) => p.key === GENERAL_POLE_KEY) ? poles : [generalPole(), ...poles],
    events: (Array.isArray(loose.events) ? loose.events : [])
      .map(phaseEvent)
      .filter((e) => e.key !== ''),
    assignments: (Array.isArray(loose.assignments) ? loose.assignments : [])
      .map(phaseAssignment)
      .filter((a) => a.key !== '' && a.personKey !== ''),
  };
};

/**
 * The catering, over the defaults it would have had if it had never been saved.
 *
 * WRITTEN OUT RULE BY RULE, like everything else here. A plan from before 2026-09-12 has no
 * catering key at all and takes the defaults whole; one written since keeps every figure it
 * carries and picks up a default only for a rule it has never heard of.
 *
 * A SERVICE WITH NO KEY IS DROPPED, and a tier with no hours is not. The first is a row nothing
 * can point at: a ticked box is stored against `day|key`, so a service whose key is empty could
 * never be ticked, unticked or told apart from another one. A tier is anonymous by nature and
 * "à partir de 0 h" is a legitimate rule, so it is kept as written.
 */
const mealWindow = (value: unknown): MealWindow => {
  const loose = (value ?? {}) as Record<string, unknown>;
  return {
    key: text(loose.key),
    label: text(loose.label),
    fromHour: hours(loose.fromHour) ?? 0,
    toHour: hours(loose.toHour) ?? 0,
  };
};

const mealTier = (value: unknown): MealTier => {
  const loose = (value ?? {}) as Record<string, unknown>;
  return {
    fromHours: Math.max(0, hours(loose.fromHours) ?? 0),
    meals: Math.max(0, Math.round(hours(loose.meals) ?? 0)),
  };
};

const mealChoice = (value: unknown): MealChoice => {
  const loose = (value ?? {}) as Record<string, unknown>;
  return {
    personKind:
      loose.personKind === 'orga' || loose.personKind === 'artiste'
        ? (loose.personKind as MealPersonKind)
        : ('benevole' as PersonKind),
    personKey: text(loose.personKey),
    serviceKey: text(loose.serviceKey),
    takes: loose.takes === true,
  };
};

const catering = (value: unknown): CateringSettings => {
  const loose = (value ?? {}) as Record<string, unknown>;
  if (Object.keys(loose).length === 0) return DEFAULT_CATERING;
  const rules = (loose.rules ?? {}) as Record<string, unknown>;
  const services = (Array.isArray(rules.services) ? rules.services : [])
    .map(mealWindow)
    .filter((w) => w.key !== '');

  return {
    rules: {
      enabled: rules.enabled === true,
      // An empty list is a legitimate answer for the tiers, and an event that feeds nobody by
      // the hour is one of them. It is NOT a legitimate answer for the services: a catering
      // switched on with no service at all would show an empty screen with nothing saying why,
      // so the two default services come back instead.
      services: services.length > 0 ? services : DEFAULT_CATERING.rules.services,
      exploitTiers: (Array.isArray(rules.exploitTiers) ? rules.exploitTiers : []).map(mealTier),
      drinkPerHours: Math.max(0, hours(rules.drinkPerHours) ?? DEFAULT_CATERING.rules.drinkPerHours),
      drinkCountsPhases: rules.drinkCountsPhases === true,
      organiserMeals: Math.max(0, Math.round(hours(rules.organiserMeals) ?? 0)),
      organiserDrinks: Math.max(0, Math.round(hours(rules.organiserDrinks) ?? 0)),
      // Absent from anything written before 2026-09-13, and the event's figure then.
      artistDrinks: Math.max(
        0,
        Math.round(hours(rules.artistDrinks) ?? DEFAULT_CATERING.rules.artistDrinks),
      ),
      artistDrinksCumulative: rules.artistDrinksCumulative === true,
    },
    choices: (Array.isArray(loose.choices) ? loose.choices : [])
      .map(mealChoice)
      .filter((c) => c.personKey !== '' && c.serviceKey !== ''),
  };
};

/**
 * An act, over the defaults of an act nobody has filled in.
 *
 * Every plan written before 2026-09-13 carries `{key, name, start, end}` and nothing else, and
 * `makeArtist` is what gives those four the rest. A member or a trajet with no key is a row
 * nothing can point at (a meal choice names a member by key), so it is dropped rather than kept.
 */
const count = (value: unknown, fallback = 0): number =>
  Math.max(0, Math.round(hours(value) ?? fallback));

/** A named invitation. One with no key is dropped: a ticket or a bracelet points at it by key. */
const guest = (value: unknown): Guest => {
  const loose = (value ?? {}) as Record<string, unknown>;
  return { key: text(loose.key), firstName: text(loose.firstName), lastName: text(loose.lastName) };
};

const guests = (value: unknown): Guest[] =>
  array<unknown>(value).map(guest).filter((g) => g.key !== '');

const artistMember = (value: unknown): ArtistMember => {
  const loose = (value ?? {}) as Record<string, unknown>;
  return makeArtistMember({
    key: text(loose.key),
    firstName: text(loose.firstName),
    lastName: text(loose.lastName),
    role: loose.role === 'technicien' ? 'technicien' : 'musicien',
    diet: text(loose.diet),
    allergies: text(loose.allergies),
    // Null is "follow the event's figure" and is kept as null, never turned into a zero.
    drinkTickets: hours(loose.drinkTickets) === null ? null : count(loose.drinkTickets),
    payment:
      loose.payment === 'facture' || loose.payment === 'declare' ? loose.payment : 'cash',
    // Names since 2026-09-13; `invited` before that, a tick that named nobody, is dropped.
    guests: guests(loose.guests),
    // Absent before the link existed; a kind without a key, or the reverse, is no link.
    linkedKind:
      (loose.linkedKind === 'orga' || loose.linkedKind === 'benevole') && text(loose.linkedKey) !== ''
        ? loose.linkedKind
        : null,
    linkedKey:
      loose.linkedKind === 'orga' || loose.linkedKind === 'benevole' ? text(loose.linkedKey) : '',
  });
};

const carTrip = (value: unknown): CarTrip => {
  const loose = (value ?? {}) as Record<string, unknown>;
  const fuel = loose.fuel;
  return makeCarTrip({
    key: text(loose.key),
    fromAddress: text(loose.fromAddress),
    fromVenue: loose.fromVenue === true,
    toAddress: text(loose.toAddress),
    toVenue: loose.toVenue !== false,
    fuel:
      fuel === 'diesel' || fuel === 'electrique' || fuel === 'gpl' || fuel === 'autre'
        ? fuel
        : 'essence',
    consumptionPer100: Math.max(0, hours(loose.consumptionPer100) ?? 0),
    tolls: loose.tolls !== false,
    // Null until computed or typed; a stored figure comes back as it was.
    distanceKm: hours(loose.distanceKm),
    cost: hours(loose.cost),
  });
};

const artist = (value: unknown): Artist => {
  const loose = (value ?? {}) as Record<string, unknown>;
  const start = hours(loose.start) ?? 0;
  const end = hours(loose.end) ?? start;
  const given = makeArtist({ key: text(loose.key), name: text(loose.name), start, end });
  return {
    ...given,
    size: count(loose.size, given.size),
    changeoverBefore: Math.max(0, hours(loose.changeoverBefore) ?? 0),
    changeoverAfter: Math.max(0, hours(loose.changeoverAfter) ?? 0),
    trainTickets: count(loose.trainTickets),
    trainDone: loose.trainDone === true,
    trainCost: Math.max(0, hours(loose.trainCost) ?? 0),
    planeTickets: count(loose.planeTickets),
    planeDone: loose.planeDone === true,
    planeCost: Math.max(0, hours(loose.planeCost) ?? 0),
    contactPhone: text(loose.contactPhone),
    carTrips: array<unknown>(loose.carTrips).map(carTrip).filter((t) => t.key !== ''),
    technicalNeeds: text(loose.technicalNeeds),
    patchSize: count(loose.patchSize),
    notes: text(loose.notes),
    soundcheckNeeded: loose.soundcheckNeeded === true,
    soundcheckStart: hours(loose.soundcheckStart) ?? given.soundcheckStart,
    soundcheckEnd: hours(loose.soundcheckEnd) ?? given.soundcheckEnd,
    soundcheckEngineer: loose.soundcheckEngineer === true,
    members: array<unknown>(loose.members).map(artistMember).filter((m) => m.key !== ''),
    extraGuests: guests(loose.extraGuests),
  };
};

const leaderRole = (value: unknown): LeaderRole => {
  const loose = (value ?? {}) as Partial<Record<keyof LeaderRole, unknown>>;
  return {
    key: text(loose.key),
    organiserKey: text(loose.organiserKey),
    poleKey: text(loose.poleKey),
    start: hours(loose.start),
    end: hours(loose.end),
  };
};

/** The shape `Plan.organisers` had under PLAN_FORMAT 1: one row per person per pole. */
type OrganiserV1 = {
  key?: unknown;
  poleKey?: unknown;
  fullName?: unknown;
  phone?: unknown;
  email?: unknown;
  note?: unknown;
  start?: unknown;
  end?: unknown;
};

/**
 * A format 1 organiser list, split into people and roles.
 *
 * The same conversion the SQL migration performs, and it has to live here too: a plan restored
 * from a version written before 2026-09-09 arrives in this browser in the old shape, and the
 * database is not consulted on the way.
 *
 * TWO ROWS ARE THE SAME PERSON WHEN THEY SHARE AN EMAIL, and otherwise when they share a name.
 * The address first because it is the identifier the organisers' form will key on, the name second
 * because organisers were typed in by hand for a month and most carry no address at all. Getting
 * this wrong in the safe direction means one person listed twice, which the régisseur sees and
 * merges; getting it wrong the other way would silently give one person somebody else's poles.
 *
 * THE NAME IS NOT SPLIT. `fullName` goes to `lastName` whole and `firstName` stays empty, so
 * everything still displays exactly the string that was typed. Guessing where a first name ends
 * is wrong for every particle, every compound surname and every person with two given names, and
 * a wrong guess here is somebody's name spelled wrong on the night. The organisers' form supplies
 * the two fields properly, and Réglages lets the régisseur fix the handful that predate it.
 */
function splitLegacyOrganisers(rows: readonly OrganiserV1[]): {
  organisers: Organiser[];
  leaderRoles: LeaderRole[];
} {
  const organisers: Organiser[] = [];
  const leaderRoles: LeaderRole[] = [];
  const byIdentity = new Map<string, Organiser>();

  for (const row of rows) {
    const fullName = text(row.fullName);
    const email = text(row.email);
    const identity = email.trim() !== '' ? `mail:${email.trim().toLowerCase()}` : `nom:${fullName.trim().toLowerCase()}`;

    let person = byIdentity.get(identity);
    if (!person) {
      person = {
        // Prefixed so it can never collide with a role key, which is the old row's key kept
        // as it was.
        key: `resp-${organisers.length + 1}`,
        firstName: '',
        lastName: fullName,
        email,
        phone: text(row.phone),
        // Deliberately empty. A code is a credential; inventing one here would hand out access
        // to a plan simply by opening it. The régisseur generates them, once, on purpose.
        accessCode: '',
        diet: '',
        allergies: '',
        note: text(row.note),
        montageFrom: null,
        demontageUntil: null,
        montagePoleKeys: [],
        demontagePoleKeys: [],
      };
      byIdentity.set(identity, person);
      organisers.push(person);
    }

    leaderRoles.push({
      key: text(row.key),
      organiserKey: person.key,
      poleKey: text(row.poleKey),
      start: hours(row.start),
      end: hours(row.end),
    });
  }

  return { organisers, leaderRoles };
}

/**
 * Volunteers, field by field, because two of their fields were renamed on 2026-09-08.
 *
 * THIS IS A ONE-WAY TRANSLATION OF ANSWERS PEOPLE ALREADY GAVE, so it is the one place in the
 * app allowed to read the old names. `half` became `halfPreference` when it stopped being a
 * hard rule, and `refusedPoleKey` became `refusedPoleKeys` when the form turned out to ask the
 * question with checkboxes. A plan saved before that carries the old shape, and without this it
 * would load with an undefined preference and no refusals at all: every veto silently gone,
 * which is precisely the failure this project must never produce.
 *
 * The old singular key is carried across rather than dropped. Somebody wrote it down.
 */
const volunteer = (value: unknown): Volunteer => {
  const loose = (value ?? {}) as Record<string, unknown>;
  const text = (field: unknown): string => (typeof field === 'string' ? field : '');

  /*
   * Three shapes of the same answer. `preferredSlotId` is the one since 2026-09-13, a slot id or
   * null; before that `halfPreference`, and before 2026-09-08 `half`, both one of two words. The
   * two words are carried onto the ids of the two default preference tranches, which is what a
   * plan without `preferenceSlots` opens with, so "plutôt le loto" still means the loto.
   */
  const preference = loose.preferredSlotId ?? loose.halfPreference ?? loose.half;
  const preferredSlotId: string | null =
    preference === 'afternoon'
      ? 'loto'
      : preference === 'evening'
        ? 'concerts'
        : typeof preference === 'string' && preference !== '' && preference !== 'any'
          ? preference
          : null;

  const refusedPoleKeys = Array.isArray(loose.refusedPoleKeys)
    ? (loose.refusedPoleKeys as unknown[]).filter((k): k is string => typeof k === 'string')
    : typeof loose.refusedPoleKey === 'string' && loose.refusedPoleKey !== ''
      ? [loose.refusedPoleKey]
      : [];

  /*
   * PLAN_FORMAT 3 to 4, 2026-09-10: one refused slot became a list of them.
   *
   * Read off the rows rather than off the format number, like the organisers above and for the
   * same reason: the number is exactly what an older writer would have got wrong. A format 3
   * plan carries `refusedSlot`, a single id or null; a format 4 plan carries the list. One id
   * becomes a list of one, which is the same answer, so nothing is lost and nothing is guessed.
   */
  const refusedSlotIds = Array.isArray(loose.refusedSlotIds)
    ? (loose.refusedSlotIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : typeof loose.refusedSlot === 'string' && loose.refusedSlot !== ''
      ? [loose.refusedSlot]
      : [];

  const hours = loose.requestedHours;
  return {
    key: text(loose.key),
    firstName: text(loose.firstName),
    lastName: text(loose.lastName),
    // Absent from anything written before 2026-09-09, and an unanswered surname question is
    // empty anyway, so the two cases are the same string and neither needs telling apart.
    nickname: text(loose.nickname),
    email: text(loose.email),
    phone: text(loose.phone),
    accessCode: text(loose.accessCode),
    // Absent from anything written before 2026-09-12. An unanswered question is empty anyway,
    // so the two cases are the same string and neither needs telling apart; a re-import of the
    // same export is what fills them in for everybody already in the plan.
    diet: text(loose.diet),
    allergies: text(loose.allergies),
    // Any positive figure since 2026-09-14; before, only 4, 6 or 8 were written, and those pass.
    requestedHours: typeof hours === 'number' && Number.isFinite(hours) && hours > 0 ? hours : 4,
    preferredSlotId,
    refusedSlotIds,
    // Absent from anything written before 2026-09-10, when the question was a radio button
    // and a plan had no sentence to keep. An empty note beside a slot id is exactly what a
    // pre-2026-09-10 answer was, so nothing is invented here.
    availabilityNote: text(loose.availabilityNote),
    refusedPoleKeys,
    choices: choices(loose),
    artistKeys: array<string>(loose.artistKeys) as string[],
    buddyRawNames: array<string>(loose.buddyRawNames) as string[],
    // A plan written before the fiches could be corrected has no corrections and nothing to
    // review: the parsers that raise a doubt did not exist when it was written.
    // The four corrections of a single choice became one on the whole list on 2026-09-14: a
    // fiche whose choice 2 was corrected by hand keeps its choices protected from a re-import.
    manualFields: [
      ...new Set(
        array<string>(loose.manualFields)
          .map((field) => (/^choice[12](PoleKey|Level)$/.test(field) ? 'choices' : field))
          .filter((field): field is EditableField => (EDITABLE_FIELDS as readonly string[]).includes(field)),
      ),
    ],
    needsReview: loose.needsReview === true,
    reviewReasons: array<string>(loose.reviewReasons) as string[],
    // Absent from anything written before 2026-09-10. Nobody is on a phase they never answered
    // about, which is the same doctrine as the organiser's arrival above.
    montage: loose.montage === undefined ? absentFromPhase() : presence(loose.montage),
    demontage: loose.demontage === undefined ? absentFromPhase() : presence(loose.demontage),
    // Absent from anything written before 2026-09-15, when nobody was entered by hand.
    enteredByHand: loose.enteredByHand === true,
    // Absent from anything written before 2026-09-15: a candidature nobody has decided yet, nothing
    // ticked, no note, no stamina answer, not in the Réserve.
    status: (APPLICATION_STATUSES as readonly unknown[]).includes(loose.status)
      ? (loose.status as ApplicationStatus)
      : 'candidature',
    statusSteps: keys(loose.statusSteps),
    regieNote: text(loose.regieNote),
    registeredAt: text(loose.registeredAt),
    backup: loose.backup === true,
    energy: (ENERGY_PROFILES as readonly unknown[]).includes(loose.energy) ? (loose.energy as EnergyProfile) : null,
  };
};

/** The steps of an event, keeping only rows with a key; absent before 2026-09-15, the defaults. */
function applicationSteps(value: unknown): ApplicationStep[] {
  if (!Array.isArray(value)) return [...DEFAULT_APPLICATION_STEPS];
  return value
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : {}))
    .map((row) => ({ key: text(row.key), label: text(row.label) }))
    .filter((row) => row.key !== '');
}

/**
 * The import correspondence, keeping only what has the right shape: a header is a string, a
 * choice a pole header with a level header or null, an answer a value of its kind. Anything else
 * is dropped rather than failing the plan, and the detection takes over for it.
 */
function formMapping(value: unknown): FormMapping {
  const loose = (value ?? {}) as Record<string, unknown>;
  const columns: FormMapping['columns'] = {};
  const rawColumns = (loose.columns ?? {}) as Record<string, unknown>;
  for (const field of MAPPED_FIELDS) {
    if (typeof rawColumns[field] === 'string') columns[field] = rawColumns[field] as string;
  }
  const choices = Array.isArray(loose.choices)
    ? (loose.choices as Array<Record<string, unknown>>)
        .filter((c) => c !== null && typeof c === 'object' && typeof c.pole === 'string')
        .map((c) => ({ pole: c.pole as string, level: typeof c.level === 'string' ? c.level : null }))
    : undefined;
  const rawAnswers = (loose.answers ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const pick = <V,>(kind: string, ok: (v: unknown) => v is V): Record<string, V> | undefined => {
    const source = rawAnswers[kind];
    if (!source || typeof source !== 'object') return undefined;
    const out: Record<string, V> = {};
    for (const [key, v] of Object.entries(source)) if (ok(v)) out[key] = v;
    return Object.keys(out).length > 0 ? out : undefined;
  };
  const answers: FormMapping['answers'] = {};
  const volumeAnswers = pick('volume', (v): v is number | 'a-confirmer' => v === 'a-confirmer' || (typeof v === 'number' && v > 0));
  const levelAnswers = pick('level', (v): v is SkillLevel => LEVELS.includes(v as SkillLevel));
  const preferredAnswers = pick('preferredSlot', (v): v is string | null => v === null || typeof v === 'string');
  const slotAnswers = pick('refusedSlots', (v): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string'));
  const poleAnswers = pick('pole', (v): v is string => typeof v === 'string');
  if (volumeAnswers) answers.volume = volumeAnswers;
  if (levelAnswers) answers.level = levelAnswers;
  if (preferredAnswers) answers.preferredSlot = preferredAnswers;
  if (slotAnswers) answers.refusedSlots = slotAnswers;
  if (poleAnswers) answers.pole = poleAnswers;
  return { columns, ...(choices === undefined ? {} : { choices }), answers };
}

/** Buddy pairs with both ends named; the hand-added flag kept only when it is set. */
function buddyPairs(value: unknown): BuddyPair[] {
  return array<Record<string, unknown>>(value)
    .filter((b) => b !== null && typeof b === 'object')
    .map((b) => ({ fromKey: text(b.fromKey), toKey: text(b.toKey), ...(b.manual === true ? { manual: true } : {}) }))
    .filter((b) => b.fromKey !== '' && b.toKey !== '');
}

/** The event's volume settings over the defaults; an unusable option list keeps the defaults. */
function volume(value: unknown): VolumeSettings {
  const loose = (value ?? {}) as Record<string, unknown>;
  const start = hours(loose.dayStartHour);
  const options = [...new Set(array<unknown>(loose.options).map(hours).filter((h): h is number => h !== null && h > 0))]
    .sort((a, b) => a - b);
  return {
    scope: loose.scope === 'day' ? 'day' : 'event',
    dayStartHour: start !== null && start >= 0 && start < 24 ? start : DEFAULT_VOLUME.dayStartHour,
    options: options.length > 0 ? options : [...DEFAULT_VOLUME.options],
  };
}

/**
 * A volunteer's pole choices, and where they come from on a plan written before the list.
 *
 * Until 2026-09-14 a volunteer had exactly two, as six flat fields. A plan carrying those and no
 * `choices` gets them as a list of up to two, in order, an empty one dropped: an unanswered
 * second choice was stored as an empty key, and keeping it would count a choice nobody made.
 */
const LEVELS: readonly SkillLevel[] = ['debutant', 'intermediaire', 'expert'];
const level = (value: unknown): SkillLevel =>
  LEVELS.includes(value as SkillLevel) ? (value as SkillLevel) : 'debutant';

function choices(loose: Record<string, unknown>): PoleChoice[] {
  if (Array.isArray(loose.choices)) {
    return (loose.choices as Array<Record<string, unknown>>)
      .filter((c) => c !== null && typeof c === 'object')
      .map((c) => ({ poleKey: text(c.poleKey), raw: text(c.raw), level: level(c.level) }))
      .filter((c) => c.poleKey !== '' || c.raw.trim() !== '');
  }
  return [1, 2]
    .map((n) => ({
      poleKey: text(loose[`choice${n}PoleKey`]),
      raw: text(loose[`choice${n}Raw`]),
      level: level(loose[`choice${n}Level`]),
    }))
    .filter((c) => c.poleKey !== '' || c.raw.trim() !== '');
}

/**
 * The preference tranches, and where they come from on a plan written before they existed.
 *
 * Until 2026-09-13 the two answers were words, and the hours behind them were two rules:
 * `eveningStartsAt` (the loto hands over to the concerts) and `afternoonOverflowUntil` (how far
 * a loto answer may run past it). A plan carrying those and no `preferenceSlots` gets the same
 * two tranches the migration builds from the same two figures, so nothing anybody tuned in
 * Réglages is lost on the way. A plan with neither takes the defaults.
 */
const preferenceSlots = (
  value: unknown,
  rules: Record<string, unknown> | undefined,
  lengthHours: number,
): readonly PreferenceSlot[] => {
  if (Array.isArray(value) && value.length > 0) {
    return value
      .map((row) => {
        const loose = (row ?? {}) as Record<string, unknown>;
        return {
          id: text(loose.id),
          label: text(loose.label),
          start: hours(loose.start) ?? 0,
          end: hours(loose.end) ?? 0,
          overflowHours: Math.max(0, hours(loose.overflowHours) ?? 0),
        };
      })
      .filter((slot) => slot.id !== '');
  }
  const evening = hours(rules?.eveningStartsAt);
  if (evening === null) return DEFAULT_PREFERENCE_SLOTS;
  const overflowUntil = hours(rules?.afternoonOverflowUntil) ?? evening;
  return [
    { id: 'loto', label: 'Loto', start: 0, end: evening, overflowHours: Math.max(0, overflowUntil - evening) },
    { id: 'concerts', label: 'Concerts', start: evening, end: lengthHours, overflowHours: 0 },
  ];
};

const STATUSES = Object.keys(PERSON_STATUS_LABEL) as PersonStatus[];
const TICKET_KINDS: TicketPersonKind[] = ['benevole', 'orga', 'artiste', 'invite', 'extra'];

/**
 * La billetterie, over its defaults. Absent from anything written before 2026-09-13, and the
 * defaults are then an event with no ticket type, no bracelet and nobody extra, which shows an
 * empty list rather than nothing at all.
 */
const ticketing = (value: unknown): TicketingSettings => {
  const loose = (value ?? {}) as Record<string, unknown>;
  return {
    guestsPerArtist: count(loose.guestsPerArtist, DEFAULT_TICKETING.guestsPerArtist),
    reserveOnDoorList: loose.reserveOnDoorList === true,
    ticketTypes: array<unknown>(loose.ticketTypes)
      .map((v) => {
        const t = (v ?? {}) as Record<string, unknown>;
        return { key: text(t.key), label: text(t.label), start: hours(t.start) ?? 0, end: hours(t.end) ?? 0 };
      })
      .filter((t) => t.key !== ''),
    bracelets: array<unknown>(loose.bracelets)
      .map((v) => {
        const b = (v ?? {}) as Record<string, unknown>;
        return {
          key: text(b.key),
          label: text(b.label),
          defaultFor: keys(b.defaultFor).filter((s): s is PersonStatus => STATUSES.includes(s as PersonStatus)),
        };
      })
      .filter((b) => b.key !== ''),
    extras: array<unknown>(loose.extras)
      .map((v) => {
        const x = (v ?? {}) as Record<string, unknown>;
        return {
          key: text(x.key),
          firstName: text(x.firstName),
          lastName: text(x.lastName),
          status: x.status === 'prestataire' ? ('prestataire' as const) : ('autre' as const),
          phone: text(x.phone),
          drinkTickets: count(x.drinkTickets),
          mealTickets: count(x.mealTickets),
        };
      })
      .filter((x) => x.key !== ''),
    choices: array<unknown>(loose.choices)
      .map((v) => {
        const c = (v ?? {}) as Record<string, unknown>;
        return {
          personKind: TICKET_KINDS.includes(c.personKind as TicketPersonKind)
            ? (c.personKind as TicketPersonKind)
            : ('benevole' as TicketPersonKind),
          personKey: text(c.personKey),
          ticketTypeKey: text(c.ticketTypeKey) || null,
          braceletKey: text(c.braceletKey) || null,
          drinkTickets: hours(c.drinkTickets) === null ? null : count(c.drinkTickets),
          note: text(c.note).trim(),
        };
      })
      // A choice naming nobody, or deciding nothing, is the default and is not kept.
      .filter(
        (c) =>
          c.personKey !== '' &&
          (c.ticketTypeKey !== null || c.braceletKey !== null || c.drinkTickets !== null || c.note !== ''),
      ),
  };
};

const FUELS: FuelKind[] = ['essence', 'diesel', 'electrique', 'gpl', 'autre'];

/** The reimbursement rates, over the defaults, one price per fuel kind. */
const travel = (value: unknown): TravelRates => {
  const loose = (value ?? {}) as Record<string, unknown>;
  const prices = (loose.fuelPrices ?? {}) as Record<string, unknown>;
  const fuelPrices = { ...DEFAULT_TRAVEL_RATES.fuelPrices };
  for (const fuel of FUELS) {
    const price = hours(prices[fuel]);
    if (price !== null && price >= 0) fuelPrices[fuel] = price;
  }
  return {
    fuelPrices,
    tollPerKm: Math.max(0, hours(loose.tollPerKm) ?? DEFAULT_TRAVEL_RATES.tollPerKm),
  };
};

/**
 * Réglages avancés, since 2026-09-13 (PLAN_FORMAT 12). Absent from anything older, which opens
 * with every criterion at its default: the exact rules and weights those plans were built under.
 *
 * Only what `resolveConstraints` could use is kept: a criterion id the engine does not know is
 * dropped rather than carried (a criterion removed by a later build must not travel forever), and
 * a mode or weight of the wrong type is dropped from its override rather than failing the plan.
 * Whether a mode is ALLOWED for its criterion is the engine's question, answered at resolution.
 */
const constraints = (value: unknown): ConstraintSettings => {
  const loose = (value ?? {}) as Record<string, unknown>;
  const rawCriteria = (loose.criteria ?? {}) as Record<string, unknown>;
  const criteria: ConstraintSettings['criteria'] = {};
  for (const def of CRITERIA) {
    const row = rawCriteria[def.id] as Record<string, unknown> | undefined;
    if (!row || typeof row !== 'object') continue;
    const override: CriterionOverride = {};
    if (row.mode === 'block' || row.mode === 'weight' || row.mode === 'off') override.mode = row.mode;
    const weight = hours(row.weight);
    if (weight !== null && weight >= 0) override.weight = weight;
    if (override.mode !== undefined || override.weight !== undefined) criteria[def.id] = override;
  }
  const long = hours(loose.longDayHours);
  const veryLong = hours(loose.veryLongDayHours);
  return {
    criteria,
    longDayHours: long !== null && long > 0 ? long : DEFAULT_CONSTRAINTS.longDayHours,
    veryLongDayHours: veryLong !== null && veryLong > 0 ? veryLong : DEFAULT_CONSTRAINTS.veryLongDayHours,
  };
};

export function normalisePlan(raw: unknown): Plan {
  const loose = (raw ?? {}) as Loose;
  const lengthHours =
    typeof loose.lengthHours === 'number' && loose.lengthHours > 0 ? loose.lengthHours : 18;
  const looseRules = loose.rules as Record<string, unknown> | undefined;

  /*
   * Which of the two organiser shapes arrived, decided on the rows themselves rather than on a
   * format number sitting next to them. A `poleKey` on a organiser is the format 1 shape and
   * exists on nothing else; the absence of one is either the new shape or an empty list, and
   * both take the same path. Reading the rows means a plan whose format number is wrong or
   * missing still converts, which matters because the number is exactly what an older writer
   * would have got wrong.
   */
  /*
   * `leaders` is where this list lived until 2026-09-10, when the type stopped meaning "person
   * in charge of a pole" and started meaning "orga". Every plan in the database still carries
   * the old key, and reading only the new one would open every one of them with no orgas at
   * all, then save that emptiness over the top on the first autosave.
   */
  const looseOrganisers = array<OrganiserV1>(
    loose.organisers ?? (loose as Record<string, unknown>).leaders,
  );
  const legacy = looseOrganisers.some((row) => typeof row?.poleKey === 'string');
  const split = legacy ? splitLegacyOrganisers(looseOrganisers) : null;
  const startISO =
    typeof loose.startISO === 'string' ? loose.startISO : '2027-03-13T12:00:00+01:00';

  return alignPhases({
    name: typeof loose.name === 'string' ? loose.name : 'Planning',
    startISO,
    // Absent from anything written before 2026-09-13; nobody had typed it yet.
    address: typeof loose.address === 'string' ? loose.address : '',
    // Added after plans were already being saved, so an older one falls back to the event this
    // tool was written for: 12h to 06h.
    // Absent from every plan written before 2026-09-10, which simply means nobody has imported
    // from a sheet yet.
    sheetUrl: typeof loose.sheetUrl === 'string' ? loose.sheetUrl : '',
    lengthHours,
    // Rule by rule rather than spread: a plan from before a rule existed picks up the default
    // for it, and a plan carrying a rule that no longer exists (the two the preference tranches
    // replaced) does not drag it along.
    rules: {
      maxConsecutiveHours: hours(looseRules?.maxConsecutiveHours) ?? DEFAULT_RULES.maxConsecutiveHours,
      maxBlocks: hours(looseRules?.maxBlocks) ?? DEFAULT_RULES.maxBlocks,
      minBreakHours: hours(looseRules?.minBreakHours) ?? DEFAULT_RULES.minBreakHours,
      minHoursPerPerson: hours(looseRules?.minHoursPerPerson) ?? DEFAULT_RULES.minHoursPerPerson,
    },
    // Added after plans were being saved. An older one keeps the three slots this event
    // started with, which is exactly what its volunteers answered against.
    //
    // AN EMPTY LIST IS ONLY A GAP ON AN OLD PLAN. A plan carrying `formMapping` was written by
    // PLAN_FORMAT 13 or later, which knows what a tranche is: an empty list there is an event with
    // no tranche, typically a new one (`newEventPlan`), and filling it with the Loto Tekno's three
    // would put a loto back into an event that never had one.
    slots: Array.isArray(loose.slots) && (loose.slots.length > 0 || loose.formMapping !== undefined)
      ? (loose.slots as Plan['slots'])
      : DEFAULT_SLOTS,
    preferenceSlots:
      Array.isArray(loose.preferenceSlots) && loose.preferenceSlots.length === 0 && loose.formMapping !== undefined
        ? []
        : preferenceSlots(loose.preferenceSlots, looseRules, lengthHours),
    poles: array(loose.poles),
    shifts: array(loose.shifts),
    // Four fields before 2026-09-13, a whole fiche since; see `artist` above.
    artists: array<unknown>(loose.artists).map(artist).filter((a) => a.key !== ''),
    organisers: split ? split.organisers : looseOrganisers.map(organiser),
    leaderRoles: split ? split.leaderRoles : array<unknown>(loose.leaderRoles).map(leaderRole),
    volunteers: array<unknown>(loose.volunteers).map(volunteer),
    buddies: buddyPairs(loose.buddies),
    // Absent from anything written before 2026-09-14: nothing was ever removed by hand.
    dismissedBuddies: buddyPairs((loose as Record<string, unknown>).dismissedBuddies),
    assignments: array(loose.assignments),
    reserve: array(loose.reserve),
    // Orgas standing in créneaux of the exploit. Absent from anything written before 2026-09-10,
    // and a row with an empty key is a row nothing can point at, so it is dropped rather than
    // kept as a box nobody can remove.
    organiserShifts: array<unknown>(loose.organiserShifts)
      .map(organiserShift)
      .filter((row) => row.key !== '' && row.organiserKey !== '' && row.shiftKey !== ''),
    // Both phases, over their defaults. A plan written before 2026-09-10 has neither key and
    // opens with two disabled phases, which is exactly the state a régisseur who has not
    // configured them is in.
    montage: phase(loose.montage, 'montage', startISO, lengthHours),
    demontage: phase(loose.demontage, 'demontage', startISO, lengthHours),
    // Absent from anything written before 2026-09-12, which opens with the catering switched
    // off: nothing drawn, nothing counted, exactly the state of a plan nobody has configured.
    catering: catering(loose.catering),
    // Absent from anything written before 2026-09-13: an empty billetterie.
    ticketing: ticketing(loose.ticketing),
    travel: travel(loose.travel),
    constraints: constraints(loose.constraints),
    // Absent from anything written before 2026-09-14, whose form asked for a first and a second
    // choice: ranked.
    poleChoicesRanked: loose.poleChoicesRanked !== false,
    // Absent from anything written before 2026-09-14: one volume for the event, 4, 6 or 8 hours.
    volume: volume(loose.volume),
    // Absent from anything written before 2026-09-14: nothing decided, everything detected.
    formMapping: formMapping(loose.formMapping),
    applicationSteps: applicationSteps((loose as Record<string, unknown>).applicationSteps),
  });
}
