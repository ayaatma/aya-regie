/**
 * Les mails de test, 2026-10-22: before a mail leaves for a hundred people, the régisseur sends it
 * to themself, exactly as one of them would get it.
 *
 * THE ADDRESS BELONGS TO THE ACCOUNT, not to the event: it is stored in the Supabase user's
 * metadata (`test_mail_address`), so it follows the régisseur from one computer to another, and
 * two régisseurs each test on their own mailbox. Until one is typed, it is the login address.
 * With the fixtures there is no account: it lives in this browser.
 *
 * A TEST IS ONE PERSON'S MAIL, sent elsewhere: the same rendering (planning, personal link), the
 * subject marked « [TEST] » and one line on top saying whose mail it is. It goes through
 * `send-mail` with the reason `test`, so it is in `mail_log` (it does count towards OVH's hourly
 * limit) but in nobody's history: the person it was written for has still received nothing.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

import { isMailAddress, type RegistrantKind, type RenderedMail } from '../engine.ts';
import { getSupabase, supabaseConfigured } from '../persistence/supabaseClient.ts';
import { sendMail, type MailEntry } from './mailStore.ts';

const LOCAL_KEY = 'ayaregie:test-mail';

let address = '';
let loaded = false;
let version = 0;
const listeners = new Set<() => void>();

const changed = (next: string): void => {
  address = next;
  loaded = true;
  version += 1;
  for (const listener of listeners) listener();
};

async function load(): Promise<void> {
  if (loaded) return;
  if (!supabaseConfigured) {
    let stored = '';
    try {
      stored = window.localStorage.getItem(LOCAL_KEY) ?? '';
    } catch {
      // A browser refusing storage: the address is typed again, nothing else is lost.
    }
    changed(stored);
    return;
  }
  try {
    const { data } = await getSupabase().auth.getUser();
    const user = data.user;
    const chosen = typeof user?.user_metadata?.test_mail_address === 'string' ? (user.user_metadata.test_mail_address as string) : '';
    changed(chosen.trim() !== '' ? chosen : user?.email ?? '');
  } catch {
    changed('');
  }
}

/** Saves the address on the account. Resolves to an error sentence, or null. */
export async function saveTestAddress(next: string): Promise<string | null> {
  const value = next.trim();
  if (value !== '' && !isMailAddress(value)) return `« ${value} » n'est pas une adresse e-mail valide.`;
  if (!supabaseConfigured) {
    try {
      window.localStorage.setItem(LOCAL_KEY, value);
    } catch {
      // Kept for this tab only.
    }
    changed(value);
    return null;
  }
  const { error } = await getSupabase().auth.updateUser({ data: { test_mail_address: value } });
  if (error) return `Adresse non enregistrée: ${error.message}`;
  changed(value);
  return null;
}

/** The régisseur's test address, '' while unknown or when there is none. */
export function useTestAddress(): string {
  useEffect(() => {
    void load();
  }, []);
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => version,
  );
  return address;
}

/** One person's mail as the test address receives it. */
export function asTest(mail: RenderedMail, to: string, who: string): RenderedMail {
  return {
    ...mail,
    to,
    subject: `[TEST] ${mail.subject}`,
    body: `Mail de test : voici ce que recevrait ${who} (${mail.to || 'sans adresse'}).\n\n${mail.body}`,
  };
}

/**
 * « Envoyer un test à moi@… », beside a preview. Says what happened under it. Without an address,
 * points to Réglages.
 */
export function TestMailButton({
  eventId,
  kind,
  personKey,
  who,
  mail,
  stepKey = '',
  planning = '',
}: {
  eventId: string | null;
  kind: RegistrantKind;
  personKey: string;
  who: string;
  mail: RenderedMail;
  stepKey?: string;
  planning?: string;
}) {
  const to = useTestAddress();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MailEntry | null>(null);
  // Another person or another text: the last outcome was about something else.
  useEffect(() => setResult(null), [personKey, mail.subject, mail.body]);

  if (!isMailAddress(to)) {
    return <span className="people-meta">Pas d'adresse de test: la renseigner dans Réglages, Mails de test.</span>;
  }
  return (
    <span className="test-mail">
      <button
        type="button"
        className="btn"
        disabled={busy || eventId === null}
        onClick={async () => {
          if (eventId === null) return;
          setBusy(true);
          setResult(await sendMail(eventId, kind, personKey, asTest(mail, to, who), 'test', { stepKey, planning }));
          setBusy(false);
        }}
      >
        {busy ? 'Envoi du test…' : `Envoyer un test à ${to}`}
      </button>
      {result && (
        <span className={`people-meta ${result.outcome === 'envoye' ? 'is-ok' : 'is-bad'}`}>
          {result.outcome === 'envoye' ? '✓ Test envoyé, à vérifier dans la boîte.' : `⚠️ ${result.error}`}
        </span>
      )}
    </span>
  );
}
