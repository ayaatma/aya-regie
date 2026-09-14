/**
 * Choosing which plan to open, and creating one.
 *
 * On the fixtures the list is the generated scenarios; on Supabase it is the events this
 * organiser has access to. The list itself does not know which, because it only ever talks to
 * `PlanStore.list()`.
 *
 * A new plan is empty on purpose: a name, the event's date and the default rules, and nothing
 * else. Poles and shifts are drawn in Réglages, volunteers arrive by import. Anything else
 * would be this screen guessing at an event it knows nothing about.
 *
 * The offer to copy a generated scenario is separate, and only appears when the store is empty
 * and the scenarios are actually reachable, which they are not in a production build. Without
 * it a fresh database is a dead end.
 */

import { useEffect, useState, type FormEvent } from 'react';

import { usePlan } from '../store/store.tsx';
import { useStore } from '../storeContext.ts';
import { FixtureStore } from '../persistence/fixtureStore.ts';
import { newEventPlan } from '../engine.ts';
import { normalisePlan } from '../persistence/normalise.ts';
import type { PlanRef } from '../persistence/types.ts';

export function PlanPicker() {
  const { open } = usePlan();
  const store = useStore();
  const [refs, setRefs] = useState<PlanRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeds, setSeeds] = useState<PlanRef[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  /** The plan whose deletion is being confirmed, and the name typed back to confirm it. */
  const [doomed, setDoomed] = useState<PlanRef | null>(null);
  const [confirmName, setConfirmName] = useState('');

  useEffect(() => {
    store
      .list()
      .then(setRefs)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [store]);

  const empty = refs?.length === 0;

  useEffect(() => {
    if (!empty || !store.create) return;
    new FixtureStore()
      .list()
      .then(setSeeds)
      .catch(() => setSeeds([]));
  }, [empty, store]);

  const fail = (cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
    setBusy(null);
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    const wanted = name.trim();
    if (!wanted || !store.create) return;
    setBusy('new');
    setError(null);
    // A neutral event (`newEventPlan`), through the normaliser like everything that is stored.
    // The normaliser alone would fill the gaps with the Loto Tekno's date, tranches and hours.
    store
      .create(normalisePlan(newEventPlan(wanted)))
      .then((created) => open(created.id))
      .catch(fail);
  };

  /**
   * Deleting a plan, name in hand.
   *
   * The typed name is sent as it stands and the store is what checks it, so the guard survives
   * anything this screen gets wrong. Everything goes: volunteers, créneaux, affectations and the
   * whole history, which is why it asks for the name rather than for a click.
   */
  const remove = (event: FormEvent) => {
    event.preventDefault();
    if (!doomed || !store.remove) return;
    setBusy(doomed.id);
    setError(null);
    store
      .remove(doomed.id, confirmName)
      .then(() => {
        setDoomed(null);
        setConfirmName('');
        setBusy(null);
        return store.list().then(setRefs);
      })
      .catch(fail);
  };

  const copy = (ref: PlanRef) => {
    if (!store.create) return;
    setBusy(ref.id);
    setError(null);
    const fixtures = new FixtureStore();
    fixtures
      .load(ref.id)
      .then((stored) => store.create!(stored.plan))
      .then((created) => open(created.id))
      .catch(fail);
  };

  return (
    <div className="centered">
      <div className="card">
        <h1>Planning bénévoles</h1>
        <p>
          13 mars 2027, de 12h à 6h du matin. Choisissez le planning à ouvrir.{' '}
          {store.shared
            ? 'Vos modifications sont enregistrées dans la base et visibles par les autres organisateurs.'
            : 'Vos modifications sont enregistrées automatiquement dans ce navigateur.'}
        </p>

        {error && <p className="alert is-bad">{error}</p>}
        {!refs && !error && (
          <p>
            <span className="spinner" /> Chargement…
          </p>
        )}

        <div className="picker">
          {refs?.map((ref) => (
            <div key={ref.id} className="picker-row">
              <button className="picker-item" onClick={() => open(ref.id)}>
                <span className="picker-label">{ref.label}</span>
                <span className="picker-detail">{ref.detail}</span>
              </button>
              {store.remove && (
                <button
                  className="btn is-icon is-danger"
                  title={`Supprimer « ${ref.label} »`}
                  disabled={busy !== null}
                  onClick={() => {
                    setDoomed(ref);
                    setConfirmName('');
                    setError(null);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {doomed && (
          <form className="picker-danger" onSubmit={remove}>
            <span className="picker-danger-text">
              Supprime définitivement « {doomed.label} », {doomed.detail}, ainsi que tout son
              historique. Tapez le nom du planning pour confirmer.
            </span>
            <input
              className="text-input"
              autoFocus
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              placeholder={doomed.label}
              maxLength={80}
            />
            <button className="btn is-danger" type="submit" disabled={busy !== null}>
              {busy === doomed.id ? 'Suppression…' : 'Supprimer'}
            </button>
            <button className="btn" type="button" onClick={() => setDoomed(null)}>
              Annuler
            </button>
          </form>
        )}

        {empty && !store.create && (
          <p>
            Aucun jeu de test. Lancez <code>npm run fixture -- --all</code> dans le dossier{' '}
            <code>tools</code>.
          </p>
        )}

        {store.create && (
          <>
            <p className="picker-sep">
              {empty
                ? 'Aucun planning pour le moment. Créez-en un, il sera vide et se remplit dans Réglages puis par un import.'
                : 'Ou créez un planning vide, à remplir dans Réglages puis par un import.'}
            </p>
            <form className="inline-form" onSubmit={create}>
              <input
                className="text-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nom du planning"
                maxLength={80}
                required
              />
              <button className="btn is-primary" type="submit" disabled={busy !== null}>
                {busy === 'new' ? 'Création…' : 'Nouveau planning'}
              </button>
            </form>
          </>
        )}

        {empty && store.create && seeds.length > 0 && (
          <>
            <p className="picker-sep">
              Ou copiez un jeu de test pour essayer l'outil. Ce sont des bénévoles inventés.
            </p>
            <div className="picker">
              {seeds.map((ref) => (
                <button
                  key={ref.id}
                  className="picker-item"
                  disabled={busy !== null}
                  onClick={() => copy(ref)}
                >
                  <span className="picker-label">
                    {busy === ref.id ? 'Copie en cours…' : `Copier « ${ref.label} »`}
                  </span>
                  <span className="picker-detail">{ref.detail}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
