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
  BUILT_IN_AUDIENCES,
  applicationStatusOf,
  statusLabel,
  statusOf,
  type ApplicationStatus,
  type AudienceMail,
  type MailAudience,
  type MailKind,
  type MailSet,
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

export const MAIL_AUDIENCE_LABEL: Record<string, string> = {
  benevole: 'Bénévole',
  orga: 'Orga',
  responsable: 'Responsable de pôle',
  artiste: 'Artiste',
  prestataire: 'Prestataire',
  autre: 'Autre invitation',
};

/** Every kind a mail can be for on this event: the computed ones, then its guest types. */
export function audienceOptions(plan: Pick<Plan, 'ticketing'>): Array<{ key: MailAudience; label: string }> {
  return [
    ...BUILT_IN_AUDIENCES.map((key) => ({ key, label: MAIL_AUDIENCE_LABEL[key] ?? key })),
    ...plan.ticketing.guestTypes.map((g) => ({ key: g.key, label: g.label })),
  ];
}

/** The name of a kind, a guest type's included. */
export const audienceLabel = (plan: Pick<Plan, 'ticketing'>, audience: MailAudience): string =>
  MAIL_AUDIENCE_LABEL[audience] && BUILT_IN_AUDIENCES.includes(audience)
    ? MAIL_AUDIENCE_LABEL[audience]!
    : statusLabel(audience, plan.ticketing.guestTypes);

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
export const DEFAULT_MAIL_TEMPLATES: Record<string, MailTemplate> = {
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

const fromDefault = (key: string, audiences: MailAudience[]): AudienceMail => ({
  key,
  audiences,
  subject: DEFAULT_MAIL_TEMPLATES[key]!.subject,
  body: DEFAULT_MAIL_TEMPLATES[key]!.body,
});

/**
 * What every event starts with, since 2026-10-22. The validation: one mail per kind the tool
 * knows, the prestataire's, and one for the invitations (Partenaire and Autre invitation). The
 * cancellation: one for the team, tutoyée, one for everybody else, vouvoyée.
 */
export const DEFAULT_MAILS: Record<MailKind, readonly AudienceMail[]> = {
  validation: [
    fromDefault('benevole', ['benevole']),
    fromDefault('orga', ['orga']),
    fromDefault('responsable', ['responsable']),
    fromDefault('artiste', ['artiste']),
    fromDefault('prestataire', ['prestataire']),
    { ...fromDefault('autre', ['partenaire', 'autre']), key: 'invitation' },
  ],
  annulation: [
    {
      key: 'equipe',
      audiences: ['benevole', 'orga', 'responsable'],
      subject: '{evenement} : ton inscription est annulée',
      body:
        'Bonjour {prenom},\n\n' +
        "C'est noté : ta participation à {evenement} ({date}) est annulée. Merci de nous avoir prévenu·e·s.\n\n" +
        "S'il s'agit d'une erreur, il suffit de répondre à ce mail.\n\n" +
        'Peut-être à une prochaine fois,\n' +
        "L'équipe d'organisation",
    },
    {
      key: 'invites',
      audiences: ['artiste', 'partenaire', 'prestataire', 'autre'],
      subject: '{evenement} : annulation confirmée',
      body:
        'Bonjour {prenom},\n\n' +
        'Nous vous confirmons l’annulation de votre venue à {evenement}, le {date}.\n' +
        "S'il s'agit d'une erreur, il suffit de répondre à ce mail.\n\n" +
        'Cordialement,\n' +
        "L'équipe d'organisation",
    },
  ],
};

export const MAIL_KIND_LABEL: Record<MailKind, string> = { validation: 'Validation', annulation: 'Annulation' };

/** The event's mails of one kind: its own list once touched, the defaults until then. */
export const mailsOf = (plan: Pick<Plan, 'mailTemplates'>, kind: MailKind): readonly AudienceMail[] =>
  plan.mailTemplates[kind] ?? DEFAULT_MAILS[kind];

/** The mail one kind of person gets, or null when no mail of the list is for them. */
export function mailFor(plan: Pick<Plan, 'mailTemplates'>, kind: MailKind, audience: MailAudience): AudienceMail | null {
  return mailsOf(plan, kind).find((m) => m.audiences.includes(audience)) ?? null;
}

const sameMails = (a: readonly AudienceMail[], b: readonly AudienceMail[]): boolean =>
  a.length === b.length &&
  a.every(
    (m, i) =>
      m.key === b[i]!.key &&
      m.subject === b[i]!.subject &&
      m.body === b[i]!.body &&
      m.audiences.length === b[i]!.audiences.length &&
      m.audiences.every((x) => b[i]!.audiences.includes(x)),
  );

/**
 * Stores a list, or forgets it when it is the defaults again: a list equal to the defaults is not
 * a disagreement, and storing it would freeze today's defaults into the event.
 */
export function withMails(set: MailSet, kind: MailKind, mails: readonly AudienceMail[] | null): MailSet {
  const next: MailSet = { ...set };
  if (mails === null || sameMails(mails, DEFAULT_MAILS[kind])) delete next[kind];
  else next[kind] = mails.map((m) => ({ ...m, audiences: [...m.audiences] }));
  return next;
}

/**
 * Puts a kind of person on a mail, or takes it off. A KIND IS ON ONE MAIL AT MOST: putting it on
 * one takes it off the others, so who gets which text never depends on the order of the list.
 */
export function withAudience(
  mails: readonly AudienceMail[],
  mailKey: string,
  audience: MailAudience,
  on: boolean,
): AudienceMail[] {
  return mails.map((m) => {
    const without = m.audiences.filter((a) => a !== audience);
    if (m.key !== mailKey) return on ? { ...m, audiences: without } : m;
    return { ...m, audiences: on ? [...without, audience] : without };
  });
}

/** The kinds of this event no mail of the list is for: they get nothing, and the screen says so. */
export function audiencesWithoutMail(plan: Pick<Plan, 'mailTemplates' | 'ticketing'>, kind: MailKind): string[] {
  const covered = new Set(mailsOf(plan, kind).flatMap((m) => m.audiences));
  return audienceOptions(plan).filter((o) => !covered.has(o.key)).map((o) => o.label);
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

/**
 * The validation (or the cancellation) message of one person, filled. See `renderTemplate`.
 * Null when no mail of the event's list is for their kind.
 */
export function renderMail(
  plan: Pick<Plan, 'name' | 'startISO' | 'address' | 'mailTemplates'>,
  person: Registrant,
  siteUrl: string,
  kind: MailKind = 'validation',
): RenderedMail | null {
  const mail = mailFor(plan, kind, person.audience);
  return mail ? renderTemplate(plan, person, mail, siteUrl) : null;
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
