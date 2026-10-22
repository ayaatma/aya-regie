/**
 * Le suivi après la validation, 2026-10-22: the steps a validated bénévole goes through, each of
 * them a grouped mail the régisseur sends from the Mails tab, and what each person did with it.
 *
 * THE SEQUENCE IS THE EVENT'S (`Plan.applicationSteps`). The Loto Tekno's: « Heures
 * supplémentaires » (only those who asked for 6 h or more, a yes or a no), « Planning » (their own
 * créneaux, one button to confirm them), « Infos pratiques » (the last word, the final planning).
 * Another event writes its own; a step with no mail is a box ticked by hand, as before.
 *
 * WHAT HAPPENED IS NOT IN THE PLAN. The mails are rows of `mail_log`, the answers rows of
 * `step_reply`, both written at the moment they happen and read back by the app; a whole-plan save
 * from a stale tab must not be able to undo a mail that left. So this module takes them as plain
 * facts (`MailFact`, `ReplyFact`) and decides nothing but how to read them.
 *
 * A PLANNING SENT IS REMEMBERED AS TEXT. The mail's `{planning}` lines are stored beside it
 * (`MailFact.planning`); the planning today is computed again; the two differ when somebody was
 * moved after the mail left, and the person is then flagged for a new one. A confirmation counts
 * for the planning that was last sent: send a new one and the confirmation is asked again.
 *
 * Pure, like the rest of the engine: no clock, no network.
 */

import { statusOf, type ApplicationStep, type StepMail, type Volunteer } from './model.js';
import type { Plan } from './plan.js';

/*
 * ---------------------------------------------------------------------------------------------
 * One person's planning, as a mail says it.
 * ---------------------------------------------------------------------------------------------
 */

interface Line {
  at: number;
  text: string;
}

const PARIS = 'Europe/Paris';

const dayOf = (at: Date): string =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: PARIS }).format(at);

const clockOf = (at: Date): string => {
  const parts = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: PARIS })
    .formatToParts(at);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour}h${minute}`;
};

const atHour = (startISO: string, hours: number): Date => new Date(new Date(startISO).getTime() + hours * 3600_000);

const lineOf = (startISO: string, start: number, end: number, what: string): Line => {
  const from = atHour(startISO, start);
  const to = atHour(startISO, end);
  return { at: from.getTime(), text: `- ${dayOf(from)}, ${clockOf(from)} à ${clockOf(to)} : ${what}` };
};

export type PlannedKind = 'benevole' | 'orga';

/**
 * Every créneau of one bénévole or orga, the exploit and both phases together, in clock order:
 * « - samedi 13 mars, 14h00 à 18h00 : Bar / Caisse ». What `{planning}` becomes in a mail.
 */
export function planningLines(plan: Plan, kind: PlannedKind, key: string): string[] {
  const lines: Line[] = [];
  const poles = new Map((plan.poles ?? []).map((p) => [p.key, p.path]));
  const shifts = new Map((plan.shifts ?? []).map((s) => [s.key, s]));
  const shiftKeys =
    kind === 'benevole'
      ? (plan.assignments ?? []).filter((a) => a.volunteerKey === key).map((a) => a.shiftKey)
      : (plan.organiserShifts ?? []).filter((o) => o.organiserKey === key).map((o) => o.shiftKey);
  for (const shiftKey of new Set(shiftKeys)) {
    const shift = shifts.get(shiftKey);
    if (shift) lines.push(lineOf(plan.startISO, shift.start, shift.end, poles.get(shift.poleKey) ?? shift.poleKey));
  }
  if (kind === 'orga') {
    for (const role of plan.leaderRoles ?? []) {
      if (role.organiserKey !== key || role.start === null || role.end === null) continue;
      lines.push(lineOf(plan.startISO, role.start, role.end, `${poles.get(role.poleKey) ?? role.poleKey} (responsable)`));
    }
  }
  for (const phase of [plan.montage, plan.demontage]) {
    if (!phase?.enabled) continue;
    const phasePoles = new Map(phase.poles.map((p) => [p.key, p.name]));
    const events = new Map(phase.events.map((e) => [e.key, e.label]));
    for (const a of phase.assignments) {
      if (a.personKind !== kind || a.personKey !== key) continue;
      const where = a.eventKey !== '' ? events.get(a.eventKey) ?? '' : phasePoles.get(a.poleKey) ?? '';
      lines.push(lineOf(phase.startISO, a.start, a.end, where === '' ? phase.label : `${phase.label}, ${where}`));
    }
  }
  return lines.sort((a, b) => a.at - b.at || a.text.localeCompare(b.text)).map((l) => l.text);
}

/** The same, as the block a mail holds. Empty for somebody placed nowhere. */
export const planningText = (plan: Plan, kind: PlannedKind, key: string): string => planningLines(plan, kind, key).join('\n');

/** Whether somebody holds anything: a créneau, a responsable's window, a box on a phase. */
export const isPlaced = (plan: Plan, kind: PlannedKind, key: string): boolean => planningLines(plan, kind, key).length > 0;

/*
 * ---------------------------------------------------------------------------------------------
 * Who a step is for.
 * ---------------------------------------------------------------------------------------------
 */

/** Whether the mail says something about the person's créneaux, which can then go stale. */
export const usesPlanning = (mail: StepMail): boolean => `${mail.subject}${mail.body}`.includes('{planning}');

/**
 * Whether a bénévole is one a step's mail is for: validated, and inside its target. Being
 * cancelled, or still an inscription, always leaves somebody out.
 */
export function inTarget(plan: Plan, step: ApplicationStep, volunteer: Volunteer): boolean {
  if (!step.mail || statusOf(volunteer) !== 'valide') return false;
  if (step.mail.minRequestedHours > 0 && (volunteer.requestedHours ?? 0) < step.mail.minRequestedHours) return false;
  if (step.mail.placedOnly && !isPlaced(plan, 'benevole', volunteer.key)) return false;
  return true;
}

/** « Validé·es placé·es, 6 h demandées ou plus », for the head of a step. */
export function targetLabel(mail: StepMail): string {
  const parts = ['Bénévoles validé·es'];
  if (mail.placedOnly) parts.push('avec au moins un créneau');
  if (mail.minRequestedHours > 0) parts.push(`ayant demandé ${mail.minRequestedHours} h ou plus`);
  return parts.join(', ');
}

/**
 * The bénévoles still in « Inscription » who hold a place, and the orgas likewise: who the
 * button « Valider les personnes placées » validates, named one by one before it does.
 */
export function placedPending(plan: Plan): Array<{ kind: PlannedKind; key: string }> {
  const out: Array<{ kind: PlannedKind; key: string }> = [];
  for (const v of plan.volunteers ?? []) {
    if (statusOf(v) === 'candidature' && isPlaced(plan, 'benevole', v.key)) out.push({ kind: 'benevole', key: v.key });
  }
  for (const o of plan.organisers ?? []) {
    if ((o.applicationStatus ?? 'candidature') === 'candidature' && isPlaced(plan, 'orga', o.key)) out.push({ kind: 'orga', key: o.key });
  }
  return out;
}

/*
 * ---------------------------------------------------------------------------------------------
 * What happened, read.
 * ---------------------------------------------------------------------------------------------
 */

/** A row of `mail_log` for one step, as this module needs it. */
export interface MailFact {
  id: number;
  stepKey: string;
  outcome: 'envoye' | 'echec';
  /** ISO. */
  sentAt: string;
  /** The `{planning}` lines the mail carried; empty when it carried none. */
  planning: string;
}

/** A row of `step_reply`: given from the personal page (`lien`) or noted by the régie. */
export interface ReplyFact {
  stepKey: string;
  answer: 'oui' | 'non';
  /** ISO. */
  answeredAt: string;
  source: 'lien' | 'regie';
}

export type StepState =
  /** Not for this person, and nothing ever sent to them. */
  | 'hors-cible'
  | 'a-envoyer'
  /** Tried, never accepted by the mail server. */
  | 'echec'
  /** Sent, and nothing to answer. */
  | 'envoye'
  | 'en-attente'
  | 'oui'
  | 'non'
  /** Ticked by hand: done outside the tool. */
  | 'fait-main';

export interface StepProgress {
  step: ApplicationStep;
  volunteerKey: string;
  state: StepState;
  inTarget: boolean;
  /** The last mail the server accepted for this step. */
  lastSent: MailFact | null;
  /** The last try, accepted or not. */
  lastTry: MailFact | null;
  reply: ReplyFact | null;
  /** The créneaux are no longer those of the last mail sent. Only for a mail holding them. */
  planningChanged: boolean;
}

const newestFirst = <T extends { at: string }>(a: T, b: T): number => b.at.localeCompare(a.at);

/**
 * Where one bénévole stands on one step. `mails` and `replies` are this person's, any order.
 *
 * A REPLY COUNTS FOR THE PLANNING IT ANSWERED: for a mail holding `{planning}`, an answer older
 * than the last mail sent is an answer to an older planning and is not this one's. For any other
 * step, the latest answer stands, whenever it came.
 */
export function stepProgress(
  plan: Plan,
  step: ApplicationStep,
  volunteer: Volunteer,
  mails: readonly MailFact[],
  replies: readonly ReplyFact[],
): StepProgress {
  const mine = mails
    .filter((m) => m.stepKey === step.key)
    .map((m) => ({ ...m, at: m.sentAt }))
    .sort(newestFirst);
  const lastTry = mine[0] ?? null;
  const lastSent = mine.find((m) => m.outcome === 'envoye') ?? null;
  const target = inTarget(plan, step, volunteer);
  const ticked = (volunteer.statusSteps ?? []).includes(step.key);
  const planningBound = step.mail !== undefined && usesPlanning(step.mail);
  const latest =
    replies
      .filter((r) => r.stepKey === step.key)
      .map((r) => ({ ...r, at: r.answeredAt }))
      .sort(newestFirst)[0] ?? null;
  const reply =
    latest && !(planningBound && lastSent !== null && latest.answeredAt < lastSent.sentAt) ? latest : null;
  const planningChanged =
    planningBound && lastSent !== null && lastSent.planning !== planningText(plan, 'benevole', volunteer.key);

  let state: StepState;
  const wantsReply = step.mail !== undefined && step.mail.reply !== 'aucune';
  if (wantsReply && reply) state = reply.answer;
  else if (lastSent) state = wantsReply ? 'en-attente' : 'envoye';
  else if (ticked) state = 'fait-main';
  else if (!target) state = 'hors-cible';
  else if (!step.mail) state = 'a-envoyer';
  else state = lastTry?.outcome === 'echec' ? 'echec' : 'a-envoyer';

  const strip = <T extends { at: string }>(m: T | null): Omit<T, 'at'> | null => {
    if (!m) return null;
    const { at: _at, ...rest } = m;
    return rest;
  };
  return {
    step,
    volunteerKey: volunteer.key,
    state,
    inTarget: target,
    lastSent: strip(lastSent) as MailFact | null,
    lastTry: strip(lastTry) as MailFact | null,
    reply: strip(reply) as ReplyFact | null,
    planningChanged,
  };
}

/** The words for a state, after the step's label: « Planning : confirmé ». */
export function stateLabel(progress: StepProgress): string {
  const reply = progress.step.mail?.reply ?? 'aucune';
  switch (progress.state) {
    case 'hors-cible':
      return 'pas concerné·e';
    case 'a-envoyer':
      return progress.step.mail ? 'à envoyer' : 'à faire';
    case 'echec':
      return "échec de l'envoi";
    case 'envoye':
      return 'envoyé';
    case 'en-attente':
      return 'envoyé, sans réponse';
    case 'oui':
      return reply === 'confirmer' ? 'confirmé' : 'oui';
    case 'non':
      return 'non';
    case 'fait-main':
      return 'fait';
  }
}

export type Tone = 'muted' | 'warn' | 'ok' | 'bad';

export interface FollowUpMark {
  label: string;
  tone: Tone;
}

export interface FollowUp {
  /** Where the person is on the main line: the furthest step reached, or their status. */
  stage: FollowUpMark;
  /** The conditional steps (a minimum of hours), beside the line rather than on it. */
  badges: FollowUpMark[];
  /** What needs the régie: a failed mail, a « non », a planning that moved. They add up. */
  alerts: FollowUpMark[];
  steps: StepProgress[];
}

const REACHED: ReadonlySet<StepState> = new Set(['envoye', 'en-attente', 'oui', 'non', 'fait-main']);

const toneOf = (state: StepState): Tone =>
  state === 'oui' || state === 'envoye' || state === 'fait-main'
    ? 'ok'
    : state === 'non' || state === 'echec'
      ? 'bad'
      : state === 'en-attente'
        ? 'warn'
        : 'muted';

/**
 * One bénévole's whole follow-up, as a frise rather than a list of boxes: « Planning : confirmé »
 * already says validated and mailed, so it is the only thing shown, and the rest is in the steps.
 */
export function followUpOf(
  plan: Plan,
  volunteer: Volunteer,
  mails: readonly MailFact[],
  replies: readonly ReplyFact[],
): FollowUp {
  const steps = (plan.applicationSteps ?? []).map((step) => stepProgress(plan, step, volunteer, mails, replies));
  const status = statusOf(volunteer);
  let stage: FollowUpMark =
    status === 'valide'
      ? { label: 'Validé·e', tone: 'ok' }
      : status === 'annule'
        ? { label: 'Annulé·e', tone: 'bad' }
        : { label: 'Inscription', tone: 'warn' };
  const badges: FollowUpMark[] = [];
  const alerts: FollowUpMark[] = [];
  for (const progress of steps) {
    const conditional = (progress.step.mail?.minRequestedHours ?? 0) > 0;
    const label = `${progress.step.label} : ${stateLabel(progress)}`;
    if (conditional) {
      // Only once something happened: « à envoyer » on sixty rows says nothing about any of them.
      if (progress.state !== 'hors-cible' && progress.state !== 'a-envoyer') badges.push({ label, tone: toneOf(progress.state) });
    } else if (status !== 'annule' && REACHED.has(progress.state)) {
      stage = { label, tone: toneOf(progress.state) };
    }
    if (progress.state === 'echec') alerts.push({ label: `${progress.step.label} : échec de l'envoi`, tone: 'bad' });
    if (progress.state === 'non' && !conditional) alerts.push({ label: `${progress.step.label} : a répondu non`, tone: 'bad' });
    if (progress.planningChanged) {
      alerts.push({
        label: progress.reply
          ? `Planning modifié depuis sa confirmation (${progress.step.label})`
          : `Planning modifié depuis l'envoi (${progress.step.label})`,
        tone: 'warn',
      });
    }
  }
  return { stage, badges, alerts, steps };
}

/*
 * ---------------------------------------------------------------------------------------------
 * Who a grouped sending goes to.
 * ---------------------------------------------------------------------------------------------
 */

export type BatchKind = 'premier' | 'relance' | 'modifie';

/**
 * The three sendings a step offers, each to a list the régisseur reads before it leaves:
 * `premier` to whoever is in the target and never got it (or only failures), `relance` to whoever
 * got it and has not answered, `modifie` to whoever got a planning that has moved since.
 */
export function batchMembers(progress: readonly StepProgress[], kind: BatchKind): StepProgress[] {
  switch (kind) {
    case 'premier':
      return progress.filter((p) => p.inTarget && (p.state === 'a-envoyer' || p.state === 'echec'));
    case 'relance':
      return progress.filter((p) => p.inTarget && p.state === 'en-attente' && !p.planningChanged);
    case 'modifie':
      return progress.filter((p) => p.inTarget && p.planningChanged);
  }
}

/** A step's mail filled with the defaults of `DEFAULT_APPLICATION_STEPS`, for « Envoi par mail ». */
export const blankStepMail = (): StepMail => ({
  subject: '{evenement} : ',
  body: 'Bonjour {prenom},\n\n\n\nÀ très vite,\n' + "L'équipe d'organisation",
  placedOnly: true,
  minRequestedHours: 0,
  reply: 'aucune',
  question: '',
});
