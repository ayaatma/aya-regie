/**
 * Who is logged in, if anybody.
 *
 * Inert when Supabase is not configured: it answers "no session, nothing loading" and never
 * touches the network, which is what lets the fixtures, the tests and a server render keep
 * working without an account.
 *
 * `loading` matters more than it looks. A magic link comes back with its tokens in the URL and
 * the client needs a moment to read them, so the first answer is always "no session yet".
 * Rendering the login form during that moment would show a form to somebody who has just
 * clicked a login link, which reads as a failure.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';

import { getSupabase, supabaseConfigured } from '../persistence/supabaseClient.ts';

export interface SessionState {
  session: Session | null;
  loading: boolean;
  signOut(): Promise<void>;
}

export function useSession(): SessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabaseConfigured);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let live = true;
    const supabase = getSupabase();

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!live) return;
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        // A session that cannot be read is a session that does not exist. The login form is
        // the right answer, not an error screen.
        if (live) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!live) return;
      setSession(next);
      setLoading(false);
    });

    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabaseConfigured) return;
    await getSupabase().auth.signOut();
  }, []);

  return { session, loading, signOut };
}
