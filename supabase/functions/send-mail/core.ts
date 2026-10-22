/**
 * Sending ONE mail (a validation, or since migration 36 a step of the follow-up), 2026-10-22: the pure part of the `send-mail` function.
 *
 * WHY A SERVER AT ALL. A browser cannot speak SMTP, and the mailbox's password must never reach
 * one. So the régisseur's browser renders the message (`tools/src/registration.ts`, the exact
 * text the preview showed) and hands it here; this function sends it through the association's
 * OVH mailbox, the one the login links already leave from, and records what happened in
 * `mail_log` as the régisseur, under row level security.
 *
 * WHAT IT REFUSES before any network: a body that is not an object, an address that is not one,
 * a line break in a header (the classic way to smuggle a Bcc into a mail), and sizes no
 * validation mail reaches. The rest is the mail server's to judge.
 *
 * PURE ON PURPOSE, like `../drive-photo/core.ts`: no Deno, no network, tested under Node in
 * `tools/src/send-mail.test.ts`.
 */

export type PersonKind = 'benevole' | 'orga' | 'artiste' | 'extra';
/**
 * A validation, a validation sent again, a step of the follow-up, a reminder of one, or a test:
 * the mail of one person sent to the régisseur's own address, which counts for nobody.
 */
export type SendReason = 'validation' | 'renvoi' | 'etape' | 'relance' | 'test';

const REASONS: readonly SendReason[] = ['validation', 'renvoi', 'etape', 'relance', 'test'];

export interface SendRequest {
  eventId: string;
  personKind: PersonKind;
  personKey: string;
  to: string;
  subject: string;
  body: string;
  reason: SendReason;
  /** The follow-up step (event.application_steps key); '' for a validation. */
  stepKey: string;
  /** The {planning} lines the mail carries, recorded beside it; '' when none. */
  planning: string;
}

export class RequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestError';
  }
}

const KINDS: readonly PersonKind[] = ['benevole', 'orga', 'artiste', 'extra'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

export const MAX_SUBJECT = 300;
export const MAX_BODY = 20_000;

/** Reads and checks what the browser sent. Throws `RequestError` with a French sentence. */
export function parseSendRequest(raw: unknown): SendRequest {
  if (raw === null || typeof raw !== 'object') throw new RequestError('Corps JSON attendu.');
  const r = raw as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');

  const eventId = text(r.eventId);
  if (!UUID.test(eventId)) throw new RequestError("Identifiant d'événement invalide.");
  const personKind = text(r.personKind) as PersonKind;
  if (!KINDS.includes(personKind)) throw new RequestError('Type de personne inconnu.');
  const personKey = text(r.personKey);
  if (personKey === '' || personKey.length > 200) throw new RequestError('Personne non précisée.');

  const to = text(r.to).trim();
  if (!ADDRESS.test(to)) throw new RequestError(`« ${to} » n'est pas une adresse e-mail valide.`);
  const subject = text(r.subject).trim();
  if (subject === '') throw new RequestError("Le mail n'a pas d'objet.");
  if (/[\r\n]/.test(subject)) throw new RequestError("L'objet du mail tient sur une seule ligne.");
  if (subject.length > MAX_SUBJECT) throw new RequestError(`L'objet dépasse ${MAX_SUBJECT} caractères.`);
  const body = text(r.body);
  if (body.trim() === '') throw new RequestError('Le mail est vide.');
  if (body.length > MAX_BODY) throw new RequestError(`Le mail dépasse ${MAX_BODY} caractères.`);
  const reason: SendReason = REASONS.includes(r.reason as SendReason) ? (r.reason as SendReason) : 'validation';
  const stepKey = text(r.stepKey).trim();
  if (stepKey.length > 100) throw new RequestError('Étape non reconnue.');
  if ((reason === 'etape' || reason === 'relance') && stepKey === '') throw new RequestError('Étape du suivi non précisée.');
  const planning = text(r.planning);
  if (planning.length > MAX_BODY) throw new RequestError(`Le planning dépasse ${MAX_BODY} caractères.`);

  return { eventId, personKind, personKey, to, subject, body, reason, stepKey, planning };
}

/** The mailbox, from the function's secrets. Null with the names of what is missing. */
export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  fromName: string;
  replyTo: string;
}

export function smtpSettings(env: (name: string) => string | undefined): SmtpSettings | { missing: string[] } {
  const get = (name: string): string => (env(name) ?? '').trim();
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'].filter((n) => get(n) === '');
  if (missing.length > 0) return { missing };
  const port = Number(get('SMTP_PORT') || '465');
  return {
    host: get('SMTP_HOST'),
    // 465, implicit TLS: Supabase's edge refuses outgoing 25 and 587.
    port: Number.isInteger(port) && port > 0 ? port : 465,
    user: get('SMTP_USER'),
    password: env('SMTP_PASSWORD') ?? '',
    // OVH refuses a sender other than the mailbox itself, so it is the default.
    from: get('SMTP_FROM') || get('SMTP_USER'),
    fromName: get('SMTP_FROM_NAME'),
    replyTo: get('SMTP_REPLY_TO'),
  };
}

/**
 * What a mail server's refusal says, in a sentence a régisseur can act on. The raw text is kept
 * after it, since it is what anybody helping will ask for.
 */
export function explainSmtpError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const code = (cause as { responseCode?: unknown } | null)?.responseCode;
  const lower = raw.toLowerCase();
  let reason = "Le serveur de mail a refusé l'envoi.";
  if (/auth|535|534/.test(lower) || code === 535) reason = "Le serveur de mail refuse l'identifiant ou le mot de passe de la boîte d'envoi.";
  else if (/recipient|550|553|mailbox unavailable|user unknown/.test(lower) || code === 550 || code === 553) reason = "Le serveur de mail refuse l'adresse du destinataire.";
  else if (/timeout|timed out|econnrefused|enotfound|getaddrinfo|connection/.test(lower)) reason = 'Le serveur de mail ne répond pas.';
  else if (/quota|rate|too many|421|452/.test(lower)) reason = "Le serveur de mail limite les envois pour l'instant: réessayer plus tard.";
  return `${reason} (${raw.slice(0, 300)})`;
}

/** The row `mail_log` receives, the same shape whatever the outcome. */
export function logRow(request: SendRequest, outcome: 'envoye' | 'echec', error: string) {
  return {
    event_id: request.eventId,
    person_kind: request.personKind,
    person_key: request.personKey,
    recipient: request.to,
    subject: request.subject,
    body: request.body,
    outcome,
    error,
    reason: request.reason,
    step_key: request.stepKey,
    planning: request.planning,
  };
}
