/**
 * The montage and the démontage: the two phases that surround the event itself.
 *
 * WHAT THE EXPLOIT IS AND WHAT A PHASE IS NOT. Everything else in this package models
 * *l'exploit*, the eighteen hours the public is on site: two-hour créneaux, an hour ceiling per
 * person, a solver that fills them, a score for everybody's preferences. A phase is the other
 * kind of work. It runs over several days, people are placed on it by the day or the half-day,
 * nobody counts their hours, and the régisseur distributes it by hand. Not one rule of
 * `validate.ts` applies here, and no solver ever writes into it.
 *
 * TIME IS DECIMAL HOURS FROM THE PHASE'S OWN START, never from the event's. The exploit's
 * origin is `Plan.startISO`; a phase carries its own `startISO`, and its hours count from there.
 * Expressing a montage three days early as hours -72 to 0 of the event would have quietly
 * broken every ruler, every export and every helper that assumes an hour lands inside the
 * event, so the origin moves instead of the arithmetic. Every helper here therefore takes the
 * phase, and `toLabel(phase.startISO, h)` names an hour of it exactly as it names an hour of
 * the exploit.
 *
 * See `.claude/memory/feature_montage_demontage.md` for the brief this comes from.
 */

import {
  absentFromPhase,
  type Organiser,
  type PersonKind,
  type PhasePresence,
  type Volunteer,
  type Window,
} from './model.js';

export type PhaseId = 'montage' | 'demontage';

/**
 * Which of the two people files somebody is in. A phase places both, under no rule at all.
 *
 * Declared in `model.ts` since 2026-09-12, where the catering settings also need it, and
 * re-exported here because this is where every caller learned to find it.
 */
export type { PersonKind } from './model.js';

/**
 * A pole of a phase, and deliberately not a `Pole`.
 *
 * The event's poles carry an experience requirement, a default headcount, a default shift
 * length and a lock for the solver, and every one of those is meaningless here: nothing is
 * solved, nothing is counted, and a level is never asked for. Giving a phase its own slim type
 * keeps those fields from being read as promises the phase does not keep.
 */
export interface PhasePole {
  key: string;
  name: string;
  /** `#rrggbb`, presentation only. Absent means the screen picks one from its palette. */
  colour?: string;
}

/**
 * The pole that always exists, in both phases, and cannot be deleted.
 *
 * Everybody on site with nothing more specific decided for them is drawn here. That is the
 * régisseur's own answer to "where is everybody by default", and it is what makes the grid
 * complete before a single box has been dragged: an orga who says they arrive on Thursday
 * morning appears on Thursday morning, in Général, without anybody typing anything.
 */
export const GENERAL_POLE_KEY = 'general';

export const generalPole = (): PhasePole => ({ key: GENERAL_POLE_KEY, name: 'Général' });

/**
 * Something that happens at a precise moment of a phase and needs a given number of people.
 *
 * "Déchargement du camion de 14h à 16h, il faut six personnes." It has no pole on purpose: the
 * six can be taken from anywhere, which is the whole point of writing it down separately. It is
 * also the ONLY thing in a phase that has a target and can therefore be short of people.
 */
export interface PhaseEvent {
  key: string;
  label: string;
  start: number;
  end: number;
  /** How many people it needs. Zero means "as many as turn up", and is never reported short. */
  headcount: number;
}

/**
 * One person, in one pole or in one événement, over one window.
 *
 * WHERE THESE COME FROM, since 2026-09-11: a declaration produces them. Somebody who filled in
 * the form saying they are there from Thursday morning IS placed from Thursday morning, in the
 * pole they named or in Général, one row per day, and the régisseur then moves and trims those
 * boxes like any others.
 *
 * That replaced a two-state grid, a dashed "déclaré" beside a solid "décidé", which answered a
 * question nobody was asking: a declared presence and a decision are the same fact to a
 * régisseur reading the montage, and the difference only ever showed up as boxes that changed
 * appearance when clicked. What the declaration is still good for is TELLING THE TRUTH ABOUT A
 * PLACEMENT: put somebody on a day they said they were away and the box goes red. See
 * `phaseIssues`.
 *
 * Exactly one of `poleKey` and `eventKey` is set. Both are plain keys rather than one tagged
 * union because this row travels to Postgres as two nullable columns and back, and a shape the
 * database can check is worth more here than a shape TypeScript can.
 */
export interface PhaseAssignment {
  key: string;
  personKind: PersonKind;
  personKey: string;
  /** The phase pole, or '' when this places somebody in an événement. */
  poleKey: string;
  /** The événement, or '' when this places somebody in a pole. */
  eventKey: string;
  start: number;
  end: number;
}

/**
 * A montage or a démontage, whole.
 *
 * `enabled` off is the state every existing plan opens in: the phase exists, carries its
 * defaults, and is drawn nowhere until the régisseur turns it on. That is what lets this ship
 * without moving a single line of a plan that has already been built.
 */
export interface Phase {
  id: PhaseId;
  enabled: boolean;
  /** What the régisseur calls it. "Montage", "Démontage". */
  label: string;
  /**
   * The phase's own origin. Hours inside the phase count from here.
   *
   * ONE EDGE OF EACH PHASE IS THE EVENT'S, since 2026-09-13: the montage ends the moment the
   * event starts, and the démontage starts the moment it ends. So a montage's `lengthHours` and
   * a démontage's `startISO` are not the régisseur's to type; `alignPhase` writes them from the
   * event, and every writer that moves either the event or a phase runs it. Both fields are
   * still stored, because every hour in the phase counts from `startISO` and nothing downstream
   * should have to know which of the two edges was derived.
   */
  startISO: string;
  /** How long it runs, in hours, nights included. Two full days is 48. */
  lengthHours: number;
  /**
   * The hours of the clock nobody works, as a band repeated every day: 0 to 8 by default.
   *
   * A DAILY PATTERN AND NOT A LIST OF WINDOWS, because that is how a régisseur thinks about it
   * ("on ne bosse pas la nuit") and because adding a day to the montage must not mean typing
   * the night in again. The band may wrap past midnight, so 22 to 8 is a legal answer. The two
   * being equal means nothing is off and the phase runs around the clock.
   */
  offStartHour: number;
  offEndHour: number;
  /** The clock hour where the morning gives way to the afternoon. Cuts a day into two halves. */
  dayPartSplitHour: number;
  /** Whether bénévoles are on site at all during this phase. */
  volunteersAllowed: boolean;
  /**
   * The window bénévoles may be on site for, in hours from the phase start.
   *
   * The régisseur sets "les bénévoles peuvent venir à partir du jeudi" on the montage and
   * "jusqu'au lundi" on the démontage, and that is the only edge they set: bénévoles can
   * always stay to the end of a montage and always come from the start of a démontage, so
   * `alignPhase` pins a montage's `volunteersUntil` to its end and a démontage's
   * `volunteersFrom` to 0. It is also the placement a bénévole gets when they said they were
   * coming without saying when.
   */
  volunteersFrom: number;
  volunteersUntil: number;
  poles: readonly PhasePole[];
  events: readonly PhaseEvent[];
  assignments: readonly PhaseAssignment[];
}

/** How long a phase nobody has configured runs: the two days before the event, or after it. */
export const DEFAULT_PHASE_HOURS = 48;

const HOUR_MS = 3600_000;

const isoAt = (iso: string, hours: number): string =>
  new Date(new Date(iso).getTime() + hours * HOUR_MS).toISOString();

/**
 * Where a phase nobody has configured begins: two days before the event for the montage, the
 * end of the event for the démontage. See `alignPhase` for why these are the edges.
 */
export function defaultPhaseStart(
  id: PhaseId,
  eventStartISO: string,
  eventLengthHours: number,
): string {
  return id === 'montage'
    ? isoAt(eventStartISO, -DEFAULT_PHASE_HOURS)
    : isoAt(eventStartISO, eventLengthHours);
}

/** A phase nobody has configured yet: two days from `startISO`, nights off, Général alone. */
export function defaultPhase(
  id: PhaseId,
  startISO: string,
  lengthHours: number = DEFAULT_PHASE_HOURS,
): Phase {
  return {
    id,
    enabled: false,
    label: id === 'montage' ? 'Montage' : 'Démontage',
    startISO,
    lengthHours,
    offStartHour: 0,
    offEndHour: 8,
    dayPartSplitHour: 13,
    volunteersAllowed: false,
    volunteersFrom: 0,
    volunteersUntil: lengthHours,
    poles: [generalPole()],
    events: [],
    assignments: [],
  };
}

/**
 * The phase with its derived edge written from the event, since 2026-09-13.
 *
 * "Pas besoin de mettre d'heure de fin du montage: il finit toujours au moment où l'événement
 * commence. Pareil pour le début du démontage, qui commence toujours au moment où l'événement
 * se termine." So a montage keeps its own start and takes its length from the event's start;
 * a démontage keeps its own length and takes its start from the event's end. A montage whose
 * start is not before the event (an old plan, or a date typed wrong) is put back to the two
 * days before it, which is the only case where anything here moves a box: a montage's hours
 * count from its start, and its start is otherwise never touched.
 *
 * Moving the démontage's origin slides its boxes with it, the way moving the event slides the
 * exploit: a truck booked "quatre heures après la fin" is still four hours after the end.
 *
 * The bénévole window follows: to the end of a montage, from the start of a démontage.
 * Returns the same object when nothing needs changing, so a caller can tell.
 */
export function alignPhase(phase: Phase, eventStartISO: string, eventLengthHours: number): Phase {
  const eventStart = new Date(eventStartISO).getTime();
  if (Number.isNaN(eventStart)) return phase;

  let startISO = phase.startISO;
  let lengthHours = phase.lengthHours;
  if (phase.id === 'montage') {
    const ownStart = new Date(phase.startISO).getTime();
    // A start that cannot be read is left exactly as typed, the way `setPhase` leaves it:
    // there is nothing to derive from it, and overwriting it would zero what somebody typed.
    if (Number.isNaN(ownStart)) return phase;
    lengthHours = (eventStart - ownStart) / HOUR_MS;
    if (!(lengthHours > 0)) {
      startISO = isoAt(eventStartISO, -DEFAULT_PHASE_HOURS);
      lengthHours = DEFAULT_PHASE_HOURS;
    }
  } else {
    startISO = isoAt(eventStartISO, eventLengthHours);
    if (!(lengthHours > 0)) lengthHours = DEFAULT_PHASE_HOURS;
  }

  const clampHour = (h: number): number => Math.min(Math.max(0, h), lengthHours);
  const volunteersFrom = phase.id === 'montage' ? clampHour(phase.volunteersFrom) : 0;
  const volunteersUntil =
    phase.id === 'montage' || !(phase.volunteersUntil > 0)
      ? lengthHours
      : clampHour(phase.volunteersUntil);

  const sameInstant = new Date(startISO).getTime() === new Date(phase.startISO).getTime();
  if (
    sameInstant &&
    lengthHours === phase.lengthHours &&
    volunteersFrom === phase.volunteersFrom &&
    volunteersUntil === phase.volunteersUntil
  ) {
    return phase;
  }
  return {
    ...phase,
    startISO: sameInstant ? phase.startISO : startISO,
    lengthHours,
    volunteersFrom,
    volunteersUntil,
  };
}

// ---------------------------------------------------------------------------
// Window algebra. Small, local, and total: every function here answers on an empty list.
// ---------------------------------------------------------------------------

const byStart = (a: Window, b: Window): number => a.start - b.start || a.end - b.end;

/** Merges touching or overlapping windows and drops the empty ones. */
export function mergeWindows(windows: readonly Window[]): Window[] {
  const merged: Window[] = [];
  for (const w of [...windows].filter((x) => x.end > x.start).sort(byStart)) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
  }
  return merged;
}

/** What is left of `windows` once every one of `cuts` has been taken out of them. */
export function subtractWindows(windows: readonly Window[], cuts: readonly Window[]): Window[] {
  let pieces = mergeWindows(windows);
  for (const cut of mergeWindows(cuts)) {
    pieces = pieces.flatMap((piece) => {
      if (cut.end <= piece.start || cut.start >= piece.end) return [piece];
      const kept: Window[] = [];
      if (cut.start > piece.start) kept.push({ start: piece.start, end: cut.start });
      if (cut.end < piece.end) kept.push({ start: cut.end, end: piece.end });
      return kept;
    });
  }
  return mergeWindows(pieces);
}

/** The part of `windows` that falls inside `bounds`. */
export function clipWindows(windows: readonly Window[], bounds: Window): Window[] {
  return mergeWindows(
    windows
      .map((w) => ({ start: Math.max(w.start, bounds.start), end: Math.min(w.end, bounds.end) }))
      .filter((w) => w.end > w.start),
  );
}

export const windowHours = (windows: readonly Window[]): number =>
  windows.reduce((total, w) => total + (w.end - w.start), 0);

export const windowsOverlap = (a: Window, b: Window): boolean =>
  a.start < b.end && b.start < a.end;

// ---------------------------------------------------------------------------
// Days, nights and half-days
// ---------------------------------------------------------------------------

/** One calendar day of a phase, and the pieces of it that are actually worked. */
export interface PhaseDay {
  /** 0 for the day the phase starts on. */
  index: number;
  /** Hours from the phase start to local midnight of this day. Negative on the first day. */
  midnight: number;
  /** "jeu. 11/03", the way a column is headed. */
  label: string;
  /** The worked pieces of this day, in phase hours, in clock order. Never empty. */
  segments: Window[];
}

/** One half of a day: what a click on the grid places somebody for, by default. */
export interface PhaseDayPart {
  key: string;
  dayIndex: number;
  half: 'matin' | 'apresmidi';
  /** "jeu. matin". */
  label: string;
  start: number;
  end: number;
}

const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });

const atHour = (startISO: string, hours: number): Date =>
  new Date(new Date(startISO).getTime() + hours * 3600_000);

/** Hours from the phase start to the local midnight that opens the day `hours` falls in. */
function midnightOf(phase: Phase, hours: number): number {
  const at = atHour(phase.startISO, hours);
  const midnight = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  return (midnight - new Date(phase.startISO).getTime()) / 3600_000;
}

/**
 * The bands of a day nobody works, expressed in hours from that day's midnight.
 *
 * A band that wraps past midnight comes back as two, which is what makes 22h to 8h mean "the
 * end of this day and the beginning of it" rather than an empty answer or a negative one.
 */
function offBands(phase: Phase): Window[] {
  const { offStartHour: from, offEndHour: to } = phase;
  if (from === to) return [];
  if (from < to) return [{ start: from, end: to }];
  return [
    { start: 0, end: to },
    { start: from, end: 24 },
  ];
}

/**
 * Every day of the phase, with the hours of it that are worked.
 *
 * DAYS WITH NOTHING LEFT ARE DROPPED. A phase whose night band swallows a whole day has no
 * column for it, rather than an empty one: the grid is meant to show where work happens.
 */
export function phaseDays(phase: Phase): PhaseDay[] {
  const bounds: Window = { start: 0, end: Math.max(0, phase.lengthHours) };
  const days: PhaseDay[] = [];
  let index = 0;

  for (let cursor = midnightOf(phase, 0); cursor < bounds.end; cursor += 24) {
    const whole: Window = { start: cursor, end: cursor + 24 };
    const cuts = offBands(phase).map((b) => ({ start: cursor + b.start, end: cursor + b.end }));
    const segments = clipWindows(subtractWindows([whole], cuts), bounds);
    if (segments.length > 0) {
      days.push({
        index,
        midnight: cursor,
        label: DAY_LABEL.format(atHour(phase.startISO, Math.max(cursor, 0) + 0.001)),
        segments,
      });
    }
    index += 1;
  }

  return days;
}

/**
 * The half-days of a phase, in order.
 *
 * The morning is what is worked before the split, the afternoon what is worked after it, and a
 * half with no worked hours in it produces nothing. Both are windows rather than a fixed
 * length: a day whose night ends at 8h has a five-hour morning, and saying so is the point.
 */
export function phaseDayParts(phase: Phase): PhaseDayPart[] {
  const parts: PhaseDayPart[] = [];

  for (const day of phaseDays(phase)) {
    const split = day.midnight + phase.dayPartSplitHour;
    const halves: Array<{ half: PhaseDayPart['half']; bounds: Window }> = [
      { half: 'matin', bounds: { start: day.midnight, end: split } },
      { half: 'apresmidi', bounds: { start: split, end: day.midnight + 24 } },
    ];

    for (const { half, bounds } of halves) {
      const pieces = clipWindows(day.segments, bounds);
      if (pieces.length === 0) continue;
      parts.push({
        key: `${day.index}-${half}`,
        dayIndex: day.index,
        half,
        label: `${day.label} ${half === 'matin' ? 'matin' : 'après-midi'}`,
        start: pieces[0]!.start,
        end: pieces[pieces.length - 1]!.end,
      });
    }
  }

  return parts;
}

/** The worked hours of the whole phase, nights taken out. What a person can be present for. */
export function workedWindows(phase: Phase): Window[] {
  return phaseDays(phase).flatMap((d) => d.segments);
}

// ---------------------------------------------------------------------------
// Who is on site, and where the tool draws them
// ---------------------------------------------------------------------------

/** Somebody a phase can place, whichever file they come from. */
export interface PhasePerson {
  kind: PersonKind;
  key: string;
  /** The declared presence, already read off the orga's arrival or the bénévole's answer. */
  presence: Window[];
  /** Where they go when nothing else has been decided: their first declared pole, or Général. */
  defaultPoleKey: string;
}

/** The window an orga declared for this phase, before the phase's own nights are taken out. */
export function organiserPresence(organiser: Organiser, phase: Phase): Window[] {
  if (phase.id === 'montage') {
    const from = organiser.montageFrom;
    return from === null ? [] : [{ start: from, end: phase.lengthHours }];
  }
  const until = organiser.demontageUntil;
  return until === null ? [] : [{ start: 0, end: until }];
}

/**
 * The window a bénévole is on site for, which is never wider than what the régisseur opened.
 *
 * An answer with no hours in it means the whole opening. An answer with hours is still clipped
 * to it: somebody who wrote "je peux venir dès mardi" cannot be placed on a day the bénévoles
 * are not welcome on, and silently placing them there is exactly the kind of thing this tool
 * must not do.
 */
export function volunteerPresence(presence: PhasePresence, phase: Phase): Window[] {
  if (!presence.present || !phase.volunteersAllowed) return [];
  const opening: Window = { start: phase.volunteersFrom, end: phase.volunteersUntil };
  if (opening.end <= opening.start) return [];
  return presence.windows.length === 0
    ? [opening]
    : clipWindows(presence.windows, opening);
}

const phasePresenceOf = (volunteer: Volunteer, phase: Phase): PhasePresence =>
  phase.id === 'montage' ? volunteer.montage : volunteer.demontage;

/**
 * Everybody on site during this phase, orgas first, in the order their own file lists them.
 *
 * Somebody who declared nothing is not here at all: absence is the default, on purpose. Being
 * drawn on the montage is a thing a person said, never a thing the tool assumed for them.
 */
export function phasePeople(
  phase: Phase,
  organisers: readonly Organiser[],
  volunteers: readonly Volunteer[],
): PhasePerson[] {
  const worked = workedWindows(phase);
  const people: PhasePerson[] = [];
  const known = new Set(phase.poles.map((p) => p.key));

  for (const organiser of organisers) {
    const poleKeys =
      phase.id === 'montage' ? organiser.montagePoleKeys : organiser.demontagePoleKeys;
    const declared = clipWindows(organiserPresence(organiser, phase), {
      start: 0,
      end: phase.lengthHours,
    });
    if (declared.length === 0) continue;
    people.push({
      kind: 'orga',
      key: organiser.key,
      presence: declared.flatMap((w) => clipWindows(worked, w)),
      defaultPoleKey: poleKeys.find((k) => known.has(k)) ?? GENERAL_POLE_KEY,
    });
  }

  for (const volunteer of volunteers) {
    const presence = volunteerPresence(phasePresenceOf(volunteer, phase), phase);
    if (presence.length === 0) continue;
    people.push({
      kind: 'benevole',
      key: volunteer.key,
      presence: presence.flatMap((w) => clipWindows(worked, w)),
      defaultPoleKey: GENERAL_POLE_KEY,
    });
  }

  return people;
}

/** A box on a phase grid: either a decision that was taken, or the default it falls back to. */
export interface PhasePlacement {
  personKind: PersonKind;
  personKey: string;
  poleKey: string;
  eventKey: string;
  start: number;
  end: number;
  /** The row of `phase.assignments` this box draws. Every box has one since 2026-09-11. */
  assignmentKey: string;
}

/** The boxes of one person, in clock order. Every box is a row of `phase.assignments`. */
export function placementsFor(person: PhasePerson, phase: Phase): PhasePlacement[] {
  return phase.assignments
    .filter((a) => a.personKey === person.key && a.personKind === person.kind)
    .map(asPlacement)
    .sort((a, b) => a.start - b.start);
}

const asPlacement = (a: PhaseAssignment): PhasePlacement => ({
  personKind: a.personKind,
  personKey: a.personKey,
  poleKey: a.poleKey,
  eventKey: a.eventKey,
  start: a.start,
  end: a.end,
  assignmentKey: a.key,
});

/** Every box of the phase. What a grid, a printed sheet or a dashboard draws, in one call. */
export function allPlacements(phase: Phase): PhasePlacement[] {
  return [...phase.assignments].map(asPlacement).sort((a, b) => a.start - b.start);
}

/**
 * The boxes a declaration asks for: one per worked day somebody said they were there.
 *
 * ONE BOX PER DAY, and that is the point of cutting them here rather than making one long box
 * across the week: the régisseur trims Thursday without touching Friday, which is what they
 * actually do. `PhasePerson.presence` is already clipped to the phase's worked hours, so a
 * night never lands inside one of these.
 *
 * The pole is the one the person named for this phase, or Général. An événement is never produced
 * from a declaration: nobody declares that they will unload a truck.
 *
 * ORGAS ONLY SINCE 2026-09-12, and the distinction is the régisseur's: "les bénévoles qui ont
 * répondu être disponibles au montage ne devraient pas être automatiquement affectés, mais
 * seulement dans l'onglet disponible". The two answers do not mean the same thing.
 *
 * An orga writes down when they ARE on site: "je suis là à partir de mercredi 8h" is a fact about
 * their week, and drawing it is drawing what they said. A bénévole answers whether they WOULD BE
 * WILLING to come, out of a hundred and twenty people for a montage that needs fifteen. Turning
 * that into a placement fills the grid with people nobody chose and buries the handful the
 * régisseur actually wants there.
 *
 * So a bénévole stays in « Disponibles » until somebody drags them onto the grid. They are still
 * in `phasePeople`, still in the pool, still measured against their own declaration when placed:
 * the only thing that changed is that the tool no longer decides for the régisseur.
 */
export function declaredPlacements(person: PhasePerson): Array<{
  poleKey: string;
  start: number;
  end: number;
}> {
  if (person.kind !== 'orga') return [];
  return person.presence.map((w) => ({
    poleKey: person.defaultPoleKey,
    start: w.start,
    end: w.end,
  }));
}

/**
 * What each person declared, as windows, whatever the plan then did with them.
 *
 * The reference every red box on a phase is measured against: somebody placed outside these
 * windows is placed on a day they said they were away.
 */
export function declaredWindows(
  phase: Phase,
  organisers: readonly Organiser[],
  volunteers: readonly Volunteer[],
): Map<string, Window[]> {
  const windows = new Map<string, Window[]>();
  for (const person of phasePeople(phase, organisers, volunteers)) {
    windows.set(`${person.kind}|${person.key}`, person.presence);
  }
  return windows;
}

/**
 * The pole somebody said they would work in during this phase, or '' when they named none.
 *
 * Only orgas name one: the volunteers' form asks whether they are coming, not where. So a
 * bénévole is never reported as being in the wrong pole, because they never said.
 */
export function declaredPole(
  phase: Phase,
  organisers: readonly Organiser[],
  personKind: PersonKind,
  personKey: string,
): string {
  if (personKind !== 'orga') return '';
  const organiser = organisers.find((o) => o.key === personKey);
  if (!organiser) return '';
  const keys = phase.id === 'montage' ? organiser.montagePoleKeys : organiser.demontagePoleKeys;
  const known = new Set(phase.poles.map((p) => p.key));
  return keys.find((k) => known.has(k)) ?? '';
}

/**
 * What is wrong with a placement, in the régisseur's own terms.
 *
 * THREE THINGS, AND NOT ONE OF THEM IS A REFUSAL. A phase has no rules; what it has is answers
 * people gave, and a placement that contradicts one is worth saying out loud in red:
 *
 *   'hors-presence'  placed at an hour they said they were not there. The one that matters:
 *                    somebody is expected on site who never said they would come.
 *   'autre-pole'     placed somewhere other than the pole they named on the form. Legitimate,
 *                    often deliberate, and still worth seeing: it means telling them.
 *   'chevauchement'  written down in two places at the same time. Only a human can pick.
 *
 * Nothing here removes or moves anything, ever.
 */
export type PhaseIssueCode = 'hors-presence' | 'autre-pole' | 'chevauchement';

export interface PhaseIssue {
  code: PhaseIssueCode;
  assignmentKey: string;
  personKind: PersonKind;
  personKey: string;
  /** French, addressed to the régisseur, and shown on the box itself. */
  message: string;
}

export function phaseIssues(
  phase: Phase,
  organisers: readonly Organiser[],
  volunteers: readonly Volunteer[],
): PhaseIssue[] {
  const issues: PhaseIssue[] = [];
  const declared = declaredWindows(phase, organisers, volunteers);

  for (const a of phase.assignments) {
    const id = `${a.personKind}|${a.personKey}`;
    const presence = declared.get(id) ?? [];
    const outside = subtractWindows([{ start: a.start, end: a.end }], presence);

    if (outside.length > 0) {
      issues.push({
        code: 'hors-presence',
        assignmentKey: a.key,
        personKind: a.personKind,
        personKey: a.personKey,
        message: outsideMessage(phase, volunteers, a, presence, windowHours(outside)),
      });
    }

    const said = declaredPole(phase, organisers, a.personKind, a.personKey);
    if (a.eventKey === '' && said !== '' && a.poleKey !== said) {
      const name = phase.poles.find((p) => p.key === said)?.name ?? said;
      issues.push({
        code: 'autre-pole',
        assignmentKey: a.key,
        personKind: a.personKind,
        personKey: a.personKey,
        message: `A indiqué le pôle ${name} sur son formulaire.`,
      });
    }
  }

  for (const clash of phaseClashes(phase)) {
    for (const row of [clash.first, clash.second]) {
      issues.push({
        code: 'chevauchement',
        assignmentKey: row.key,
        personKind: clash.personKind,
        personKey: clash.personKey,
        message: 'Écrit à deux endroits en même temps.',
      });
    }
  }

  return issues;
}

/**
 * Why a box falls outside somebody's presence, in the words of whoever actually decided it.
 *
 * THREE DIFFERENT SENTENCES FOR THREE DIFFERENT FACTS, and telling them apart is the point.
 * The message used to be "N h en dehors de ce qui a été déclaré" for every case, which is a
 * plain untruth in the commonest one and cost the régisseur an afternoon on 2026-09-13: "j'ai
 * indiqué certains bénévoles comme disponibles au montage, je ne comprends pas pourquoi ils sont
 * mis du jeudi 9h au vendredi 12h seulement, et si j'étire leur case elles apparaissent en rouge".
 *
 * Nobody had declared those hours. A bénévole who ticks "oui je viens" and gives no hours has
 * declared NOTHING about when, so the window they are held to is the one the RÉGISSEUR opened to
 * the bénévoles in Réglages, `volunteersFrom` to `volunteersUntil`. Blaming their answer for a
 * setting sends the reader to the wrong screen: they go and read the person's form, which says
 * what they expected, and the red stays. So the sentence now names the setting, and the hours it
 * currently holds, which is the thing to go and change.
 */
function outsideMessage(
  phase: Phase,
  volunteers: readonly Volunteer[],
  a: PhaseAssignment,
  presence: readonly Window[],
  hours: number,
): string {
  if (presence.length === 0) return "N'a pas déclaré être là sur cette phase.";

  if (a.personKind === 'benevole') {
    const answer = phasePresenceOf(
      volunteers.find((v) => v.key === a.personKey) ?? ({ montage: absentFromPhase(), demontage: absentFromPhase() } as Volunteer),
      phase,
    );
    if (answer.present && answer.windows.length === 0) {
      return (
        `${fmtPhaseHours(hours)} hors de la fenêtre ouverte aux bénévoles ` +
        `(${fmtPhaseClock(phase, phase.volunteersFrom)} → ${fmtPhaseClock(phase, phase.volunteersUntil)}). ` +
        `Cette personne a répondu « oui » sans donner d'horaire: c'est le réglage de la phase qui décide, pas sa réponse.`
      );
    }
  }

  return `${fmtPhaseHours(hours)} en dehors de ce qui a été déclaré.`;
}

/** "jeu. 09h00", an hour of the phase named the way the régisseur reads a date. */
function fmtPhaseClock(phase: Phase, hours: number): string {
  const at = atHour(phase.startISO, hours);
  const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.format(at)} ${pad(at.getHours())}h${pad(at.getMinutes())}`;
}

/** "4 h", "2 h 30". Local to this file: the exploit's own formatter lives in `plan.ts`. */
function fmtPhaseHours(hours: number): string {
  const whole = Math.floor(hours + 1e-9);
  const minutes = Math.round((hours - whole) * 60);
  return minutes === 0 ? `${whole} h` : `${whole} h ${minutes}`;
}

// ---------------------------------------------------------------------------
// What the régisseur needs told
// ---------------------------------------------------------------------------

export interface PhaseEventFill {
  event: PhaseEvent;
  taken: number;
  /** How many are still missing. Zero when the événement asks for nobody in particular. */
  missing: number;
}

/** How many people each événement holds, against what it asked for. */
export function eventFills(phase: Phase): PhaseEventFill[] {
  return phase.events.map((event) => {
    const taken = new Set(
      phase.assignments
        .filter((a) => a.eventKey === event.key)
        .map((a) => `${a.personKind}|${a.personKey}`),
    ).size;
    return { event, taken, missing: Math.max(0, event.headcount - taken) };
  });
}

/**
 * Somebody written down in two places at the same time.
 *
 * REPORTED, NEVER REFUSED. A phase carries no hard rule, and the régisseur is entitled to note
 * that two things overlap while they sort it out. What the tool owes them is to say so out
 * loud, on the grid and in the dashboard, rather than to pick one of the two silently.
 */
export interface PhaseClash {
  personKind: PersonKind;
  personKey: string;
  first: PhaseAssignment;
  second: PhaseAssignment;
}

export function phaseClashes(phase: Phase): PhaseClash[] {
  const clashes: PhaseClash[] = [];
  const byPerson = new Map<string, PhaseAssignment[]>();

  for (const a of phase.assignments) {
    const id = `${a.personKind}|${a.personKey}`;
    byPerson.set(id, [...(byPerson.get(id) ?? []), a]);
  }

  for (const [id, rows] of byPerson) {
    const sorted = [...rows].sort(byStart);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (!windowsOverlap(sorted[i]!, sorted[j]!)) continue;
        const [kind, key] = id.split('|') as [PersonKind, string];
        clashes.push({ personKind: kind, personKey: key, first: sorted[i]!, second: sorted[j]! });
      }
    }
  }

  return clashes;
}

/** The hours somebody is on site for, derived boxes included. Shown on a fiche, never a rule. */
export function hoursOnPhase(person: PhasePerson): number {
  return windowHours(person.presence);
}

/**
 * The moment an orga wrote down, read as hours from the phase's own start.
 *
 * "10/03/2027 08:00", "10/03 8h", "2027-03-10T08:00". What the orga form collects is a day and
 * an hour, because that is what somebody knows about their own arrival, and this is the one
 * conversion between the two: the form speaks in dates, everything downstream in hours.
 *
 * NULL RATHER THAN A GUESS, in every doubtful case: an answer that names no date, or one that
 * falls outside the phase entirely, is not an arrival. Somebody who wrote "je verrai bien"
 * belongs on nobody's grid until a human decides where, and an arrival invented here would put
 * them on it with nothing saying it was invented. The sentence itself is kept on the fiche.
 *
 * A moment inside the phase but a few minutes off is clamped rather than refused: 07:55 on the
 * first morning is the start of the montage, not a mistake.
 */
export function parsePhaseMoment(raw: string, phase: Phase): number | null {
  const text = raw.trim();
  if (text === '') return null;

  const french = /(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?:\s*(?:à|a)?\s*(\d{1,2})\s*[h:]\s*(\d{2})?)?/.exec(text);
  const base = new Date(phase.startISO);
  if (Number.isNaN(base.getTime())) return null;

  let when: Date | null = null;
  if (french) {
    const [, day, month, year, hour, minute] = french;
    const fullYear = year === undefined ? base.getFullYear() : Number(year.length === 2 ? `20${year}` : year);
    when = new Date(
      fullYear,
      Number(month) - 1,
      Number(day),
      hour === undefined ? 0 : Number(hour),
      minute === undefined ? 0 : Number(minute),
    );
  } else {
    const iso = new Date(text);
    if (!Number.isNaN(iso.getTime())) when = iso;
  }

  if (!when || Number.isNaN(when.getTime())) return null;

  const hours = (when.getTime() - base.getTime()) / 3600_000;
  // A day out is somebody talking about another phase, or another year: not an arrival here.
  if (hours < -24 || hours > phase.lengthHours + 24) return null;
  return Math.min(Math.max(0, hours), phase.lengthHours);
}
