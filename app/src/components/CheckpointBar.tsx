/**
 * Naming the version on screen, so it is kept until somebody deletes it.
 *
 * The history keeps versions on a clock: one every ten minutes of work, the newest fifty,
 * nothing older than sixty days. That is the right rule for an afternoon of dragging boxes and
 * the wrong one for the four or five states of this plan that will matter in March. "Juste avant
 * l'import du 20 octobre" has to survive five months of autosaves, and under a rule that only
 * counts, every one of those autosaves pushes it closer to the door.
 *
 * It sits in the banner slot under the header rather than in a modal, because it is the same
 * kind of thing as the conflict banner: a sentence about the plan, with the buttons that answer
 * it. The conflict banner wins the slot when both want it, since one of the two is about work
 * that could be lost.
 */

import { useState, type FormEvent } from 'react';

import { usePlan } from '../store/store.tsx';

export function CheckpointBar({
  onSeeHistory,
  onClose,
}: {
  onSeeHistory(): void;
  onClose(): void;
}) {
  const { checkpoint, dirty, saving } = usePlan();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ version: number; name: string } | null>(null);

  // The checkpoint keeps what the STORE holds, not the working copy, so naming it while an edit
  // is still on its way would name the state before that edit. The autosave lands about a second
  // after the last change, so this clears on its own.
  const waiting = dirty || saving;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const wanted = name.trim();
    if (wanted === '' || waiting) return;
    setBusy(true);
    setError(null);
    checkpoint(wanted)
      .then((version) => {
        setDone({ version, name: wanted });
        setBusy(false);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setBusy(false);
      });
  };

  if (done) {
    return (
      <div className="banner is-ok">
        <strong>Version {done.version} enregistrée</strong> sous le nom « {done.name} ». Elle sera
        conservée tant que vous ne la supprimerez pas, contrairement aux versions automatiques.
        <div className="banner-actions">
          <button className="btn" onClick={onSeeHistory}>
            Voir l'historique
          </button>
          <button className="btn" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="banner is-quiet" onSubmit={submit}>
      <strong>Enregistrer cette version.</strong> Donnez-lui un nom pour la retrouver: elle sera
      conservée jusqu'à ce que vous la supprimiez.
      <div className="banner-actions">
        <input
          className="text-input"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Par exemple: avant l'import du 20 octobre"
          maxLength={80}
          required
        />
        <button className="btn is-primary" type="submit" disabled={busy || waiting}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Annuler
        </button>
      </div>
      {waiting && <span className="banner-note">Vos dernières modifications s'enregistrent…</span>}
      {error && <span className="banner-note is-bad">{error}</span>}
    </form>
  );
}
