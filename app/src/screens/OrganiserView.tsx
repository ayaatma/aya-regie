/**
 * What a pole organiser sees: the whole planning, and not one thing they can change.
 *
 * The third kind of reader, after the régisseur and the volunteer, and the second to arrive with
 * no account at all. A volunteer's code opens their own shifts; a organiser's opens everything,
 * because somebody running the bar on the night needs to know who is on the plonge, who is
 * arriving at 2 a.m. and whose phone to ring, and answering half of that would send them to the
 * régisseur for the other half at exactly the wrong moment.
 *
 * READ ONLY IS ENFORCED BY POSTGRES, NOT BY THIS FILE. A organiser has no session; every write in
 * the schema requires `authenticated`, and the one function their code reaches is
 * `get_organiser_planning`, which is `stable`. On top of that the plan context built below has
 * no-op `apply` and `edit`, so a stray affordance writes to nothing rather than to the database.
 * The `readOnly` flag passed to the grid is the third layer and the least important one: it
 * stops the screen OFFERING what would silently fail.
 *
 * THE GRID IS THE RÉGISSEUR'S GRID, not a copy of it. Building a second read-only grid would
 * mean two files drifting apart over six months, and the organiser would end up looking at last
 * month's idea of the plan. The one thing that changes is the filter it opens on.
 *
 * THE CODE IS REMEMBERED IN THIS BROWSER, like a volunteer's. It is typed once, in October, and
 * on the night the page opens straight onto the grid. Fourteen characters is a lot to retype at
 * 3 a.m. on a phone in the dark.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { PlanIndex, validate } from '../engine.ts';
import { useStore } from '../storeContext.ts';
import { log } from '../log/logger.ts';
import { PlanContext, type PlanContextValue } from '../store/store.tsx';
import { PlanningScreen } from './PlanningScreen.tsx';
import { ScreenBoundary } from '../components/ScreenBoundary.tsx';
import type { OrganiserPlanning } from '../persistence/types.ts';

const CODE_KEY = 'lototekno:code-responsable';

const readCode = (): string => {
  try {
    return window.localStorage.getItem(CODE_KEY) ?? '';
  } catch {
    // A private window, or storage the browser refuses. Retyping is the fallback.
    return '';
  }
};

const writeCode = (code: string): void => {
  try {
    if (code === '') window.localStorage.removeItem(CODE_KEY);
    else window.localStorage.setItem(CODE_KEY, code);
  } catch {
    // Not remembering the code costs one retype and nothing else.
  }
};

const noop = () => {};

/**
 * A plan context that holds a plan and refuses to change it.
 *
 * Every mutating member is a no-op rather than a throw. A throw would take the grid down on a
 * stray click, in front of somebody with no way to report it and no way back; doing nothing is
 * the honest answer, since doing nothing is exactly what the database would do.
 */
function readOnlyContext(loaded: OrganiserPlanning): PlanContextValue {
  return {
    id: loaded.eventId,
    plan: loaded.plan,
    past: [],
    future: [],
    lastLabel: null,
    baseVersion: loaded.version,
    savedAt: null,
    dirty: false,
    saving: false,
    conflict: null,
    outdated: null,
    error: null,
    saveError: null,
    index: new PlanIndex(loaded.plan),
    report: validate(loaded.plan),
    canUndo: false,
    canRedo: false,
    apply: noop,
    edit: noop,
    undo: noop,
    redo: noop,
    open: noop,
    reset: noop,
    retrySave: noop,
    close: noop,
    acceptTheirs: noop,
    keepMine: noop,
    restore: async () => {},
    checkpoint: async () => loaded.version,
    historyChanged: noop,
    historyRevision: 0,
  };
}

type Phase = 'idle' | 'loading' | 'unknown' | 'error';

export function OrganiserView({ onLeave }: { onLeave(): void }) {
  const store = useStore();
  const [code, setCode] = useState(readCode);
  const [typed, setTyped] = useState('');
  const [loaded, setLoaded] = useState<OrganiserPlanning | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const look = useCallback(
    (wanted: string) => {
      if (!store.organiserPlanning || wanted === '') return;
      setPhase('loading');
      setError(null);
      store
        .organiserPlanning(wanted)
        .then((found) => {
          if (!found) {
            setPhase('unknown');
            setLoaded(null);
            return;
          }
          setLoaded(found);
          setPhase('idle');
          writeCode(wanted);
          log.setActor(`responsable ${found.responsable.prenom} ${found.responsable.nom}`.trim());
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          setPhase('error');
        });
    },
    [store],
  );

  // The remembered code is tried once, on opening. Nothing is stored until one works, so this
  // can only ever fire with a code that did.
  useEffect(() => {
    if (code !== '') look(code);
  }, [code, look]);

  /**
   * The filter the grid opens on: the ROOT of the first pole this person runs.
   *
   * The root rather than the leaf, because the grid's filter is written in root and leaf keys
   * and a organiser is attached to whichever the régisseur picked. Opening on a root shows the
   * whole pole including its sub-poles, which is what "mon pôle" means to the person running it.
   * Somebody who runs several opens on the first, and the picker does the rest.
   */
  const initialFilter = useMemo(() => {
    if (!loaded) return undefined;
    const index = new PlanIndex(loaded.plan);
    const first = loaded.responsable.poleKeys[0];
    if (first === undefined) return undefined;
    const pole = index.poleByKey.get(first);
    if (!pole) return undefined;
    let current = pole;
    while (current.parentKey) {
      const parent = index.poleByKey.get(current.parentKey);
      if (!parent) break;
      current = parent;
    }
    return current.key;
  }, [loaded]);

  const forget = (): void => {
    writeCode('');
    setCode('');
    setTyped('');
    setLoaded(null);
    setPhase('idle');
  };

  if (loaded) {
    const who = `${loaded.responsable.prenom} ${loaded.responsable.nom}`.trim();
    return (
      <PlanContext.Provider value={readOnlyContext(loaded)}>
        <div className="app">
          <header className="topbar">
            <div className="topbar-brand">
              Planning bénévoles<span>{loaded.plan.name}</span>
            </div>
            {/*
              Said before anything else, in the banner slot the régisseur's conflict warnings
              use. Somebody handed this link has to know in one glance that what they are looking
              at is the real planning and that nothing they do here changes it.
            */}
            <div className="topbar-right">
              <span className="save-state">
                Lecture seule · {who}
                {loaded.responsable.poleKeys.length === 0 && ' · aucun pôle attribué'}
              </span>
              <button className="btn" onClick={forget} title="Oublier ce code sur ce navigateur">
                Changer de code
              </button>
              <button className="btn" onClick={onLeave}>
                Quitter
              </button>
            </div>
          </header>

          <div className="banner is-quiet">
            <strong>Lecture seule.</strong> Vous voyez le planning tel qu'il est en ce moment.
            Rien ne peut être modifié depuis cette page: les changements se font auprès du
            régisseur. Le filtre s'ouvre sur votre pôle, vous pouvez l'élargir à tout l'événement.
          </div>

          <ScreenBoundary resetKey="responsable">
            <PlanningScreen
              onSolve={noop}
              solving={false}
              solveMode={null}
              readOnly
              initialPoleFilter={initialFilter}
            />
          </ScreenBoundary>
        </div>
      </PlanContext.Provider>
    );
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const wanted = typed.trim().toUpperCase();
    if (wanted === '') return;
    setCode(wanted);
    look(wanted);
  };

  return (
    <div className="centered">
      <div className="card">
        <h1>Planning, responsables de pôle</h1>

        {phase === 'loading' ? (
          <p>
            <span className="spinner" /> Ouverture du planning…
          </p>
        ) : (
          <>
            <p>
              Entrez le code qui vous a été envoyé. Il ouvre le planning complet en lecture seule,
              sans compte ni mot de passe.
            </p>

            {phase === 'unknown' && (
              <p className="alert is-bad">
                Ce code ne correspond à aucun responsable. Vérifiez-le, ou demandez-le au
                régisseur.
              </p>
            )}
            {phase === 'error' && error && <p className="alert is-bad">{error}</p>}

            <form className="inline-form" onSubmit={submit}>
              <input
                className="text-input is-code"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Votre code"
                aria-label="Code responsable"
                autoComplete="off"
                autoFocus
                required
              />
              <button className="btn is-primary" type="submit">
                Voir le planning
              </button>
            </form>

            <p className="picker-sep">
              Ce code est personnel. Il donne accès aux coordonnées de tous les bénévoles: ne le
              transmettez à personne.
            </p>
            <button className="btn" onClick={onLeave}>
              Retour
            </button>
          </>
        )}
      </div>
    </div>
  );
}
