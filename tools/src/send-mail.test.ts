/**
 * The pure core of the `send-mail` Edge Function (`supabase/functions/send-mail/core.ts`), under
 * Node. No mail server anywhere.
 */

import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { explainSmtpError, logRow, parseSendRequest, smtpSettings } from '../../supabase/functions/send-mail/core.js';

const ok = {
  eventId: '0b6c1f9e-3f1a-4c55-9a3e-1d2b3c4d5e6f',
  personKind: 'benevole',
  personKey: 'lea-martin',
  to: ' lea@example.org ',
  subject: 'Loto : validée',
  body: 'Bonjour Léa',
  reason: 'renvoi',
};

test('a well-formed request is read, trimmed, and keeps its reason', () => {
  const r = parseSendRequest(ok);
  strictEqual(r.to, 'lea@example.org');
  strictEqual(r.reason, 'renvoi');
  strictEqual(parseSendRequest({ ...ok, reason: 'autre' }).reason, 'validation');
  strictEqual(r.stepKey, '');
});

test('a step of the follow-up names its step, and carries the planning it sent', () => {
  const r = parseSendRequest({ ...ok, reason: 'etape', stepKey: 'planning', planning: '- samedi 13 mars' });
  strictEqual(r.reason, 'etape');
  const row = logRow(r, 'envoye', '');
  strictEqual(row.step_key, 'planning');
  strictEqual(row.planning, '- samedi 13 mars');
  throws(() => parseSendRequest({ ...ok, reason: 'relance' }), /Étape/);
  strictEqual(parseSendRequest({ ...ok, reason: 'test' }).reason, 'test', 'a test needs no step');
});

test('what could smuggle a header or reach nobody is refused before any network', () => {
  throws(() => parseSendRequest(null), /JSON/);
  throws(() => parseSendRequest({ ...ok, eventId: 'x' }), /événement/);
  throws(() => parseSendRequest({ ...ok, personKind: 'invite' }), /Type/);
  throws(() => parseSendRequest({ ...ok, to: 'lea@example.org, bcc@evil.example' }), /adresse/);
  throws(() => parseSendRequest({ ...ok, to: 'pas une adresse' }), /adresse/);
  throws(() => parseSendRequest({ ...ok, subject: 'Salut\nBcc: x@y.z' }), /seule ligne/);
  throws(() => parseSendRequest({ ...ok, body: '   ' }), /vide/);
});

test('the mailbox settings say which secret is missing, and default to 465 and the mailbox as sender', () => {
  deepStrictEqual(smtpSettings(() => undefined), { missing: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'] });
  const env: Record<string, string> = { SMTP_HOST: 'ssl0.ovh.net', SMTP_USER: 'contact@example.org', SMTP_PASSWORD: ' p w ' };
  const s = smtpSettings((n) => env[n]);
  if ('missing' in s) throw new Error('settings expected');
  strictEqual(s.port, 465);
  strictEqual(s.from, 'contact@example.org');
  // A password is taken as typed, spaces included.
  strictEqual(s.password, ' p w ');
});

test('a mail server refusal becomes a sentence, with the raw text kept', () => {
  const auth = explainSmtpError(Object.assign(new Error('Invalid login: 535 5.7.8 Authentication failed'), { responseCode: 535 }));
  strictEqual(auth.startsWith("Le serveur de mail refuse l'identifiant"), true);
  strictEqual(auth.includes('535 5.7.8'), true);
  strictEqual(explainSmtpError(new Error('getaddrinfo ENOTFOUND ssl0.ovh.ne')).startsWith('Le serveur de mail ne répond pas'), true);
});

test('the log row names the person by kind and key, whatever the outcome', () => {
  const row = logRow(parseSendRequest(ok), 'echec', 'refusé');
  strictEqual(row.person_kind, 'benevole');
  strictEqual(row.person_key, 'lea-martin');
  strictEqual(row.outcome, 'echec');
  strictEqual(row.error, 'refusé');
});
