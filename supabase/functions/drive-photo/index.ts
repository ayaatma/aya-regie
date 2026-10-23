/**
 * `drive-photo`, AyaRégie's second Supabase Edge Function, 2026-10-10.
 *
 *   POST { fileId }  with the régisseur's session  →  200 application/octet-stream (the image,
 *                                                     its real type in `x-photo-type`)
 *                                                  |  4xx/5xx { error, serviceAccount }
 *
 * Reads one photo uploaded through the Google Form, with the service account of `sheet-csv`
 * (secret GOOGLE_SERVICE_ACCOUNT). See `core.ts` for why, and `README.md` for the setup.
 *
 * OCTET-STREAM ON PURPOSE: supabase-js hands the caller a Blob for that type and only for that
 * type (an `image/*` answer would arrive as text, which is a corrupted picture).
 *
 * WHO MAY CALL IT: a signed-in régisseur, checked exactly as `sheet-csv` checks it.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { accessToken, type ServiceAccountKey } from '../sheet-csv/core.ts';
import { DRIVE_READONLY, PhotoError, readDrivePhoto, thumbnailSize } from './core.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-expose-headers': 'x-photo-type',
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

  // The token passed to getUser explicitly: see the 2026-09-16 note in `../sheet-csv/index.ts`.
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (token === '') return json(401, { error: 'Connexion régisseur requise.' });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return json(401, { error: 'Connexion régisseur requise: la session a expiré, reconnectez-vous puis réessayez.' });
  }

  let fileId = '';
  let size = thumbnailSize(undefined);
  try {
    const body = (await request.json()) as { fileId?: unknown; size?: unknown };
    fileId = String(body.fileId ?? '');
    size = thumbnailSize(body.size);
  } catch {
    return json(400, { error: 'Corps JSON { fileId, size? } attendu.' });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    if (!cached || cached.expiresAt - 60 < now) cached = await accessToken(key, fetch, now, DRIVE_READONLY);
    const photo = await readDrivePhoto(fileId, cached.token, fetch, key.client_email, size);
    return new Response(photo.bytes, {
      status: 200,
      headers: { ...cors, 'content-type': 'application/octet-stream', 'x-photo-type': photo.contentType },
    });
  } catch (cause) {
    if (cause instanceof PhotoError) return json(cause.status, { error: cause.message, serviceAccount: key.client_email });
    // `accessToken` throws the sheet function's error type; its message is already in French.
    if (cause instanceof Error && 'status' in cause) {
      return json(Number((cause as { status: unknown }).status) || 502, { error: cause.message, serviceAccount: key.client_email });
    }
    return json(500, { error: 'Lecture de la photo impossible.', serviceAccount: key.client_email });
  }
});
