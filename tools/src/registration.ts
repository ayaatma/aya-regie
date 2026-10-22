/**
 * La validation des inscriptions, 2026-10-22: everybody the plan holds, whatever their kind, is
 * « Inscription » until the régisseur validates them, and the validation sends a mail whose text
 * depends on who they are.
 *
 * FOUR KINDS OF PERSON CARRY A STATUS: bénévoles (`Volunteer.status`, since 2026-09-15), orgas,
 * members of an act and extra people (`applicationStatus`, since 2026-10-22). A guest of an act
 * does not: they are a name on the door's list, let in on the act's word, and nobody writes to
 * them. Being in « Inscription » never stops anybody being placed; the grids only mark it.
 *
 * THE MESSAGE IS RENDERED HERE, IN THE BROWSER, AND SENT AS IS. The server function only sends
 * and records; it never sees the plan. So the preview the régisseur reads is exactly what leaves.
 *
 * Pure, like the rest of the engine: no clock, no network.
 */

import {
  applicationStatusOf,
  statusOf,
  type ApplicationStatus,
  type MailAudience,
  type MailTemplate,
} from './model.js';
import type { Plan } from './plan.js';
import { planningText } from './followup.js';

/** Who a status belongs to. Same words as `TicketPersonKind`, minus the guests. */
export type RegistrantKind = 'benevole' | 'orga' | 'artiste' | 'extra';

export interface Registrant {
  kind: RegistrantKind;
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  status: ApplicationStatus;
  audience: MailAudience;
  /** The bénévole's or the orga's access code; empty for the others. */
  accessCode: string;
  /** The act's name for a member of one; empty for the others. */
  actName: string;
  /** The hours a bénévole asked for; zero for the others. */
  requestedHours: number;
}

export const MAIL_AUDIENCE_LABEL: Record<MailAudience, string> = {
  benevole: 'Bénévole',
  orga: 'Orga',
  responsable: 'Responsable de pôle',
  artiste: 'Artiste',
  prestataire: 'Prestataire',
  autre: 'Autre invitation',
};

/** Everybody who can be validated, in the order the Personnes tab lists them. */
export function registrants(plan: Plan): Registrant[] {
  const leaders = new Set(plan.leaderRoles.map((r) => r.organiserKey));
  const out: Registrant[] = [];
  for (const v of plan.volunteers) {
    out.push({
      kind: 'benevole', key: v.key, firstName: v.firstName, lastName: v.lastName, email: v.email,
      status: statusOf(v), audience: 'benevole', accessCode: v.accessCode ?? '', actName: '',
      requestedHours: v.requestedHours ?? 0,
    });
  }
  for (const o of plan.organisers) {
    out.push({
      kind: 'orga', key: o.key, firstName: o.firstName, lastName: o.lastName, email: o.email,
      status: applicationStatusOf(o), audience: leaders.has(o.key) ? 'responsable' : 'orga',
      accessCode: o.accessCode, actName: '', requestedHours: 0,
    });
  }
  for (const a of plan.artists) {
    for (const m of a.members) {
      out.push({
        kind: 'artiste', key: m.key, firstName: m.firstName, lastName: m.lastName, email: m.email ?? '',
        status: applicationStatusOf(m), audience: 'artiste', accessCode: '', actName: a.name,
        requestedHours: 0,
      });
    }
  }
  for (const x of plan.ticketing.extras) {
    out.push({
      kind: 'extra', key: x.key, firstName: x.firstName, lastName: x.lastName, email: x.email ?? '',
      status: applicationStatusOf(x), audience: x.status, accessCode: '', actName: '',
      requestedHours: 0,
    });
  }
  return out;
}

export function registrantOf(plan: Plan, kind: RegistrantKind, key: string): Registrant | null {
  return registrants(plan).find((r) => r.kind === kind && r.key === key) ?? null;
}

/**
 * One person's status, whatever their kind. Changes nothing else: validating places nobody,
 * cancelling removes nobody (see `applicationEdits.ts` for what a cancelled bénévole becomes).
 */
export function setRegistrationStatus(plan: Plan, kind: RegistrantKind, key: string, status: ApplicationStatus): Plan {
  switch (kind) {
    case 'benevole':
      return { ...plan, volunteers: plan.volunteers.map((v) => (v.key === key ? { ...v, status } : v)) };
    case 'orga':
      return {
        ...plan,
        organisers: plan.organisers.map((o) => (o.key === key ? { ...o, applicationStatus: status } : o)),
      };
    case 'artiste':
      return {
        ...plan,
        artists: plan.artists.map((a) =>
          a.members.some((m) => m.key === key)
            ? { ...a, members: a.members.map((m) => (m.key === key ? { ...m, applicationStatus: status } : m)) }
            : a,
        ),
      };
    case 'extra':
      return {
        ...plan,
        ticketing: {
          ...plan.ticketing,
          extras: plan.ticketing.extras.map((x) => (x.key === key ? { ...x, applicationStatus: status } : x)),
        },
      };
  }
}

/** The blanks a message may hold, in the order Réglages lists them. */
export const MAIL_PLACEHOLDERS: readonly { token: string; label: string }[] = [
  { token: '{prenom}', label: 'Prénom' },
  { token: '{nom}', label: 'Nom' },
  { token: '{evenement}', label: "Nom de l'événement" },
  { token: '{date}', label: "Date de l'événement" },
  { token: '{lieu}', label: 'Adresse du lieu' },
  { token: '{groupe}', label: 'Nom du groupe (artistes)' },
  { token: '{code}', label: "Code d'accès (bénévoles et orgas)" },
  { token: '{lien}', label: 'Lien personnel: planning et réponses (bénévoles), planning (orgas)' },
  { token: '{heures}', label: 'Heures demandées (bénévoles)' },
  { token: '{planning}', label: 'Ses créneaux, un par ligne (bénévoles et orgas)' },
];

/*
 * The defaults. Tutoiement for the people of the association, vouvoiement for the acts and the
 * prestataires, who are not. No gendered agreement anywhere: half the people written to are
 * women, and « validée » agrees with « inscription », not with them.
 */
export const DEFAULT_MAIL_TEMPLATES: Record<MailAudience, MailTemplate> = {
  benevole: {
    subject: '{evenement} : ton inscription bénévole est validée',
    body:
      'Bonjour {prenom},\n\n' +
      'Bonne nouvelle : ton inscription comme bénévole pour {evenement} ({date}) est validée. ' +
      "Merci de rejoindre l'équipe !\n\n" +
      'Ton planning personnel sera consultable ici : {lien}\n' +
      "(ton code d'accès, si on te le demande : {code})\n" +
      "Il peut encore bouger d'ici l'événement, on te prévient quand il est définitif.\n\n" +
      'À très vite,\n' +
      "L'équipe d'organisation",
  },
  orga: {
    subject: "{evenement} : bienvenue dans l'orga",
    body:
      'Bonjour {prenom},\n\n' +
      "Ta participation à l'organisation de {evenement} ({date}) est confirmée. Merci !\n\n" +
      'Le planning complet est consultable sur {lien} avec ton code : {code}\n' +
      'Ce code ouvre les coordonnées de tout le monde : garde-le pour toi.\n\n' +
      'À très vite,\n' +
      "L'équipe d'organisation",
  },
  responsable: {
    subject: '{evenement} : ta place de responsable de pôle est confirmée',
    body:
      'Bonjour {prenom},\n\n' +
      'Ta place de responsable de pôle pour {evenement} ({date}) est confirmée. Merci de porter ça avec nous !\n\n' +
      'Le planning complet, et celui de ton pôle, est consultable sur {lien} avec ton code : {code}\n' +
      'Ce code ouvre les coordonnées de tout le monde : garde-le pour toi.\n\n' +
      'À très vite,\n' +
      "L'équipe d'organisation",
  },
  artiste: {
    subject: '{evenement} : confirmation de la venue de {groupe}',
    body:
      'Bonjour {prenom},\n\n' +
      'Nous confirmons la venue de {groupe} à {evenement}, le {date}, {lieu}.\n' +
      'Nous revenons vers vous rapidement avec les informations pratiques : horaires, accueil, repas.\n\n' +
      'Au plaisir de vous accueillir,\n' +
      "L'équipe d'organisation",
  },
  prestataire: {
    subject: '{evenement} : confirmation de votre intervention',
    body:
      'Bonjour {prenom},\n\n' +
      'Nous confirmons votre intervention pour {evenement}, le {date}, {lieu}.\n' +
      'Nous revenons vers vous avec les informations pratiques.\n\n' +
      'Cordialement,\n' +
      "L'équipe d'organisation",
  },
  autre: {
    subject: '{evenement} : votre invitation est confirmée',
    body:
      'Bonjour {prenom},\n\n' +
      'Votre invitation pour {evenement}, le {date}, {lieu}, est confirmée.\n\n' +
      'Au plaisir de vous accueillir,\n' +
      "L'équipe d'organisation",
  },
};

/** The message an audience gets on this event: the régisseur's text, else the default. */
export function mailTemplateFor(plan: Pick<Plan, 'mailTemplates'>, audience: MailAudience): MailTemplate {
  return plan.mailTemplates[audience] ?? DEFAULT_MAIL_TEMPLATES[audience];
}

/**
 * Stores a rewritten message, or forgets it when it is the default again: a template equal to
 * the default is not a disagreement, and storing it would freeze today's default into the event.
 */
export function withMailTemplate(
  templates: Partial<Record<MailAudience, MailTemplate>>,
  audience: MailAudience,
  template: MailTemplate | null,
): Partial<Record<MailAudience, MailTemplate>> {
  const next = { ...templates };
  const fallback = DEFAULT_MAIL_TEMPLATES[audience];
  if (template === null || (template.subject === fallback.subject && template.body === fallback.body)) {
    delete next[audience];
  } else {
    next[audience] = template;
  }
  return next;
}

/** « samedi 13 mars 2027 », in the event's own time zone. */
export function eventDateLabel(startISO: string): string {
  const date = new Date(startISO);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
  }).format(date);
}

export interface RenderedMail {
  to: string;
  subject: string;
  body: string;
  /** The blanks that were in the message and had nothing to put in them, e.g. `{code}`. */
  empty: string[];
}

/** The validation message of one person, filled. See `renderTemplate`. */
export function renderMail(
  plan: Pick<Plan, 'name' | 'startISO' | 'address' | 'mailTemplates'>,
  person: Registrant,
  siteUrl: string,
): RenderedMail {
  return renderTemplate(plan, person, mailTemplateFor(plan, person.audience), siteUrl);
}

/** « 6 » or « 4,5 », for a blank. */
const hoursText = (hours: number): string => (Number.isInteger(hours) ? String(hours) : String(hours).replace('.', ','));

/**
 * Fills any message for one person. `siteUrl` is where the tool is served (`location.origin`).
 *
 * `{lien}` IS PERSONAL since 2026-10-22: a bénévole's carries their code (`/?code=`), so the page
 * opens on their planning and their questions without typing anything; an orga's opens the
 * orgas' door. `{planning}` is only computed when the message holds it, and needs the whole plan.
 */
export function renderTemplate(
  plan: Pick<Plan, 'name' | 'startISO' | 'address'>,
  person: Registrant,
  template: MailTemplate,
  siteUrl: string,
): RenderedMail {
  const base = siteUrl.replace(/\/+$/, '');
  const holdsCode = person.kind === 'benevole' || person.kind === 'orga';
  const values: Record<string, string> = {
    '{prenom}': person.firstName.trim(),
    '{nom}': person.lastName.trim(),
    '{evenement}': plan.name.trim(),
    '{date}': eventDateLabel(plan.startISO),
    '{lieu}': plan.address.trim(),
    '{groupe}': person.actName.trim(),
    '{code}': person.accessCode.trim(),
    '{lien}':
      !holdsCode || base === ''
        ? ''
        : person.kind === 'orga'
          ? `${base}/?responsable`
          : person.accessCode.trim() === ''
            ? `${base}/`
            : `${base}/?code=${encodeURIComponent(person.accessCode.trim())}`,
    '{heures}': person.kind === 'benevole' && person.requestedHours > 0 ? hoursText(person.requestedHours) : '',
  };
  if (`${template.subject}${template.body}`.includes('{planning}')) {
    values['{planning}'] = holdsCode ? planningText(plan as Plan, person.kind as 'benevole' | 'orga', person.key) : '';
  }
  const empty = new Set<string>();
  const fill = (text: string): string =>
    text.replace(/\{[a-z]+\}/g, (token) => {
      const value = values[token];
      if (value === undefined) return token;
      if (value === '') empty.add(token);
      return value;
    });
  return { to: person.email.trim(), subject: fill(template.subject), body: fill(template.body), empty: [...empty] };
}

/** Good enough to refuse a typo before a server does: one @, a dot after it, no space. */
export const isMailAddress = (text: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
