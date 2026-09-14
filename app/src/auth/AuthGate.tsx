/**
 * The door. Nothing below it renders until an organiser is logged in.
 *
 * A pass-through when Supabase is not configured, so the fixtures keep opening straight onto
 * the grid.
 *
 * Two ways in, and the order between them was reversed on 2026-09-09. The link sent by email was
 * the only door for a day: no password to lose, no password shared around the association, and
 * the mailbox already proves who somebody is. What it costs is a trip to the mailbox on every
 * machine that has no session yet, which is exactly the moment a régisseur is in a hurry. So the
 * password is now the everyday door, and the link is kept as the one that opens an account the
 * first time and the one that reopens it when the password is gone.
 *
 * Nobody is handed a password: each régisseur chooses their own from « Mon compte » once the
 * link has let them in. That is why there is no password to transmit anywhere, and why this
 * repository still needs no service_role key.
 *
 * Sign-ups are off in the Supabase project, so neither door can ever create an account:
 * `shouldCreateUser: false` below is the same lock said out loud.
 */

import { useState, type FormEvent, type ReactNode } from 'react';

import { getSupabase, supabaseConfigured } from '../persistence/supabaseClient.ts';
import { frenchAuthError } from './errors.ts';
import { useSession } from './useSession.ts';

/** Which door is on screen. */
type Door = 'password' | 'link';

type Phase = 'idle' | 'working' | 'sent';

export function AuthGate({
  children,
  onVolunteer,
}: {
  children: ReactNode;
  onVolunteer(): void;
}) {
  const { session, loading } = useSession();

  if (!supabaseConfigured || session) return <>{children}</>;

  if (loading) {
    return (
      <div className="centered">
        <div className="card">
          <p>
            <span className="spinner" /> Connexion…
          </p>
        </div>
      </div>
    );
  }

  return <LoginCard onVolunteer={onVolunteer} />;
}

/**
 * The card itself, exported so a test can render it.
 *
 * It never touches Supabase while rendering: the client is asked for inside the two submit
 * handlers only, which is what lets this be server rendered on a machine with no configuration
 * at all.
 */
export function LoginCard({ onVolunteer }: { onVolunteer(): void }) {
  const [door, setDoor] = useState<Door>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const address = email.trim();

  /*
   * Read on demand rather than at render time. The card is server rendered by the tests, where
   * there is no `window` at all, and the only two places that need this address are a submit
   * handler and the panel that follows a submit: both of them only ever run in a browser.
   */
  const back = () => window.location.origin + window.location.pathname;

  const fail = (cause: unknown) => {
    setError(frenchAuthError(cause instanceof Error ? cause.message : String(cause)));
    setPhase('idle');
  };

  /*
   * Nothing happens here on success, deliberately. The session lands in the client, the
   * subscription in `useSession` fires, the gate above swaps this card for the tool, and this
   * component is gone before it could have set any state on itself.
   */
  const onPassword = (event: FormEvent) => {
    event.preventDefault();
    if (!address || !password) return;
    setPhase('working');
    setError(null);
    getSupabase()
      .auth.signInWithPassword({ email: address, password })
      .then(({ error: cause }) => {
        if (cause) fail(cause);
      })
      .catch(fail);
  };

  const onLink = (event: FormEvent) => {
    event.preventDefault();
    if (!address) return;
    setPhase('working');
    setError(null);
    getSupabase()
      .auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: false, emailRedirectTo: back() },
      })
      .then(({ error: cause }) => {
        if (cause) fail(cause);
        else setPhase('sent');
      })
      .catch(fail);
  };

  const toDoor = (next: Door) => {
    setDoor(next);
    setPhase('idle');
    setError(null);
    setPassword('');
  };

  return (
    <div className="centered">
      <div className="card">
        <h1>Planning bénévoles</h1>

        {phase === 'sent' ? (
          <>
            <p>
              Un lien de connexion vient d'être envoyé à <strong>{address}</strong>. Ouvrez-le
              depuis ce navigateur, il est valable une heure.
            </p>
            <p>
              Une fois le planning ouvert, le bouton <strong>Mon compte</strong> en haut à droite
              permet de choisir un mot de passe. Les connexions suivantes n'auront plus besoin de
              cet email.
            </p>
            {/*
              The address this page asked the link to come back to, shown because the one thing
              that goes wrong here is invisible otherwise. GoTrue validates the requested address
              against the project's Redirect URLs and, when it does not match, silently falls back
              to the Site URL: the mail then carries a `redirect_to` that is not this site, and
              the link answers "requested path is invalid". Nothing in the browser can detect that
              substitution, so the only remedy is to make the request readable and let somebody
              compare it with the link they received.
            */}
            <p className="panel-sub">
              Il doit revenir sur <code>{back()}</code>. Si l'adresse <code>redirect_to</code> du
              lien reçu diffère, ce sont les réglages Supabase qu'il faut corriger: Authentication,
              URL Configuration, Site URL et Redirect URLs.
            </p>
            <button className="btn" onClick={() => toDoor('password')}>
              Revenir à la connexion
            </button>
          </>
        ) : door === 'password' ? (
          <>
            <p>Réservé aux organisateurs.</p>

            {error && <p className="alert is-bad">{error}</p>}

            <form className="login-form" onSubmit={onPassword}>
              <input
                className="text-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="prenom@exemple.fr"
                aria-label="Adresse email"
                autoComplete="username"
                autoFocus
                required
              />
              <input
                className="text-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mot de passe"
                aria-label="Mot de passe"
                autoComplete="current-password"
                required
              />
              <button className="btn is-primary" type="submit" disabled={phase === 'working'}>
                {phase === 'working' ? 'Connexion…' : 'Se connecter'}
              </button>
            </form>

            <p className="card-note">
              <button className="btn is-link" type="button" onClick={() => toDoor('link')}>
                Première connexion, ou mot de passe oublié ?
              </button>
            </p>
          </>
        ) : (
          <>
            <p>
              Entrez votre adresse email: vous recevrez un lien qui ouvre le planning sans mot de
              passe. Vous pourrez ensuite en choisir un depuis « Mon compte ».
            </p>

            {error && <p className="alert is-bad">{error}</p>}

            <form className="inline-form" onSubmit={onLink}>
              <input
                className="text-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="prenom@exemple.fr"
                aria-label="Adresse email"
                autoComplete="email"
                autoFocus
                required
              />
              <button className="btn is-primary" type="submit" disabled={phase === 'working'}>
                {phase === 'working' ? 'Envoi…' : 'Recevoir le lien'}
              </button>
            </form>

            <p className="card-note">
              <button className="btn is-link" type="button" onClick={() => toDoor('password')}>
                Revenir au mot de passe
              </button>
            </p>
          </>
        )}

        {/*
          The other door, and it is offered rather than hidden. Most people who open this address
          are volunteers looking for their own shifts, and a form asking for an email address they
          were never invited with reads as "you are not welcome here" instead of "you are on the
          wrong page".
        */}
        <p className="picker-sep">
          Vous êtes bénévole ? Votre planning s'ouvre avec le code d'accès qui vous a été envoyé,
          sans compte ni mot de passe.
        </p>
        <button className="btn" onClick={onVolunteer}>
          Voir mon planning bénévole
        </button>
      </div>
    </div>
  );
}
