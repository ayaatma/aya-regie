/**
 * The validation mails, 2026-10-22: what was sent to whom, and sending one more.
 *
 * NOT IN THE PLAN. A mail is a fact about the world, written by the `send-mail` function at the
 * moment it sends, into the table `mail_log`; a whole-plan save from a tab opened before must not
 * be able to undo it. So this module reads that table once per event, keeps a book every
 * component reads (the Personnes list draws a hundred rows, a fiche one), and appends to the book
 * what each send answers.
 *
 * NEVER THROWS FROM A SEND. A send ends in an entry, sent or failed, and a failure the function
 * could not record (not deployed, no network) is recorded here, so « l'envoi a échoué » is
 * remembered on the person whatever broke. With the fixtures there is no server at all: the entry
 * is a failure saying so, kept in memory, which is also what the screenshots show.
 */

import { useEffect, useSyncExternalStore } from 'react';

import type { RegistrantKind, RenderedMail } from '../engine.ts';
import { getSupabase, supabaseConfigured } from '../persistence/supabaseClient.ts';

export interface MailEntry {
  id: number;
  personKind: RegistrantKind;
  personKey: string;
  recipient: string;
  subject: string;
  outcome: 'envoye' | 'echec';
  error: string;
  reason: 'validation' | 'renvoi';
  /** ISO, as Postgres wrote it. */
  sentAt: string;
}

interface Book {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  /** Newest first, every person together. */
  entries: MailEntry[];
  version: number;
  listeners: Set<() => void>;
  loaded: Promise<void> | null;
}

const books = new Map<string, Book>();
const COLUMNS = 'id, person_kind, person_key, recipient, subject, outcome, error, reason, sent_at';

function bookOf(eventId: string): Book {
  let book = books.get(eventId);
  if (!book) {
    book = { status: supabaseConfigured ? 'loading' : 'ready', error: null, entries: [], version: 0, listeners: new Set(), loaded: null };
    books.set(eventId, book);
  }
  return book;
}

const changed = (book: Book): void => {
  book.version += 1;
  for (const listener of book.listeners) listener();
};

const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const entryOf = (row: Record<string, unknown>): MailEntry => ({
  id: Number(row.id),
  personKind: row.person_kind as RegistrantKind,
  personKey: String(row.person_key ?? ''),
  recipient: String(row.recipient ?? ''),
  subject: String(row.subject ?? ''),
  outcome: row.outcome === 'envoye' ? 'envoye' : 'echec',
  error: String(row.error ?? ''),
  reason: row.reason === 'renvoi' ? 'renvoi' : 'validation',
  sentAt: String(row.sent_at ?? ''),
});

function loadBook(eventId: string): Promise<void> {
  const book = bookOf(eventId);
  if (!supabaseConfigured) return Promise.resolve();
  if (book.loaded) return book.loaded;
  book.loaded = (async () => {
    try {
      const { data, error } = await getSupabase()
        .from('mail_log')
        .select(COLUMNS)
        .eq('event_id', eventId)
        .order('id', { ascending: false })
        .limit(5000);
      if (error) throw error;
      book.entries = (data ?? []).map((row) => entryOf(row as Record<string, unknown>));
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

/** The event's mails, newest first, and a lookup per person. Null event: nothing, quietly. */
export function useMailLog(eventId: string | null): {
  loading: boolean;
  error: string | null;
  entriesOf: (kind: RegistrantKind, key: string) => MailEntry[];
  lastOf: (kind: RegistrantKind, key: string) => MailEntry | null;
} {
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
  const entries = book?.entries ?? [];
  const entriesOf = (kind: RegistrantKind, key: string) => entries.filter((e) => e.personKind === kind && e.personKey === key);
  return {
    loading: book?.status === 'loading',
    error: book?.error ?? null,
    entriesOf,
    lastOf: (kind, key) => entries.find((e) => e.personKind === kind && e.personKey === key) ?? null,
  };
}

/** The failure, recorded by the browser because the function could not record it. */
async function recordFailure(
  eventId: string,
  kind: RegistrantKind,
  key: string,
  mail: RenderedMail,
  reason: MailEntry['reason'],
  error: string,
): Promise<MailEntry> {
  const local: MailEntry = {
    id: -Date.now(), personKind: kind, personKey: key, recipient: mail.to, subject: mail.subject,
    outcome: 'echec', error, reason, sentAt: new Date().toISOString(),
  };
  if (!supabaseConfigured) return local;
  try {
    const { data, error: insertError } = await getSupabase()
      .from('mail_log')
      .insert({
        event_id: eventId, person_kind: kind, person_key: key, recipient: mail.to, subject: mail.subject,
        body: mail.body, outcome: 'echec', error, reason,
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
 * failed; never rejects.
 */
export async function sendMail(
  eventId: string,
  kind: RegistrantKind,
  key: string,
  mail: RenderedMail,
  reason: MailEntry['reason'],
): Promise<MailEntry> {
  const book = bookOf(eventId);
  let entry: MailEntry;
  if (!supabaseConfigured) {
    entry = await recordFailure(eventId, kind, key, mail, reason, "Pas de serveur de mail avec les jeux de test: rien n'est parti.");
  } else {
    try {
      const { data, error } = await getSupabase().functions.invoke<{ entry: Record<string, unknown> }>('send-mail', {
        body: { eventId, personKind: kind, personKey: key, to: mail.to, subject: mail.subject, body: mail.body, reason },
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
          ? { id: -Date.now(), personKind: kind, personKey: key, recipient: mail.to, subject: mail.subject, outcome: 'envoye', error: why, reason, sentAt: new Date().toISOString() }
          : await recordFailure(eventId, kind, key, mail, reason, why);
      }
    } catch (cause) {
      entry = await recordFailure(eventId, kind, key, mail, reason, `La fonction d'envoi send-mail ne répond pas (${message(cause)}).`);
    }
  }
  book.entries = [entry, ...book.entries];
  changed(book);
  return entry;
}

/** « le 22/10 à 14:03 », for a line on a fiche. */
export function sentAtLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }).format(date);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(date);
  return `le ${day} à ${time}`;
}
