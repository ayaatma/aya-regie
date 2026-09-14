/**
 * The Supabase connection, and the decision of whether there is one at all.
 *
 * Both values come from the build, through `app/.env.local`, which is gitignored. The anon key
 * is public by construction: it ships inside the bundle and anybody who opens the page can read
 * it. It is not a secret and is not treated as one. What keeps the planning private is row
 * level security in Postgres, which returns nothing at all without a session. The service_role
 * key never comes anywhere near this repository.
 *
 * When the two variables are absent, the app falls back to the fixtures. That is what keeps
 * `npm run dev` working on a machine that has never seen Supabase, and what keeps the tests
 * from ever opening a socket.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** `import.meta.env` exists under Vite and not under `tsx`, which is how the tests run. */
const env = import.meta.env ?? ({} as ImportMetaEnv);

const url = env.VITE_SUPABASE_URL ?? '';
const anonKey = env.VITE_SUPABASE_ANON_KEY ?? '';

export const supabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/**
 * The one client, created on first use rather than at import time.
 *
 * Lazily, so that importing this module from a screen costs nothing and cannot fail on a
 * machine with no configuration.
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseConfigured) {
    throw new Error(
      "La connexion à la base n'est pas configurée: VITE_SUPABASE_URL et " +
        'VITE_SUPABASE_ANON_KEY manquent dans app/.env.local.',
    );
  }
  client ??= createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The magic link comes back with its tokens in the URL. This is what picks them up.
      detectSessionInUrl: true,
    },
  });
  return client;
}
