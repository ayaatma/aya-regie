/**
 * The mails, 2026-10-22: what was sent to whom, what the bénévoles answered, and sending more,
 * one at a time or as a grouped sending.
 *
 * NOT IN THE PLAN. A mail is a fact about the world, written by the `send-mail` function at the
 * moment it sends, into the table `mail_log`; an answer is written by `answer_step` when a
 * bénévole clicks, into `step_reply`. A whole-plan save from a tab opened before must not be able
 * to undo either. So this module reads both tables once per event, keeps a book every component
 * reads (the Personnes list draws a hundred rows, a fiche one), and appends to the book what each
 * send answers. « Actualiser » reads them again, for the answers that came in since.
 *
 * NEVER THROWS FROM A SEND. A send ends in an entry, sent or failed, and a failure the function
 * could not record (not deployed, no network) is recorded here, so « l'envoi a échoué » is
 * remembered on the person whatever broke. With the fixtures there is no server at all: the entry
 * is a failure saying so, kept in memory, which is also what the screenshots show.
 *
 * A GROUPED SENDING RUNS HERE, NOT IN A COMPONENT (`startBatch`), so leaving the Mails tab does not
 * stop it; closing the browser tab does, and starting it again sends only to whoever has not got
 * it, since the list is computed from the book. It sends one mail at a time, a pause between two,
 * and waits whenever the last hour already holds `HOURLY_LIMIT` mails: OVH refuses more than about
 * 200 an hour from one mailbox, and a refusal halfway down a list is the failure to avoid.
 */

import { useEffect, useSyncExternalStore } from 'react';

import type { MailFact, RegistrantKind, RenderedMail, ReplyFact } from '../engine.ts';
import { getSupabase, supabaseConfigured } from '../persistence/supabaseClient.ts';

/** `test`: one person's mail sent to the régisseur's test address. It counts for nobody. */
export type MailReason = 'validation' | 'renvoi' | 'etape' | 'relance' | 'test';

export interface MailEntry {
  id: number;
  personKind: RegistrantKind;
  personKey: string;
  recipient: string;
  subject: string;
  outcome: 'envoye' | 'echec';
  error: string;
  reason: MailReason;
  /** The follow-up step, '' for a validation mail. */
  stepKey: string;
  /** The `{planning}` lines the mail carried. */
  planning: string;
  /** ISO, as Postgres wrote it. */
  sentAt: string;
}

export interface ReplyEntry {
  id: number;
  volunteerKey: string;
  stepKey: string;
  answer: 'oui' | 'non';
  source: 'lien' | 'regie';
  answeredAt: string;
}

/** Under OVH's 200 an hour, with room for the mails the association sends by hand. */
export const HOURLY_LIMIT = 180;
/** Between two mails of a grouped sending. */
const GAP_MS = 1500;

interface Book {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  /** Newest first, every person together. */
  entries: MailEntry[];
  replies: ReplyEntry[];
  version: number;
  listeners: Set<() => void>;
  loaded: Promise<void> | null;
}

const books = new Map<string, Book>();
const COLUMNS = 'id, person_kind, person_key, recipient, subject, outcome, error, reason, step_key, planning, sent_at';
const REPLY_COLUMNS = 'id, volunteer_key, step_key, answer, source, answered_at';

function bookOf(eventId: string): Book {
  let book = books.get(eventId);
  if (!book) {
    book = {
      status: supabaseConfigured ? 'loading' : 'ready', error: null, entries: [], replies: [], version: 0,
      listeners: new Set(), loaded: null,
    };
    books.set(eventId, book);
  }
  return book;
}

const changed = (book: Book): void => {
  book.version += 1;
  for (const listener of book.listeners) listener();
};

const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const REASONS: readonly MailReason[] = ['validation', 'renvoi', 'etape', 'relance', 'test'];

const entryOf = (row: Record<string, unknown>): MailEntry => ({
  id: Number(row.id),
  personKind: row.person_kind as RegistrantKind,
  personKey: String(row.person_key ?? ''),
  recipient: String(row.recipient ?? ''),
  subject: String(row.subject ?? ''),
  outcome: row.outcome === 'envoye' ? 'envoye' : 'echec',
  error: String(row.error ?? ''),
  reason: REASONS.includes(row.reason as MailReason) ? (row.reason as MailReason) : 'validation',
  stepKey: String(row.step_key ?? ''),
  planning: String(row.planning ?? ''),
  sentAt: String(row.sent_at ?? ''),
});

const replyOf = (row: Record<string, unknown>): ReplyEntry => ({
  id: Number(row.id),
  volunteerKey: String(row.volunteer_key ?? ''),
  stepKey: String(row.step_key ?? ''),
  answer: row.answer === 'non' ? 'non' : 'oui',
  source: row.source === 'lien' ? 'lien' : 'regie',
  answeredAt: String(row.answered_at ?? ''),
});

function loadBook(eventId: string): Promise<void> {
  const book = bookOf(eventId);
  if (!supabaseConfigured) return Promise.resolve();
  if (book.loaded) return book.loaded;
  book.loaded = (async () => {
    try {
      const [mails, replies] = await Promise.all([
        getSupabase().from('mail_log').select(COLUMNS).eq('event_id', eventId).order('id', { ascending: false }).limit(10000),
        getSupabase().from('step_reply').select(REPLY_COLUMNS).eq('event_id', eventId).order('id', { ascending: false }).limit(10000),
      ]);
      if (mails.error) throw mails.error;
      book.entries = (mails.data ?? []).map((row) => entryOf(row as Record<string, unknown>));
      // A database without migration 36 has no answers yet: the mails still read.
      book.replies = replies.error ? [] : (replies.data ?? []).map((row) => replyOf(row as Record<string, unknown>));
      book.status = 'ready';
      book.error = null;
    } catch (cause) {
      book.status = 'error';
      book.error = `Journal des mails illisible: ${message(cause)}`;
      book.loaded = null;
    }
    changed(book);
  })();
  return book.loaded;
}

/** Reads the mails and the answers again: the answers given from the bénévole page since. */
export function reloadMailBook(eventId: string): Promise<void> {
  const book = bookOf(eventId);
  book.loaded = null;
  return loadBook(eventId);
}

export interface MailLog {
  loading: boolean;
  error: string | null;
  entriesOf: (kind: RegistrantKind, key: string) => MailEntry[];
  /** The last mail of any kind, the validation's included. */
  lastOf: (kind: RegistrantKind, key: string) => MailEntry | null;
  /** The last validation mail, sent again or not. */
  lastValidationOf: (kind: RegistrantKind, key: string) => MailEntry | null;
  /** A bénévole's mails of the follow-up and answers, as `followup.ts` reads them. */
  factsOf: (volunteerKey: string) => { mails: MailFact[]; replies: ReplyFact[] };
  repliesOf: (volunteerKey: string) => ReplyEntry[];
  /** Mails the server accepted in the last hour, from this book. */
  sentLastHour: () => number;
}

/** The event's mails, newest first, and a lookup per person. Null event: nothing, quietly. */
export function useMailLog(eventId: string | null): MailLog {
  const book = eventId === null ? null : bookOf(eventId);
  useEffect(() => {
    if (eventId !== null) void loadBook(eventId);
  }, [eventId]);
  useSyncExternalStore(
    (listener) => {
      if (!book) return () => {};
      book.listeners.add(listener);
      return () => book.listeners.delete(listener);
    },
    () => book?.version ?? -1,
    () => book?.version ?? -1,
  );
  return logOf(book);
}

function logOf(book: Book | null): MailLog {
  // A test went to the régisseur, not to the person it was written for: it is in nobody's history.
  const all = book?.entries ?? [];
  const entries = all.filter((e) => e.reason !== 'test');
  const replies = book?.replies ?? [];
  const isStep = (e: MailEntry): boolean => e.reason === 'etape' || e.reason === 'relance';
  return {
    loading: book?.status === 'loading',
    error: book?.error ?? null,
    entriesOf: (kind, key) => entries.filter((e) => e.personKind === kind && e.personKey === key),
    lastOf: (kind, key) => entries.find((e) => e.personKind === kind && e.personKey === key) ?? null,
    lastValidationOf: (kind, key) => entries.find((e) => e.personKind === kind && e.personKey === key && !isStep(e)) ?? null,
    factsOf: (volunteerKey) => ({
      mails: entries
        .filter((e) => e.personKind === 'benevole' && e.personKey === volunteerKey && isStep(e))
        .map((e) => ({ id: e.id, stepKey: e.stepKey, outcome: e.outcome, sentAt: e.sentAt, planning: e.planning })),
      replies: replies
        .filter((r) => r.volunteerKey === volunteerKey)
        .map((r) => ({ stepKey: r.stepKey, answer: r.answer, answeredAt: r.answeredAt, source: r.source })),
    }),
    repliesOf: (volunteerKey) => replies.filter((r) => r.volunteerKey === volunteerKey),
    // Tests included: OVH counts every mail the mailbox sends.
    sentLastHour: () => sentSince(all, Date.now() - 3600_000).length,
  };
}

const sentSince = (entries: readonly MailEntry[], since: number): MailEntry[] =>
  entries.filter((e) => e.outcome === 'envoye' && new Date(e.sentAt).getTime() > since);

export interface SendExtra {
  stepKey?: string;
  planning?: string;
}

/** The failure, recorded by the browser because the function could not record it. */
async function recordFailure(
  eventId: string,
  kind: RegistrantKind,
  key: string,
  mail: RenderedMail,
  reason: MailReason,
  extra: Required<SendExtra>,
  error: string,
): Promise<MailEntry> {
  const local: MailEntry = {
    id: -Date.now(), personKind: kind, personKey: key, recipient: mail.to, subject: mail.subject,
    outcome: 'echec', error, reason, stepKey: extra.stepKey, planning: extra.planning, sentAt: new Date().toISOString(),
  };
  if (!supabaseConfigured) return local;
  try {
    const { data, error: insertError } = await getSupabase()
      .from('mail_log')
      .insert({
        event_id: eventId, person_kind: kind, person_key: key, recipient: mail.to, subject: mail.subject,
        body: mail.body, outcome: 'echec', error, reason, step_key: extra.stepKey, planning: extra.planning,
      })
      .select(COLUMNS)
      .single();
    if (insertError) throw insertError;
    return entryOf(data as Record<string, unknown>);
  } catch (cause) {
    // Not even the record could be written: kept in this tab only, and the sentence says so.
    return { ...local, error: `${error} Échec non enregistré en base (${message(cause)}).` };
  }
}

/**
 * Sends one mail through `send-mail` and records it in the book. Resolves to the entry, sent or
 * failed; never rejects. `extra` names the step of the follow-up and the planning it carries.
 */
export async function sendMail(
  eventId: string,
  kind: RegistrantKind,
  key: string,
  mail: RenderedMail,
  reason: MailReason,
  extra: SendExtra = {},
): Promise<MailEntry> {
  const book = bookOf(eventId);
  const full = { stepKey: extra.stepKey ?? '', planning: extra.planning ?? '' };
  let entry: MailEntry;
  if (!supabaseConfigured) {
    entry = await recordFailure(eventId, kind, key, mail, reason, full, "Pas de serveur de mail avec les jeux de test: rien n'est parti.");
  } else {
    try {
      const { data, error } = await getSupabase().functions.invoke<{ entry: Record<string, unknown> }>('send-mail', {
        body: {
          eventId, personKind: kind, personKey: key, to: mail.to, subject: mail.subject, body: mail.body, reason,
          stepKey: full.stepKey, planning: full.planning,
        },
      });
      if (!error && data?.entry) {
        entry = entryOf(data.entry);
      } else {
        const response = (error as { context?: unknown } | null)?.context;
        let said: { error?: string; sent?: boolean } = {};
        if (response instanceof Response) {
          try {
            said = (await response.clone().json()) as typeof said;
          } catch {
            // Not our JSON: the gateway answering for a function that does not exist.
          }
        }
        const why =
          said.error ??
          (response instanceof Response
            ? "La fonction d'envoi send-mail n'est pas déployée."
            : "La fonction d'envoi send-mail ne répond pas.");
        // Sent but not recorded is the one case that is not a failure of the mail.
        entry = said.sent
          ? {
              id: -Date.now(), personKind: kind, personKey: key, recipient: mail.to, subject: mail.subject,
              outcome: 'envoye', error: why, reason, stepKey: full.stepKey, planning: full.planning, sentAt: new Date().toISOString(),
            }
          : await recordFailure(eventId, kind, key, mail, reason, full, why);
      }
    } catch (cause) {
      entry = await recordFailure(eventId, kind, key, mail, reason, full, `La fonction d'envoi send-mail ne répond pas (${message(cause)}).`);
    }
  }
  book.entries = [entry, ...book.entries];
  changed(book);
  return entry;
}

/**
 * An answer the régie notes by hand, given on the phone or at the bar: a row of `step_reply` like
 * the ones the bénévole page writes, marked `regie`. Resolves to an error sentence, or null.
 */
export async function recordReply(
  eventId: string,
  volunteerKey: string,
  stepKey: string,
  answer: 'oui' | 'non',
): Promise<string | null> {
  const book = bookOf(eventId);
  let entry: ReplyEntry = {
    id: -Date.now(), volunteerKey, stepKey, answer, source: 'regie', answeredAt: new Date().toISOString(),
  };
  if (supabaseConfigured) {
    const { data, error } = await getSupabase()
      .from('step_reply')
      .insert({ event_id: eventId, volunteer_key: volunteerKey, step_key: stepKey, answer, source: 'regie' })
      .select(REPLY_COLUMNS)
      .single();
    if (error) return `Réponse non enregistrée: ${error.message}`;
    entry = replyOf(data as Record<string, unknown>);
  }
  book.replies = [entry, ...book.replies];
  changed(book);
  return null;
}

/*
 * ---------------------------------------------------------------------------------------------
 * The grouped sending.
 * ---------------------------------------------------------------------------------------------
 */

export interface BatchJob {
  kind: RegistrantKind;
  key: string;
  name: string;
  mail: RenderedMail;
  reason: MailReason;
  stepKey: string;
  planning: string;
}

export interface BatchState {
  eventId: string;
  label: string;
  total: number;
  sent: number;
  failed: number;
  /** Who is being sent to right now. */
  current: string;
  /** Waiting for the hour's limit: when it starts again, epoch ms. */
  pausedUntil: number | null;
  running: boolean;
  stopped: boolean;
}

let batch: BatchState | null = null;
let batchVersion = 0;
const batchListeners = new Set<() => void>();

const batchChanged = (next: BatchState | null): void => {
  batch = next;
  batchVersion += 1;
  for (const listener of batchListeners) listener();
};

/** The grouped sending under way, or the last one finished; null before any. */
export function useBatch(): BatchState | null {
  useSyncExternalStore(
    (listener) => {
      batchListeners.add(listener);
      return () => batchListeners.delete(listener);
    },
    () => batchVersion,
    () => batchVersion,
  );
  return batch;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends `jobs` one after the other. Refused while another runs: two lists at once would race for
 * the same hourly limit. The mails are rendered before the start, so what the régisseur read in
 * the list is what leaves.
 */
export function startBatch(eventId: string, label: string, jobs: readonly BatchJob[]): boolean {
  if (batch?.running || jobs.length === 0) return false;
  batchChanged({ eventId, label, total: jobs.length, sent: 0, failed: 0, current: '', pausedUntil: null, running: true, stopped: false });
  void (async () => {
    const book = bookOf(eventId);
    for (const [i, job] of jobs.entries()) {
      if (batch?.stopped) break;
      // The hour's limit, counted from the book: every mail this event sent, by anybody, as
      // loaded, plus everything this tab sent since.
      for (;;) {
        const window = sentSince(book.entries, Date.now() - 3600_000);
        if (window.length < HOURLY_LIMIT) break;
        const oldest = Math.min(...window.map((e) => new Date(e.sentAt).getTime()));
        const until = oldest + 3600_000 + 5_000;
        batchChanged({ ...batch!, pausedUntil: until, current: '' });
        while (Date.now() < until && !batch?.stopped) await sleep(1000);
        if (batch?.stopped) break;
      }
      if (batch?.stopped) break;
      batchChanged({ ...batch!, pausedUntil: null, current: job.name });
      const entry = await sendMail(eventId, job.kind, job.key, job.mail, job.reason, { stepKey: job.stepKey, planning: job.planning });
      batchChanged({
        ...batch!,
        sent: batch!.sent + (entry.outcome === 'envoye' ? 1 : 0),
        failed: batch!.failed + (entry.outcome === 'echec' ? 1 : 0),
      });
      if (i < jobs.length - 1) await sleep(GAP_MS);
    }
    batchChanged({ ...batch!, running: false, current: '', pausedUntil: null });
  })();
  return true;
}

/** Stops after the mail being sent; the others stay to send, and the list will name them. */
export function stopBatch(): void {
  if (batch?.running) batchChanged({ ...batch, stopped: true });
}

/** « le 22/10 à 14:03 », for a line on a fiche. */
export function sentAtLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }).format(date);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(date);
  return `le ${day} à ${time}`;
}
