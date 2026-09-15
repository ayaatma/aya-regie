/**
 * `sheet-csv`, the one Supabase Edge Function of AyaRégie, 2026-09-15.
 *
 *   POST { url }  with the régisseur's session  →  200 text/csv  |  4xx/5xx { error, serviceAccount }
 *
 * Reads a PRIVATE Google Sheet shared with the service account whose JSON key is the secret
 * GOOGLE_SERVICE_ACCOUNT. See `core.ts` for why, and `.claude/memory/feature_private_sheet.md` for
 * the deployment.
 *
 * WHO MAY CALL IT: a signed-in régisseur, and nobody else. The gateway already refuses a request
 * without a valid Supabase JWT, but the public anon key is one; so the session is checked here,
 * through `auth.getUser`, exactly as the database's policies only trust the `authenticated` role.
 * Sign-ups are closed on this project, so an account is a régisseur.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { SheetError, accessToken, parseSheetUrl, readSheetCsv, type ServiceAccountKey } from './core.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

/** Kept between calls while the function instance lives: a token lasts an hour. */
let cached: { token: string; expiresAt: number } | null = null;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json(405, { error: 'POST attendu.' });

  const rawKey = Deno.env.get('GOOGLE_SERVICE_ACCOUNT');
  let key: ServiceAccountKey | null = null;
  try {
    key = rawKey ? (JSON.parse(rawKey) as ServiceAccountKey) : null;
  } catch {
    key = null;
  }
  if (!key?.client_email || !key.private_key) {
    return json(503, { error: "Le compte de service n'est pas configuré (secret GOOGLE_SERVICE_ACCOUNT absent ou illisible)." });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { authorization: request.headers.get('authorization') ?? '' } },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return json(401, { error: 'Connexion régisseur requise.' });

  let url = '';
  try {
    url = String(((await request.json()) as { url?: unknown }).url ?? '');
  } catch {
    return json(400, { error: 'Corps JSON { url } attendu.' });
  }
  const ref = parseSheetUrl(url);
  if (!ref) return json(400, { error: "Ce lien n'est pas une feuille Google Sheets." });

  try {
    const now = Math.floor(Date.now() / 1000);
    if (!cached || cached.expiresAt - 60 < now) cached = await accessToken(key, fetch, now);
    const csv = await readSheetCsv(ref, cached.token, fetch, key.client_email);
    return new Response(csv, { status: 200, headers: { ...cors, 'content-type': 'text/csv; charset=utf-8' } });
  } catch (cause) {
    if (cause instanceof SheetError) return json(cause.status, { error: cause.message, serviceAccount: key.client_email });
    return json(500, { error: 'Lecture de la feuille impossible.', serviceAccount: key.client_email });
  }
});
