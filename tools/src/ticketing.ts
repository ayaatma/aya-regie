/**
 * La billetterie: everybody who gets in without a ticket, and what the door hands each of them.
 *
 * WHO READS THIS. The people at the entrance, on the night, with a list and a box of bracelets.
 * They need one line per person: the name they will be asked for, why this person gets in,
 * how many drink and meal tickets to hand over, which kind of entry it is worth and which
 * bracelet goes on the wrist. Everything below is aimed at that line and stops there.
 *
 * ONE PERSON, ONE LINE, like the catering: an orga who plays in a band is one row with two
 * statuses, and their tickets are the catering's own figures for that row (see `catering.ts`
 * for how two statuses are settled: the artist's effects, or both when the event says the
 * tickets are cumulative).
 *
 * NOTHING HERE IS STORED. The list is computed from the people, the acts and the catering every
 * time it is read; only a ticket or a bracelet the régisseur chose against the default is kept
 * (`TicketingChoice`), which is the doctrine of every other part of the plan.
 *
 * See `.claude/memory/feature_ticketing.md` for the brief this comes from.
 */

import {
  PERSON_STATUS_LABEL,
  type BraceletType,
  type PersonStatus,
  type TicketPersonKind,
  type TicketType,
  type TicketingChoice,
} from './model.js';
import { type Plan, PlanIndex } from './plan.js';
import { artistGuests, artistMemberName, memberIsLinked } from './artists.js';
import { cateringReport, type CateringPerson, type MealService } from './catering.js';
import { toCsv } from './csv.js';
import { toClock } from './model.js';

/** One status of a person, with the act it comes from when it does. */
export interface StatusTag {
  status: PersonStatus;
  /** "Artiste: Nashkø", "Invité de Nashkø", "Bénévole". */
  label: string;
}

export interface TicketingRow {
  kind: TicketPersonKind;
  key: string;
  lastName: string;
  firstName: string;
  phone: string;
  statuses: StatusTag[];
  drinks: number;
  /** True when the drinks figure is the régisseur's, not the computed one. */
  drinksByHand: boolean;
  /** What the rules hand this person, whatever the régisseur typed: the field's placeholder. */
  computedDrinks: number;
  meals: number;
  /** The door's remark on this person, typed on the billetterie. */
  note: string;
  /** The ticket this person gets, by key, or null when the event has none. */
  ticketTypeKey: string | null;
  ticketByHand: boolean;
  braceletKey: string | null;
  braceletByHand: boolean;
  /** What does not add up, in French, one line each. Reported, never refused. */
  issues: string[];
}

export interface TicketingReport {
  rows: TicketingRow[];
  /** How many rows carry each status, for the filter's counts. */
  byStatus: Partial<Record<PersonStatus, number>>;
  ticketTypes: readonly TicketType[];
  bracelets: readonly BraceletType[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * The ticket everybody gets unless told otherwise: the one that opens the most of the event.
 *
 * Not "the first in the list" and not a flag in Réglages: the régisseur asked for types with a
 * window each, and the window is what makes one of them the obvious default. Two of equal
 * length: the first typed wins, which is what a régisseur reading the list expects.
 */
export function defaultTicketType(types: readonly TicketType[]): TicketType | null {
  let best: TicketType | null = null;
  for (const type of types) {
    if (best === null || type.end - type.start > best.end - best.start) best = type;
  }
  return best;
}

/**
 * The statuses in the order that decides a bracelet: the artist first, per the régisseur's
 * "on lui attribue par défaut les effets Artiste". A responsable outranks an orga, an orga a
 * bénévole; the guests and the extras come last because they never hold another status.
 */
export const STATUS_PRIORITY: readonly PersonStatus[] = [
  'artiste',
  'responsable',
  'orga',
  'benevole',
  'invite-artiste',
  'prestataire',
  'autre',
];

/** The bracelet a set of statuses gets by default: the first status, in priority, that any bracelet names. */
export function defaultBracelet(
  bracelets: readonly BraceletType[],
  statuses: readonly PersonStatus[],
): BraceletType | null {
  for (const status of STATUS_PRIORITY) {
    if (!statuses.includes(status)) continue;
    const bracelet = bracelets.find((b) => b.defaultFor.includes(status));
    if (bracelet) return bracelet;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

const choiceKey = (kind: TicketPersonKind, key: string): string => `${kind}|${key}`;

/**
 * Every meal of the exploit this person takes outside the window their ticket opens.
 *
 * The régisseur's own example: "un invité a un ticket Soirée uniquement (à partir de 20h) mais
 * est compté pour un repas le midi de l'événement". Only the exploit's services can contradict
 * a ticket: a montage lunch is not the event, and a ticket says nothing about it.
 */
function ticketIssues(
  ticket: TicketType | null,
  services: readonly MealService[],
  serviceKeys: readonly string[],
  startISO: string,
): string[] {
  if (!ticket) return [];
  const issues: string[] = [];
  for (const service of services) {
    if (!serviceKeys.includes(service.key)) continue;
    const window = service.inMoment.exploit;
    if (!window) continue;
    if (window.end <= ticket.start || window.start >= ticket.end) {
      issues.push(
        `repas ${service.label} hors du ticket « ${ticket.label} » ` +
          `(${toClock(startISO, ticket.start)} à ${toClock(startISO, ticket.end)})`,
      );
    }
  }
  return issues;
}

/**
 * Everybody the tool knows, one line each, sorted by name then first name.
 *
 * The catering is asked for the tickets rather than recomputed here, so the number on the door's
 * list is the number on the caterer's sheet: one rule, one figure. When the catering is off the
 * figures are zero for everybody the rules would have covered, and the extras keep what was typed
 * for them by hand.
 */
export function ticketingReport(plan: Plan, index: PlanIndex = new PlanIndex(plan)): TicketingReport {
  const settings = plan.ticketing;
  const catering = cateringReport(plan, index);
  const byPerson = new Map<string, CateringPerson>();
  for (const person of catering.people) byPerson.set(choiceKey(person.kind, person.key), person);

  const choices = new Map<string, TicketingChoice>();
  for (const choice of settings.choices) choices.set(choiceKey(choice.personKind, choice.personKey), choice);

  const fallbackTicket = defaultTicketType(settings.ticketTypes);
  const leaders = new Set(plan.leaderRoles.map((r) => r.organiserKey));

  const rows: TicketingRow[] = [];
  const push = (
    kind: TicketPersonKind,
    key: string,
    firstName: string,
    lastName: string,
    phone: string,
    statuses: StatusTag[],
    given: { drinks: number; meals: number; serviceKeys: readonly string[] },
    extraIssues: string[] = [],
  ): void => {
    const choice = choices.get(choiceKey(kind, key));
    const ticket =
      (choice?.ticketTypeKey && settings.ticketTypes.find((t) => t.key === choice.ticketTypeKey)) ||
      fallbackTicket;
    const bracelet =
      (choice?.braceletKey && settings.bracelets.find((b) => b.key === choice.braceletKey)) ||
      defaultBracelet(settings.bracelets, statuses.map((s) => s.status));
    rows.push({
      kind,
      key,
      firstName,
      lastName,
      phone,
      statuses,
      drinks: choice?.drinkTickets ?? given.drinks,
      computedDrinks: given.drinks,
      drinksByHand: choice?.drinkTickets !== null && choice?.drinkTickets !== undefined,
      meals: given.meals,
      note: choice?.note ?? '',
      ticketTypeKey: ticket?.key ?? null,
      ticketByHand: Boolean(choice?.ticketTypeKey && ticket && ticket.key === choice.ticketTypeKey),
      braceletKey: bracelet?.key ?? null,
      braceletByHand: Boolean(choice?.braceletKey && bracelet && bracelet.key === choice.braceletKey),
      issues: [
        ...extraIssues,
        ...ticketIssues(ticket, catering.services, given.serviceKeys, plan.startISO),
      ],
    });
  };

  const fed = (kind: TicketPersonKind, key: string) => {
    const person = byPerson.get(choiceKey(kind, key));
    return {
      drinks: person?.drinks ?? 0,
      meals: person?.serviceKeys.length ?? 0,
      serviceKeys: person?.serviceKeys ?? [],
    };
  };

  /** The acts somebody plays in, as status tags, through the members that name them. */
  const actTags = (kind: 'orga' | 'benevole', key: string): StatusTag[] =>
    plan.artists
      .filter((a) => a.members.some((m) => m.linkedKind === kind && m.linkedKey === key))
      .map((a) => ({ status: 'artiste' as const, label: `Artiste: ${a.name}` }));

  for (const o of plan.organisers) {
    const statuses: StatusTag[] = [{ status: 'orga', label: PERSON_STATUS_LABEL.orga }];
    if (leaders.has(o.key)) statuses.push({ status: 'responsable', label: PERSON_STATUS_LABEL.responsable });
    statuses.push(...actTags('orga', o.key));
    push('orga', o.key, o.firstName, o.lastName, o.phone, statuses, fed('orga', o.key));
  }

  for (const v of plan.volunteers) {
    const statuses: StatusTag[] = [
      { status: 'benevole', label: PERSON_STATUS_LABEL.benevole },
      ...actTags('benevole', v.key),
    ];
    push('benevole', v.key, v.firstName, v.lastName, v.phone, statuses, fed('benevole', v.key));
  }

  const acts = [...plan.artists].sort((a, b) => a.start - b.start);
  for (const artist of acts) {
    for (const member of artist.members) {
      // A member who is somebody else is on that person's row, with the act among their statuses.
      if (memberIsLinked(member, plan.organisers, plan.volunteers)) continue;
      const issues: string[] = [];
      if (member.guests.length > settings.guestsPerArtist) {
        issues.push(
          `${member.guests.length} invités pour ${settings.guestsPerArtist} prévu${settings.guestsPerArtist > 1 ? 's' : ''} par artiste`,
        );
      }
      push(
        'artiste',
        member.key,
        member.firstName,
        member.lastName || (member.firstName === '' ? artistMemberName(artist, member) : ''),
        '',
        [{ status: 'artiste', label: `Artiste: ${artist.name}` }],
        fed('artiste', member.key),
        issues,
      );
    }
    for (const { guest } of artistGuests(artist)) {
      push(
        'invite',
        guest.key,
        guest.firstName,
        guest.lastName,
        '',
        [{ status: 'invite-artiste', label: `Invité de ${artist.name}` }],
        { drinks: 0, meals: 0, serviceKeys: [] },
      );
    }
  }

  for (const extra of settings.extras) {
    push(
      'extra',
      extra.key,
      extra.firstName,
      extra.lastName,
      extra.phone,
      [{ status: extra.status, label: PERSON_STATUS_LABEL[extra.status] }],
      { drinks: Math.max(0, extra.drinkTickets), meals: Math.max(0, extra.mealTickets), serviceKeys: [] },
    );
  }

  rows.sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' }) ||
      a.firstName.localeCompare(b.firstName, 'fr', { sensitivity: 'base' }),
  );

  const byStatus: Partial<Record<PersonStatus, number>> = {};
  for (const row of rows) {
    for (const tag of new Set(row.statuses.map((s) => s.status))) {
      byStatus[tag] = (byStatus[tag] ?? 0) + 1;
    }
  }

  return { rows, byStatus, ticketTypes: settings.ticketTypes, bracelets: settings.bracelets };
}

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

/**
 * The régisseur picking a ticket or a bracelet for somebody, as a new list of choices.
 *
 * A pick equal to the default is stored as null, and a row where both are null is dropped: the
 * default follows Réglages, and a stored copy of it would stop following.
 */
export function setTicketingChoice(
  plan: Plan,
  kind: TicketPersonKind,
  personKey: string,
  over: Partial<Pick<TicketingChoice, 'ticketTypeKey' | 'braceletKey' | 'drinkTickets' | 'note'>>,
  defaults: { ticketTypeKey: string | null; braceletKey: string | null; drinkTickets?: number },
): TicketingChoice[] {
  const rest = plan.ticketing.choices.filter(
    (c) => !(c.personKind === kind && c.personKey === personKey),
  );
  const current = plan.ticketing.choices.find(
    (c) => c.personKind === kind && c.personKey === personKey,
  );
  const ticketTypeKey =
    over.ticketTypeKey !== undefined ? over.ticketTypeKey : (current?.ticketTypeKey ?? null);
  const braceletKey =
    over.braceletKey !== undefined ? over.braceletKey : (current?.braceletKey ?? null);
  const drinkTickets =
    over.drinkTickets !== undefined ? over.drinkTickets : (current?.drinkTickets ?? null);
  const next: TicketingChoice = {
    personKind: kind,
    personKey,
    ticketTypeKey: ticketTypeKey === defaults.ticketTypeKey ? null : ticketTypeKey,
    braceletKey: braceletKey === defaults.braceletKey ? null : braceletKey,
    // The computed figure typed back is the default again, not a decision.
    drinkTickets:
      drinkTickets !== null && defaults.drinkTickets !== undefined && drinkTickets === defaults.drinkTickets
        ? null
        : drinkTickets,
    note: (over.note !== undefined ? over.note : (current?.note ?? '')).trim(),
  };
  const empty =
    next.ticketTypeKey === null && next.braceletKey === null && next.drinkTickets === null && next.note === '';
  return empty ? rest : [...rest, next];
}

// ---------------------------------------------------------------------------
// The file the door is handed
// ---------------------------------------------------------------------------

/**
 * The list as a CSV, with or without the phone numbers.
 *
 * "Avec ou sans numéro de tel": the list goes to the people at the entrance, and a phone number
 * is personal data that a printed sheet lying on a table should not carry unless somebody
 * decided it should.
 */
export function ticketingCsv(
  plan: Plan,
  index: PlanIndex = new PlanIndex(plan),
  withPhones = false,
): string {
  const report = ticketingReport(plan, index);
  const ticketLabel = new Map(report.ticketTypes.map((t) => [t.key, t.label]));
  const braceletLabel = new Map(report.bracelets.map((b) => [b.key, b.label]));
  const headers = [
    'Nom',
    'Prénom',
    'Statut',
    'Tickets boisson',
    'Tickets repas',
    'Ticket',
    'Bracelet',
    ...(withPhones ? ['Téléphone'] : []),
    'Remarques',
  ];
  const rows = report.rows.map((row) => [
    row.lastName,
    row.firstName,
    row.statuses.map((s) => s.label).join(' / '),
    String(row.drinks),
    String(row.meals),
    row.ticketTypeKey === null ? '' : (ticketLabel.get(row.ticketTypeKey) ?? row.ticketTypeKey),
    row.braceletKey === null ? '' : (braceletLabel.get(row.braceletKey) ?? row.braceletKey),
    ...(withPhones ? [row.phone] : []),
    [row.note, ...row.issues].filter((part) => part !== '').join(' · '),
  ]);
  return toCsv(headers, rows);
}
