/**
 * `send-mail`, AyaRégie's third Supabase Edge Function, 2026-10-22.
 *
 *   POST { eventId, personKind, personKey, to, subject, body, reason }  with the régisseur's session
 *     →  200 { entry }   the `mail_log` row, sent or failed: a refusal by the mail server is an
 *                        answer, recorded, not an error of this function
 *     |  4xx/5xx { error }   nothing was sent; `logged` true when the failure is recorded anyway
 *
 * Sends one validation mail through the association's mailbox (secrets SMTP_HOST, SMTP_USER,
 * SMTP_PASSWORD, optional SMTP_PORT, SMTP_FROM, SMTP_FROM_NAME, SMTP_REPLY_TO) and records it.
 * See `core.ts` for why, and `README.md` for the setup.
 *
 * THE ROW IS WRITTEN AS THE RÉGISSEUR, with their own token, so `sent_by` is who pressed the
 * button and row level security applies exactly as it does in the browser. No service_role key.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

import { explainSmtpError, logRow, parseSendRequest, RequestError, smtpSettings } from './core.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json(405, { error: 'POST attendu.' });

  const smtp = smtpSettings((name) => Deno.env.get(name));
  if ('missing' in smtp) {
    return json(503, { error: `La boîte d'envoi n'est pas configurée (secrets ${smtp.missing.join(', ')} absents).` });
  }

  // The token passed to getUser explicitly: see the 2026-09-16 note in `../sheet-csv/index.ts`.
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (token === '') return json(401, { error: 'Connexion régisseur requise.' });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: who, error: whoError } = await supabase.auth.getUser(token);
  if (whoError || !who.user) {
    return json(401, { error: 'Connexion régisseur requise: la session a expiré, reconnectez-vous puis réessayez.' });
  }

  let send;
  try {
    send = parseSendRequest(await request.json().catch(() => null));
  } catch (cause) {
    if (cause instanceof RequestError) return json(400, { error: cause.message });
    throw cause;
  }

  let outcome: 'envoye' | 'echec' = 'envoye';
  let failure = '';
  try {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
    await transport.sendMail({
      from: smtp.fromName ? { name: smtp.fromName, address: smtp.from } : smtp.from,
      to: send.to,
      replyTo: smtp.replyTo || undefined,
      subject: send.subject,
      text: send.body,
    });
  } catch (cause) {
    outcome = 'echec';
    failure = explainSmtpError(cause);
  }

  const { data: entry, error: logError } = await supabase
    .from('mail_log')
    .insert(logRow(send, outcome, failure))
    .select('id, person_kind, person_key, recipient, subject, outcome, error, reason, sent_at')
    .single();
  if (logError) {
    // Sent (or not) but not recorded: say both, so the browser records it itself.
    return json(500, {
      error: `${outcome === 'envoye' ? 'Mail envoyé' : failure}, mais le journal des mails n'a pas pu être écrit: ${logError.message}`,
      sent: outcome === 'envoye',
      logged: false,
    });
  }
  return json(200, { entry });
});
