import {
  GENERAL_POLE_KEY,
  declaredPlacements,
  defaultPhase,
  defaultPhaseStart,
  generalPole,
  phasePeople,
  type Phase,
  type PhaseAssignment,
} from './phase.js';
import { importOrganisers } from './import-organisers.js';
/**
 * Plans to validate against.
 *
 * THIS IS NOT THE SOLVER. `greedyFill` is a deliberately simple baseline whose only promise is
 * that it never produces a tier 1 issue, because it asks `blockersFor` before every placement.
 * It exists so the validation engine has real plans to chew on before the solver exists, and so
 * the solver has a score to beat. When the solver lands, this stays as the baseline.
 *
 * `injectViolations` does the opposite: it force-feeds a plan the exact illegal assignments the
 * engine is supposed to catch, one per tier 1 code, and says what it injected. That is how the
 * engine is tested against something other than its own opinion.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_CATERING,
  DEFAULT_TICKETING,
  DEFAULT_TRAVEL_RATES,
  DEFAULT_RULES,
  DEFAULT_PREFERENCE_SLOTS,
  DEFAULT_SLOTS,
  makeArtistMember,
  makeCarTrip,
  shiftHours,
  type Shift,
  type Volunteer,
} from './model.js';
import { DEFAULT_CONSTRAINTS } from './constraints.js';
import { DEFAULT_VOLUME } from './days.js';
import {
  PlanIndex,
  type Assignment,
  type BuddyPair,
  type Plan,
} from './plan.js';
import { TIER1, blockersFor } from './validate.js';
import {
  EVENT_LENGTH_HOURS,
  EVENT_NAME,
  EVENT_START_ISO,
  buildArtists,
  buildPoles,
  buildShifts,
} from './event-config.js';
import { importVolunteers } from './import.js';

// ---------------------------------------------------------------------------
// Loading a generated scenario
// ---------------------------------------------------------------------------

/** Builds an unassigned plan from a scenario written by `npm run generate`. */
export function loadScenario(scenario: string, outRoot = 'out'): Plan {
  const { poles } = buildPoles();
  const shifts = buildShifts(poles);
  const artists = buildArtists();
  const csv = readFileSync(join(outRoot, scenario, 'benevoles.csv'), 'utf8');
  const imported = importVolunteers(csv, {
    poles,
    artists,
    startISO: EVENT_START_ISO,
    lengthHours: EVENT_LENGTH_HOURS,
  });

  const buddies: BuddyPair[] = imported.buddies
    .filter((b) => b.toKey !== null)
    .map((b) => ({ fromKey: b.fromKey, toKey: b.toKey! }));

  return {
    name: `${EVENT_NAME} (${scenario})`,
    startISO: EVENT_START_ISO,
    lengthHours: EVENT_LENGTH_HOURS,
    address: '',
    sheetUrl: '',
    rules: DEFAULT_RULES,
    catering: DEFAULT_CATERING,
    ticketing: DEFAULT_TICKETING,
    travel: DEFAULT_TRAVEL_RATES,
    constraints: DEFAULT_CONSTRAINTS,
    poleChoicesRanked: true,
    volume: DEFAULT_VOLUME,
    formMapping: { columns: {}, answers: {} },
    dismissedBuddies: [],
    slots: DEFAULT_SLOTS,
    preferenceSlots: DEFAULT_PREFERENCE_SLOTS,
    poles,
    shifts,
    artists,
    organisers: [],
    leaderRoles: [],
    volunteers: imported.volunteers,
    buddies,
    assignments: [],
    reserve: [],
    // The scenarios are the exploit's: no orga is placed in a créneau either.
    organiserShifts: [],
    // Both phases exist, both are off, either side of the event.
    montage: defaultPhase('montage', defaultPhaseStart('montage', EVENT_START_ISO, EVENT_LENGTH_HOURS)),
    demontage: defaultPhase('demontage', defaultPhaseStart('demontage', EVENT_START_ISO, EVENT_LENGTH_HOURS)),
  };
}

// ---------------------------------------------------------------------------
// Baseline filler
// ---------------------------------------------------------------------------

const withAssignments = (plan: Plan, assignments: readonly Assignment[]): Plan =>
  ({ ...plan, assignments });

/**
 * Fills the plan greedily, hardest shifts first.
 *
 * The order is the only intelligence here: a shift few people can take is filled before an easy
 * one, otherwise the easy shifts eat the flexible volunteers and the hard ones stay empty. Within
 * a shift, choice 1 beats choice 2 beats anything else, then whoever is furthest from their
 * requested volume, so the hours spread instead of piling on the first names in the list.
 *
 * No backtracking, no re-placement, no objective function. That is the solver's job.
 */
export function greedyFill(plan: Plan): Plan {
  const assignments: Assignment[] = [...plan.assignments];
  let index = new PlanIndex(withAssignments(plan, assignments));

  // Scarcity is measured once, on the empty plan. It is a property of who answered the form,
  // not of the assignments made so far.
  const scarcity = new Map<string, number>();
  for (const shift of plan.shifts) {
    const takers = plan.volunteers.filter((v) => blockersFor(index, v, shift).length === 0).length;
    scarcity.set(shift.key, takers);
  }

  const order = [...plan.shifts].sort(
    (a, b) => (scarcity.get(a.key) ?? 0) - (scarcity.get(b.key) ?? 0) || a.start - b.start,
  );

  for (const shift of order) {
    while (index.assigneesOf(shift.key).length < shift.headcount) {
      const pick = bestCandidate(index, shift);
      if (!pick) break;
      assignments.push({ volunteerKey: pick.key, shiftKey: shift.key, locked: false, source: 'solver' });
      index = new PlanIndex(withAssignments(plan, assignments));
    }
  }

  return withAssignments(plan, assignments);
}

function bestCandidate(index: PlanIndex, shift: Shift): Volunteer | null {
  const present = new Set(index.assigneesOf(shift.key).map((v) => v.key));
  let best: Volunteer | null = null;
  let bestScore = -Infinity;

  for (const volunteer of index.plan.volunteers) {
    if (present.has(volunteer.key)) continue;
    if (blockersFor(index, volunteer, shift).length > 0) continue;

    const rank = index.rankOf(volunteer, shift.poleKey);
    const assigned = index.hoursOf(volunteer.key);

    // Ordered by weight, not lexicographic. Reaching the 4h floor outranks getting choice 1,
    // which is the same priority the real objective will use.
    let score = 0;
    if (assigned < index.plan.rules.minHoursPerPerson) score += 1000;
    score += rank === 0 ? 100 : rank !== null ? Math.max(20, 100 - 40 * rank) : 0;
    score += (volunteer.requestedHours - assigned) * 5;
    if (index.artistsClashing(volunteer, shift).length > 0) score -= 80;

    // A buddy already on this shift is the cheapest way to honour a request.
    const wants = index.plan.buddies.some(
      (b) =>
        (b.fromKey === volunteer.key && present.has(b.toKey)) ||
        (b.toKey === volunteer.key && present.has(b.fromKey)),
    );
    if (wants) score += 40;

    if (score > bestScore) {
      bestScore = score;
      best = volunteer;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Deliberate breakage
// ---------------------------------------------------------------------------

export interface InjectedViolation {
  code: string;
  volunteerKey: string;
  shiftKey: string;
  /** Every code the injected assignment triggers, not just the one it was chosen for. */
  alsoTriggers: string[];
}

/** The tier 1 codes reachable by adding one assignment to an otherwise legal plan. */
const INJECTABLE: readonly string[] = [
  TIER1.chevauchement,
  TIER1.poleRefuse,
  TIER1.trancheRefusee,
  TIER1.dureeConsecutive,
  TIER1.tropDeBlocs,
  TIER1.pauseInsuffisante,
  TIER1.volumeDepasse,
  TIER1.sureffectif,
];

/**
 * Adds one illegal assignment per tier 1 code, picking for each the pair that triggers it with
 * the fewest side effects, so a test can assert on a tight expectation. Codes that cannot be
 * reached in this particular plan are skipped rather than faked.
 */
export function injectViolations(plan: Plan): { plan: Plan; injected: InjectedViolation[] } {
  const assignments: Assignment[] = [...plan.assignments];
  const injected: InjectedViolation[] = [];
  const used = new Set<string>();

  for (const code of INJECTABLE) {
    const index = new PlanIndex(withAssignments(plan, assignments));
    let best: InjectedViolation | null = null;

    for (const volunteer of plan.volunteers) {
      for (const shift of plan.shifts) {
        const pairKey = `${volunteer.key}|${shift.key}`;
        if (used.has(pairKey)) continue;
        const codes = blockersFor(index, volunteer, shift).map((b) => b.code);
        if (!codes.includes(code)) continue;
        if (best === null || codes.length < best.alsoTriggers.length) {
          best = { code, volunteerKey: volunteer.key, shiftKey: shift.key, alsoTriggers: codes };
        }
        if (codes.length === 1) break;
      }
      if (best?.alsoTriggers.length === 1) break;
    }

    if (!best) continue;
    used.add(`${best.volunteerKey}|${best.shiftKey}`);
    injected.push(best);
    assignments.push({
      volunteerKey: best.volunteerKey,
      shiftKey: best.shiftKey,
      locked: false,
      source: 'manual',
    });
  }

  // The two integrity codes cannot come from a real pair, so they are added by hand.
  const anyShift = plan.shifts[0];
  const anyVolunteer = plan.volunteers[0];
  if (anyShift && anyVolunteer) {
    assignments.push({ volunteerKey: 'inconnu-xyz', shiftKey: anyShift.key, locked: false, source: 'manual' });
    injected.push({ code: TIER1.referenceInconnue, volunteerKey: 'inconnu-xyz', shiftKey: anyShift.key, alsoTriggers: [TIER1.referenceInconnue] });

    const existing = assignments.find((a) => a.volunteerKey === anyVolunteer.key);
    if (existing) {
      assignments.push({ ...existing });
      injected.push({ code: TIER1.doublon, volunteerKey: existing.volunteerKey, shiftKey: existing.shiftKey, alsoTriggers: [TIER1.doublon] });
    }
  }

  return { plan: withAssignments(plan, assignments), injected };
}

/** Total person-hours a plan assigns. Handy in tests and in the CLI. */
export const assignedHours = (plan: Plan): number => {
  const byKey = new Map(plan.shifts.map((s) => [s.key, s]));
  return plan.assignments.reduce((total, a) => {
    const shift = byKey.get(a.shiftKey);
    return shift ? total + shiftHours(shift) : total;
  }, 0);
};

// ---------------------------------------------------------------------------
// The same scenario with everything around the exploit switched on
// ---------------------------------------------------------------------------

/** The phase poles the orgas' test form names, plus Général, on both phases. */
const PHASE_POLE_NAMES = ['Scène', 'Bar', 'Décoration', 'Logistique', 'Technique Son'];

const slug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * A plan with the montage, the démontage, the catering and a full artist's fiche switched on:
 * the `+phases` variant of a scenario, written for looking at the tool rather than for solving.
 *
 * WHY A FIXTURE AND NOT A CLICK PATH. Every scenario `npm run generate` writes is the exploit's:
 * both phases off, no orga, no plate, a line-up of names and hours. That is right for the solver
 * and wrong for looking at a montage grid, an orga's fiche, a caterer's table or balances drawn
 * the day before: reaching any of those from a fresh fixture is ten clicks through Réglages, and
 * a screenshot harness that clicks through Réglages tests Réglages. So this builds the state
 * once, from the same generated files, and the harness opens it like any other scenario.
 *
 * What it adds, all of it deterministic:
 * - both phases on, two days each, with five poles beside Général and one événement each;
 * - the orgas of `out/orgas.csv`, imported through the real importer, each placed where they
 *   said (the montage's « Placer les déclarés » done here), their poles resolved by name;
 * - bénévoles: the phases opened to them from the montage's second day, and three of those who
 *   said yes placed by hand in Général on the montage's last day;
 * - the first act with balances the afternoon before (drawn on the montage), a changement de
 *   plateau on each side, two members of which one is also the first orga, and a car trip;
 * - the catering on, and an address for the venue.
 */
export function withPhases(plan: Plan, outRoot = 'out'): Plan {
  const poles = [generalPole(), ...PHASE_POLE_NAMES.map((name) => ({ key: slug(name), name }))];
  const on = (phase: Phase): Phase => ({ ...phase, enabled: true, poles });
  let montage = on(plan.montage);
  let demontage = on(plan.demontage);

  const orgasCsv = readFileSync(join(outRoot, 'orgas.csv'), 'utf8');
  const imported = importOrganisers(orgasCsv, { phases: { montage, demontage } });
  // The importer keeps the pole answer in the note; the phase poles are ours, so they resolve here.
  const organisers = imported.organisers.map((o) => {
    const named = /Pôles: (.+)$/m.exec(o.note)?.[1]?.trim() ?? '';
    const key = poles.find((p) => p.name === named)?.key;
    const own = key && key !== GENERAL_POLE_KEY ? [key] : [];
    return {
      ...o,
      note: o.note.replace(/\n?Pôles: .+$/m, '').trim(),
      montagePoleKeys: own,
      demontagePoleKeys: own,
    };
  });

  const volunteers = plan.volunteers;
  montage = {
    ...montage,
    volunteersAllowed: true,
    volunteersFrom: 24,
    events: [{ key: 'camion', label: 'Déchargement du camion', start: 6, end: 8, headcount: 6 }],
  };
  demontage = {
    ...demontage,
    volunteersAllowed: true,
    volunteersUntil: 24,
    events: [{ key: 'camion', label: 'Chargement du camion', start: 26, end: 28, headcount: 6 }],
  };

  // The orgas placed where they said, the way « Placer les déclarés » does it on the grid.
  const placeDeclared = (phase: Phase): Phase => {
    const assignments: PhaseAssignment[] = [];
    for (const person of phasePeople(phase, organisers, volunteers)) {
      for (const want of declaredPlacements(person)) {
        assignments.push({
          key: `${person.key}-${want.poleKey}-${Math.round(want.start)}`,
          personKind: person.kind,
          personKey: person.key,
          poleKey: want.poleKey,
          eventKey: '',
          start: want.start,
          end: want.end,
        });
      }
    }
    return { ...phase, assignments };
  };
  montage = placeDeclared(montage);
  demontage = placeDeclared(demontage);

  // Three bénévoles who said yes, placed by hand on the montage's last day, in Général.
  const willing = volunteers.filter((v) => v.montage.present).slice(0, 3);
  montage = {
    ...montage,
    assignments: [
      ...montage.assignments,
      ...willing.map((v, i) => ({
        key: `${v.key}-general-main-${i}`,
        personKind: 'benevole' as const,
        personKey: v.key,
        poleKey: GENERAL_POLE_KEY,
        eventKey: '',
        // 13h to 18h the day before the event: the montage starts at the event's hour two days
        // earlier, so its second day begins at hour 24 and 13h is one hour past it.
        start: montage.lengthHours - 24 + 1,
        end: montage.lengthHours - 24 + 6,
      })),
    ],
  };

  const [first, ...rest] = plan.artists;
  const lead = organisers[0];
  const artists = first
    ? [
        {
          ...first,
          size: 4,
          changeoverBefore: 0.5,
          changeoverAfter: 0.25,
          soundcheckNeeded: true,
          // 16h to 18h the afternoon before the doors open: hours of the montage.
          soundcheckStart: -20,
          soundcheckEnd: -18,
          soundcheckEngineer: true,
          trainTickets: 2,
          trainCost: 178.4,
          contactPhone: '06 45 67 89 01',
          patchSize: 12,
          technicalNeeds: '2 DI, 1 retour casque, une table pour le contrôleur',
          extraGuests: [
            { key: `${first.key}-g1`, firstName: 'Camille', lastName: 'Perrot' },
            { key: `${first.key}-g2`, firstName: 'Ismaël', lastName: 'Dray' },
          ],
          carTrips: [
            makeCarTrip({ key: `${first.key}-t1`, fromAddress: 'Lyon', fuel: 'diesel', consumptionPer100: 6.5, distanceKm: 145, cost: 30.5 }),
          ],
          members: [
            makeArtistMember({
              key: `${first.key}-m1`,
              firstName: 'Lou',
              lastName: 'Marin',
              diet: 'Végétarien',
              guests: [{ key: `${first.key}-m1-g1`, firstName: 'Noa', lastName: 'Marin' }],
            }),
            makeArtistMember({
              key: `${first.key}-m2`,
              role: 'technicien',
              linkedKind: lead ? 'orga' : null,
              linkedKey: lead?.key ?? '',
              firstName: lead?.firstName ?? '',
              lastName: lead?.lastName ?? '',
            }),
          ],
        },
        ...rest,
      ]
    : plan.artists;

  return {
    ...plan,
    address: '12 rue de la Salle des fêtes, 74000 Annecy',
    organisers,
    artists,
    montage,
    demontage,
    catering: { ...plan.catering, rules: { ...plan.catering.rules, enabled: true } },
    // The door: the Loto Tekno's two kinds of entry, three bracelets, a sound engineer hired
    // for the night, and one ticket chosen by hand so the incohérence has something to say.
    ticketing: {
      guestsPerArtist: 1,
      ticketTypes: [
        { key: 'loto', label: 'Loto seulement', start: 0, end: 8 },
        { key: 'soiree', label: 'Soirée seulement', start: 8, end: plan.lengthHours },
        { key: 'full', label: 'Pass complet', start: 0, end: plan.lengthHours },
      ],
      bracelets: [
        { key: 'basique', label: 'Bracelet basique', defaultFor: ['benevole'] },
        { key: 'backstage', label: 'Bracelet backstage', defaultFor: ['artiste', 'invite-artiste', 'orga'] },
        { key: 'all', label: 'Bracelet all inclusive', defaultFor: ['responsable'] },
      ],
      extras: [
        { key: 'extra-1', firstName: 'Pat', lastName: 'Lumière', status: 'prestataire', phone: '06 12 34 56 78', drinkTickets: 4, mealTickets: 2 },
        { key: 'extra-2', firstName: 'Élise', lastName: 'Mairie', status: 'autre', phone: '', drinkTickets: 2, mealTickets: 0 },
      ],
      choices: first
        ? [
            { personKind: 'artiste', personKey: `${first.key}-m1`, ticketTypeKey: 'soiree', braceletKey: null, drinkTickets: null, note: '' },
            { personKind: 'extra', personKey: 'extra-1', ticketTypeKey: null, braceletKey: null, drinkTickets: null, note: 'Régie lumière, arrive à 14h' },
          ]
        : [],
    },
  };
}
