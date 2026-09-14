/**
 * Choosing a password, from inside the tool.
 *
 * This is the other half of the login: the link sent by email opens an account the first time,
 * and this is where the person it opened for turns that one trip to the mailbox into a password
 * they can use everywhere afterwards. Nobody is handed a password by somebody else, so none ever
 * travels through a mail, a message or a shared document, and the régisseur has nothing to
 * distribute.
 *
 * It sits in the banner slot under the header, like the checkpoint bar, for the same reason: it
 * is a short form with the buttons that answer it, and stealing the whole screen for it would
 * mean leaving the plan, which is never what somebody wants who is in the middle of an
 * afternoon of assignments.
 *
 * Both fields are typed here, and both are compared here, because a typo repeated identically in
 * one field is the single mistake that locks somebody out of the account they have just set up,
 * and the browser is the only place that ever sees both.
 */

import { useState, type FormEvent } from 'react';

import { getSupabase } from '../persistence/supabaseClient.ts';
import { MIN_PASSWORD, frenchAuthError, passwordProblem } from './errors.ts';

export function AccountBar({ email, onClose }: { email: string | null; onClose(): void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const problem = passwordProblem(password, again);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const fail = (cause: unknown) => {
      setBusy(false);
      setError(frenchAuthError(cause instanceof Error ? cause.message : String(cause)));
    };
    /*
     * The try is not decoration: `getSupabase` throws, synchronously, when the build carries no
     * configuration, and a throw from inside a submit handler is caught by no error boundary.
     * Here it becomes the same sentence in the same place as any other failure.
     */
    try {
      getSupabase()
        .auth.updateUser({ password })
        .then(({ error: cause }) => {
          setBusy(false);
          if (cause) setError(frenchAuthError(cause.message));
          else {
            // Held nowhere once it has been sent: the fields are cleared on the way to the
            // confirmation rather than left sitting in a form behind it.
            setPassword('');
            setAgain('');
            setDone(true);
          }
        })
        .catch(fail);
    } catch (cause) {
      fail(cause);
    }
  };

  if (done) {
    return (
      <div className="banner is-ok">
        <strong>Mot de passe enregistré.</strong> Les prochaines connexions se font avec{' '}
        {email ? <>{email}</> : 'votre adresse email'} et ce mot de passe, sur n'importe quel
        appareil. Cette session-ci reste ouverte.
        <div className="banner-actions">
          <button className="btn" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="banner is-quiet" onSubmit={submit}>
      <strong>Choisir un mot de passe{email ? ` pour ${email}` : ''}.</strong> Il remplace le lien
      envoyé par email: {MIN_PASSWORD} caractères au minimum, que personne d'autre ne connaît.
      <div className="banner-actions">
        {/*
          The address, invisible and unmodifiable, so that a password manager files what it
          records under the right account. Without it a browser offers to save a password with no
          user name attached, then fails to propose it back on the login form.
        */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={email ?? ''}
          readOnly
          hidden
        />
        <input
          className="text-input"
          type="password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Nouveau mot de passe"
          aria-label="Nouveau mot de passe"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
        />
        <input
          className="text-input"
          type="password"
          value={again}
          onChange={(event) => setAgain(event.target.value)}
          placeholder="Le même, pour vérifier"
          aria-label="Répéter le mot de passe"
          autoComplete="new-password"
          required
        />
        <button className="btn is-primary" type="submit" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Annuler
        </button>
      </div>
      {error && <span className="banner-note is-bad">{error}</span>}
    </form>
  );
}
